import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../api/_lib/file-store.js";
import { HttpError } from "../api/_lib/http-error.js";

const store = {
  version: 1,
  friends: [{ id: "ben", name: "Ben", email: "", createdAt: "2026-08-25T10:00:00.000Z" }],
  transactions: [],
};

test("file store writes the same JSON document and detects stale writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tab-"));
  const filePath = join(directory, "tab.json");
  const driver = createFileStore({ filePath });
  const created = await driver.write(store, null);
  const text = await readFile(filePath, "utf8");
  assert.deepEqual(JSON.parse(text), store);
  const loaded = await driver.read();
  assert.equal(loaded.sha, created.sha);
  await assert.rejects(() => driver.write({ version: 1, friends: [], transactions: [] }, "stale"), (error) => {
    assert.equal(error instanceof HttpError, true);
    assert.equal(error.status, 409);
    return true;
  });
});
