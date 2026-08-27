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

test("a second applyLocal is not dropped while a write is outstanding", async () => {
  const flipped = [];
  const queue = createPersistQueue({
    persist: async () => {},
    debounceMs: 30,
  });
  queue.applyLocal(() => flipped.push("first"));
  queue.applyLocal(() => flipped.push("second"));
  assert.deepEqual(flipped, ["first", "second"]);
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

test("a failed write does not escape the timer and the next change still writes", async () => {
  const attempts = [];
  const queue = createPersistQueue({
    persist: async () => {
      attempts.push(attempts.length);
      if (attempts.length === 1) throw new Error("Gist is unreachable.");
    },
    debounceMs: 20,
  });
  const rejections = [];
  const onRejection = (error) => rejections.push(error);
  process.on("unhandledRejection", onRejection);
  try {
    queue.applyLocal(() => {});
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(attempts.length, 1);

    queue.applyLocal(() => {});
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(attempts.length, 2);
    assert.deepEqual(rejections, []);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("flush resolves rather than rejecting when the write fails", async () => {
  const queue = createPersistQueue({
    persist: async () => { throw new Error("Gist is unreachable."); },
    debounceMs: 5,
  });
  queue.schedule();
  await assert.doesNotReject(() => queue.flush());
});
