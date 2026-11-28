import test from "node:test";
import assert from "node:assert/strict";
import { modelTokensConflict } from "../inventory-model-tokens.js";
import { finalizeInventoryProposal, findExistingByName } from "../inventory-match.js";
import { understandUpdate } from "../inventory.js";

const fake2032 = {
  id: "bat2032",
  name: "CR2032 batteries",
  location: "Kitchen drawer",
  stock: "plenty",
  aliases: [],
  note: "",
  history: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const inv = { items: [fake2032] };

test("model codes: 2016 vs 2032 batteries conflict", () => {
  assert.equal(modelTokensConflict("2016 batteries", "CR2032 batteries"), true);
  assert.equal(modelTokensConflict("2025 batteries", "CR2032 batteries"), true);
  assert.equal(modelTokensConflict("2032 batteries", "CR2032 batteries"), false);
  assert.equal(modelTokensConflict("AA batteries", "AAA batteries"), true);
  assert.equal(modelTokensConflict("M3 screw", "M4 screw"), true);
  assert.equal(modelTokensConflict("1.75mm filament", "2.85mm filament"), true);
});

test("findExistingByName skips fuzzy match when model codes differ", () => {
  assert.equal(findExistingByName(inv, "2016 batteries"), null);
  const ok = findExistingByName(inv, "2032 batteries");
  assert.ok(ok?.item.id === "bat2032");
});

test("understandUpdate does not auto-bind 2016 to CR2032", () => {
  const got = understandUpdate("2016 batteries in the hall cupboard", inv);
  assert.equal(got.itemId, null);
  assert.equal(got.isNew, true);
  assert.match(got.name, /2016/i);
  assert.ok(got.candidates.some((row) => row.id === "bat2032"));
});

test("finalizeInventoryProposal defaults to new item with similar candidate", () => {
  const base = understandUpdate("CR2016 batteries in the drawer", inv);
  const p = finalizeInventoryProposal({ ...base }, inv);
  assert.equal(p.pickId, "new");
  assert.equal(p.itemId, null);
  assert.equal(p.isNew, true);
  assert.ok(p.candidates.length >= 1);
  assert.equal(p.candidates[0].id, "bat2032");
  assert.ok(p.showItemPicker);
});

test("finalizeInventoryProposal confident match still exposes new option", () => {
  const base = understandUpdate("CR2032 batteries in the shed", inv);
  const p = finalizeInventoryProposal({ ...base }, inv);
  assert.equal(p.pickId, "bat2032");
  assert.equal(p.itemId, "bat2032");
  assert.ok(p.showItemPicker);
});