import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../api/_lib/app.js";
import { createMemoryStore } from "../api/_lib/memory-store.js";
import { SESSION_COOKIE, parseCookies } from "../api/_lib/session.js";

const env = {
  SESSION_SECRET: "test-session-secret",
  TAB_PASSWORD: "correct-horse",
  ALLOWED_GITHUB_LOGIN: "hoffbrandm",
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
};

const validStore = {
  version: 1,
  friends: [{ id: "ben", name: "Ben", email: "", createdAt: "2026-08-25T10:00:00.000Z" }],
  transactions: [{
    id: "tx-1",
    friendId: "ben",
    type: "expense",
    amountPence: 2400,
    paidBy: "me",
    description: "Coffee",
    date: "2026-08-25",
    createdAt: "2026-08-25T10:01:00.000Z",
    myShareAdjustmentPence: 0,
  }],
};

function cookieHeader(response) {
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) return cookies.map((item) => item.split(";")[0]).join("; ");
  const single = response.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

async function request(app, path, { method = "GET", body, cookie, origin = "http://tab.test" } = {}) {
  const headers = { origin };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await app(new Request(`http://tab.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json, response, cookie: cookieHeader(response) };
}

async function signIn(app) {
  const result = await request(app, "/api/auth/login", { method: "POST", body: { password: "correct-horse" } });
  assert.equal(result.status, 200);
  assert.match(result.cookie, new RegExp(`^${SESSION_COOKIE}=`));
  return result.cookie;
}

test("unauthenticated reads and writes are rejected", async () => {
  const app = createApp({ env, storeDriver: createMemoryStore() });
  const me = await request(app, "/api/auth/me");
  const read = await request(app, "/api/store");
  const write = await request(app, "/api/store", { method: "PUT", body: { store: validStore, sha: "mem-1" } });
  assert.equal(me.status, 401);
  assert.equal(me.json.authenticated, false);
  assert.deepEqual(me.json.methods, { github: true, password: true });
  assert.equal(read.status, 401);
  assert.equal(write.status, 401);
});

test("a wrong passphrase does not create a session", async () => {
  const app = createApp({ env, storeDriver: createMemoryStore() });
  const result = await request(app, "/api/auth/login", { method: "POST", body: { password: "nope" } });
  assert.equal(result.status, 401);
  assert.equal(result.cookie.includes(`${SESSION_COOKIE}=`), false);
});

test("signing in restores the same friends and transactions after a fresh client", async () => {
  const storeDriver = createMemoryStore(validStore);
  const app = createApp({ env, storeDriver });
  const cookie = await signIn(app);
  const first = await request(app, "/api/store", { cookie });
  assert.equal(first.status, 200);
  assert.equal(first.json.store.friends[0].name, "Ben");
  assert.equal(first.json.store.transactions[0].amountPence, 2400);

  const freshApp = createApp({ env, storeDriver });
  const again = await request(freshApp, "/api/store", { cookie });
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.store, first.json.store);
});

test("adding a friend persists through the store API, not the request cookie", async () => {
  const storeDriver = createMemoryStore();
  const app = createApp({ env, storeDriver });
  const cookie = await signIn(app);
  const current = await request(app, "/api/store", { cookie });
  const next = {
    version: 1,
    friends: [{ id: "sam", name: "Sam", email: "", createdAt: "2026-08-25T12:00:00.000Z" }],
    transactions: [],
  };
  const saved = await request(app, "/api/store", {
    method: "PUT",
    cookie,
    body: { store: next, sha: current.json.sha },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.store.friends[0].name, "Sam");
  assert.equal(parseCookies(cookie)[SESSION_COOKIE].includes("Sam"), false);

  const otherClient = createApp({ env, storeDriver });
  const otherCookie = await signIn(otherClient);
  const loaded = await request(otherClient, "/api/store", { cookie: otherCookie });
  assert.equal(loaded.json.store.friends[0].name, "Sam");
});

test("a stale write returns the current store instead of overwriting it", async () => {
  const app = createApp({ env, storeDriver: createMemoryStore(validStore) });
  const cookie = await signIn(app);
  const result = await request(app, "/api/store", {
    method: "PUT",
    cookie,
    body: { store: { version: 1, friends: [], transactions: [] }, sha: "old" },
  });
  assert.equal(result.status, 409);
  assert.equal(result.json.store.friends[0].name, "Ben");
});

test("GitHub OAuth only issues a session for the allowed login", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("access_token")) {
      return new Response(JSON.stringify({ access_token: "gho_test" }), { status: 200 });
    }
    return new Response(JSON.stringify({ login: "someone-else" }), { status: 200 });
  };
  const app = createApp({ env, storeDriver: createMemoryStore(), fetchImpl });
  const start = await request(app, "/api/auth/login");
  assert.equal(start.status, 302);
  const location = start.response.headers.get("location");
  const state = new URL(location).searchParams.get("state");
  const callback = await request(app, `/api/auth/callback?code=abc&state=${state}`, {
    cookie: start.cookie,
  });
  assert.equal(callback.status, 302);
  assert.match(callback.response.headers.get("location"), /error=forbidden/);
  assert.equal(callback.cookie.includes(`${SESSION_COOKIE}=`), false);
});

test("GitHub OAuth signs the allowed user in", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("access_token")) {
      return new Response(JSON.stringify({ access_token: "gho_test" }), { status: 200 });
    }
    return new Response(JSON.stringify({ login: "hoffbrandm" }), { status: 200 });
  };
  const app = createApp({ env, storeDriver: createMemoryStore(), fetchImpl });
  const start = await request(app, "/api/auth/login");
  const state = new URL(start.response.headers.get("location")).searchParams.get("state");
  const callback = await request(app, `/api/auth/callback?code=abc&state=${state}`, {
    cookie: start.cookie,
  });
  assert.equal(callback.status, 302);
  assert.equal(new URL(callback.response.headers.get("location")).pathname, "/");
  assert.match(callback.cookie, new RegExp(`${SESSION_COOKIE}=`));
});

test("cross-origin writes are blocked", async () => {
  const app = createApp({ env, storeDriver: createMemoryStore() });
  const cookie = await signIn(app);
  const result = await request(app, "/api/store", {
    method: "PUT",
    cookie,
    origin: "https://evil.example",
    body: { store: validStore, sha: "mem-1" },
  });
  assert.equal(result.status, 403);
});
