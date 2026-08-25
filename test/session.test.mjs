import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_KEY, createSession } from "../session.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) { return Object.hasOwn(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    data,
  };
}

test("session storage keeps only the sign-in credential", () => {
  const storage = memoryStorage();
  const session = createSession({ storage });
  session.write({ token: "gho_test", login: "hoffbrandm" });
  assert.deepEqual(session.read(), { token: "gho_test", login: "hoffbrandm" });
  const saved = JSON.parse(storage.getItem(SESSION_KEY));
  assert.equal(saved.token, "gho_test");
  assert.equal("friends" in saved, false);
  assert.equal("transactions" in saved, false);
});

test("a missing or corrupt session looks signed out", () => {
  const storage = memoryStorage({ [SESSION_KEY]: "{not-json" });
  const session = createSession({ storage });
  assert.equal(session.read(), null);
  session.write({ token: "gho_test", login: "hoffbrandm" });
  session.clear();
  assert.equal(session.read(), null);
  assert.equal(storage.getItem(SESSION_KEY), null);
});
