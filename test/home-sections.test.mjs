import test from "node:test";
import assert from "node:assert/strict";
import {
  HOME_SECTION_IDS,
  defaultHomeSectionState,
  readHomeSectionState,
  writeHomeSectionOpen,
} from "../home-sections.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) { return Object.hasOwn(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    data,
  };
}

test("home sections start collapsed and persist independently of ticks", () => {
  const storage = memoryStorage();
  const defaults = defaultHomeSectionState();
  assert.deepEqual(HOME_SECTION_IDS, ["income", "cards", "pending", "exceptions", "weeklies", "planned"]);
  // Home opens as the statement; the sections sit closed under it.
  assert.equal(defaults.planned, false);
  assert.equal(defaults.income, false);
  assert.deepEqual(readHomeSectionState(storage), defaults);

  writeHomeSectionOpen(storage, "pending", true);
  writeHomeSectionOpen(storage, "weeklies", true);
  const afterOpen = readHomeSectionState(storage);
  assert.equal(afterOpen.pending, true);
  assert.equal(afterOpen.weeklies, true);
  assert.equal(afterOpen.planned, false);

  const afterTick = readHomeSectionState(storage);
  assert.deepEqual(afterTick, afterOpen);
  assert.equal(afterTick.pending, true);
});

test("unknown or corrupt accordion state falls back to collapsed sections", () => {
  const storage = memoryStorage({ "tab.home-sections.v1": "{not-json" });
  assert.equal(readHomeSectionState(storage).cards, false);
  writeHomeSectionOpen(storage, "not-a-section", true);
  assert.equal(readHomeSectionState(storage).cards, false);
});
