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

test("home sections default open and persist independently of ticks", () => {
  const storage = memoryStorage();
  const defaults = defaultHomeSectionState();
  assert.deepEqual(HOME_SECTION_IDS, ["income", "cards", "pending", "exceptions", "weeklies", "planned"]);
  assert.equal(defaults.planned, true);
  assert.equal(defaults.income, true);
  assert.deepEqual(readHomeSectionState(storage), defaults);

  writeHomeSectionOpen(storage, "pending", false);
  writeHomeSectionOpen(storage, "weeklies", false);
  const afterCollapse = readHomeSectionState(storage);
  assert.equal(afterCollapse.pending, false);
  assert.equal(afterCollapse.weeklies, false);
  assert.equal(afterCollapse.planned, true);

  const afterTick = readHomeSectionState(storage);
  assert.deepEqual(afterTick, afterCollapse);
  assert.equal(afterTick.planned, true);
});

test("unknown or corrupt accordion state falls back to open sections", () => {
  const storage = memoryStorage({ "tab.home-sections.v1": "{not-json" });
  assert.equal(readHomeSectionState(storage).cards, true);
  writeHomeSectionOpen(storage, "not-a-section", false);
  assert.equal(readHomeSectionState(storage).cards, true);
});
