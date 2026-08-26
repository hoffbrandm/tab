import test from "node:test";
import assert from "node:assert/strict";
import { createPersistQueue } from "../persist-queue.js";

test("applyLocal flips state and renders before persist runs", async () => {
  let persisted = 0;
  let persistStarted = false;
  const queue = createPersistQueue({
    persist: async () => {
      persistStarted = true;
      persisted += 1;
    },
    debounceMs: 40,
  });
  let flipped = false;
  let rendered = false;
  queue.applyLocal(() => { flipped = true; }, { render: () => { rendered = true; } });
  assert.equal(flipped, true);
  assert.equal(rendered, true);
  assert.equal(persistStarted, false);
  assert.equal(persisted, 0);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(persisted, 1);
});

test("rapid applyLocal queues one persist write", async () => {
  let persisted = 0;
  const queue = createPersistQueue({
    persist: async () => { persisted += 1; },
    debounceMs: 30,
  });
  queue.applyLocal(() => {});
  queue.applyLocal(() => {});
  queue.applyLocal(() => {});
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(persisted, 1);
});
