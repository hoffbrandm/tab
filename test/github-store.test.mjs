import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubStore } from "../api/_lib/github-store.js";
import { HttpError } from "../api/_lib/http-error.js";

const store = {
  version: 1,
  friends: [{ id: "ben", name: "Ben", email: "", createdAt: "2026-08-25T10:00:00.000Z" }],
  transactions: [],
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("reads and decodes a GitHub contents document", async () => {
  const content = Buffer.from(`${JSON.stringify(store)}\n`, "utf8").toString("base64");
  const github = createGitHubStore({
    token: "token",
    repo: "hoffbrandm/tab",
    path: "data/tab.json",
    fetchImpl: async (url) => {
      assert.match(String(url), /repos\/hoffbrandm\/tab\/contents\/data\/tab\.json/);
      return jsonResponse(200, { encoding: "base64", content, sha: "abc123" });
    },
  });
  assert.deepEqual(await github.read(), { store, sha: "abc123" });
});

test("a missing file becomes an empty store", async () => {
  const github = createGitHubStore({
    token: "token",
    repo: "hoffbrandm/tab",
    path: "data/tab.json",
    fetchImpl: async () => jsonResponse(404, { message: "Not Found" }),
  });
  assert.deepEqual(await github.read(), { store: { version: 1, friends: [], transactions: [] }, sha: null });
});

test("writes the current store shape and skips CI", async () => {
  let written;
  const github = createGitHubStore({
    token: "token",
    repo: "hoffbrandm/tab",
    path: "data/tab.json",
    fetchImpl: async (url, init) => {
      written = JSON.parse(init.body);
      return jsonResponse(200, { content: { sha: "def456" } });
    },
  });
  const result = await github.write(store, "abc123");
  assert.equal(result.sha, "def456");
  assert.equal(written.sha, "abc123");
  assert.match(written.message, /\[skip ci\]/);
  assert.deepEqual(JSON.parse(Buffer.from(written.content, "base64").toString("utf8")), store);
});

test("a stale sha becomes a 409 with the current document", async () => {
  const content = Buffer.from(JSON.stringify(store), "utf8").toString("base64");
  const github = createGitHubStore({
    token: "token",
    repo: "hoffbrandm/tab",
    path: "data/tab.json",
    fetchImpl: async (url, init) => {
      if (init?.method === "PUT") return jsonResponse(422, { message: "sha mismatch" });
      return jsonResponse(200, { encoding: "base64", content, sha: "fresh" });
    },
  });
  await assert.rejects(() => github.write(store, "stale"), (error) => {
    assert.equal(error instanceof HttpError, true);
    assert.equal(error.status, 409);
    assert.deepEqual(error.extra, { store, sha: "fresh" });
    return true;
  });
});

test("rejected tokens surface as setup errors, not public writes", async () => {
  const github = createGitHubStore({
    token: "token",
    repo: "hoffbrandm/tab",
    path: "data/tab.json",
    fetchImpl: async () => jsonResponse(401, { message: "Bad credentials" }),
  });
  await assert.rejects(() => github.read(), (error) => error.status === 503);
});
