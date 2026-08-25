import test from "node:test";
import assert from "node:assert/strict";
import {
  GIST_DESCRIPTION,
  GIST_FILENAME,
  createGistStore,
  parseGistContent,
  pickGist,
  storeToGistContent,
} from "../gist-store.js";
import { emptyStore } from "../store.js";

const store = {
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

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("the gist is found by description, not a stored id", () => {
  const gists = [
    { id: "old", description: GIST_DESCRIPTION, updated_at: "2026-01-01T00:00:00Z", files: { [GIST_FILENAME]: {} } },
    { id: "other", description: "notes", updated_at: "2026-08-01T00:00:00Z", files: { [GIST_FILENAME]: {} } },
    { id: "fresh", description: GIST_DESCRIPTION, updated_at: "2026-08-25T00:00:00Z", files: { [GIST_FILENAME]: {} } },
  ];
  assert.equal(pickGist(gists).id, "fresh");
  assert.equal(pickGist([{ id: "x", description: "nope", files: {} }]), null);
});

test("store documents round-trip through gist file content", () => {
  const text = storeToGistContent(store);
  assert.match(text, /"version": 1/);
  assert.deepEqual(parseGistContent(text), store);
  assert.deepEqual(parseGistContent(""), emptyStore());
});

test("a first sign-in creates a private gist when none exists", async () => {
  const calls = [];
  const gist = createGistStore({
    token: "gho_test",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || "GET", body: init.body });
      if (String(url).endsWith("/user")) return jsonResponse(200, { login: "hoffbrandm" });
      if (String(url).includes("/gists?") && (init.method || "GET") === "GET") return jsonResponse(200, []);
      if (String(url).endsWith("/gists") && init.method === "POST") {
        const body = JSON.parse(init.body);
        assert.equal(body.public, false);
        assert.equal(body.description, GIST_DESCRIPTION);
        assert.ok(body.files[GIST_FILENAME].content);
        return jsonResponse(201, {
          id: "gist-1",
          public: false,
          description: GIST_DESCRIPTION,
          files: { [GIST_FILENAME]: { content: body.files[GIST_FILENAME].content } },
        });
      }
      throw new Error(`Unexpected ${init.method} ${url}`);
    },
  });
  assert.deepEqual(await gist.identify(), { login: "hoffbrandm" });
  const payload = await gist.read();
  assert.equal(payload.gistId, "gist-1");
  assert.deepEqual(payload.store, emptyStore());
  assert.equal(calls.some((call) => call.method === "POST"), true);
});

test("a later sign-in finds the existing gist and writes friends into it", async () => {
  const existing = {
    id: "gist-1",
    public: false,
    description: GIST_DESCRIPTION,
    updated_at: "2026-08-25T00:00:00Z",
    files: { [GIST_FILENAME]: { content: storeToGistContent(emptyStore()) } },
  };
  let written;
  const gist = createGistStore({
    token: "gho_test",
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes("/gists?") && (init.method || "GET") === "GET") return jsonResponse(200, [existing]);
      if (String(url).endsWith("/gists/gist-1") && init.method === "PATCH") {
        written = JSON.parse(init.body);
        return jsonResponse(200, { id: "gist-1" });
      }
      throw new Error(`Unexpected ${init.method} ${url}`);
    },
  });
  const loaded = await gist.read();
  assert.deepEqual(loaded.store.friends, []);
  const saved = await gist.write(store, loaded.gistId);
  assert.equal(saved.gistId, "gist-1");
  assert.equal(saved.store.friends[0].name, "Ben");
  assert.equal(written.public, false);
  assert.deepEqual(parseGistContent(written.files[GIST_FILENAME].content), store);
});

test("rejected tokens do not create or update a gist", async () => {
  const gist = createGistStore({
    token: "bad",
    fetchImpl: async () => jsonResponse(401, { message: "Bad credentials" }),
  });
  await assert.rejects(() => gist.identify(), (error) => error.status === 401);
});
