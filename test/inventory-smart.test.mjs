import test from "node:test";
import assert from "node:assert/strict";
import { understandUpdate } from "../inventory.js";
import {
  proposalsFromAiPayload,
  validateUpdatePayload,
} from "../inventory-understand-schema.js";
import { AI_MODEL_IDS, readAiSettings, writeAiSettings } from "../inventory-ai-settings.js";
import { inventoryClickRoutedGlobally } from "../inventory-ui-actions.js";
import { understandUpdateSmart, withTimeout } from "../inventory-ai.js";
import { UPDATE_CASES } from "./inventory-fixtures.mjs";

const storage = new Map();
const mockStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};

test("inv-ai-settings is not swallowed by handleInventoryClick", () => {
  assert.equal(inventoryClickRoutedGlobally("inv-ai-settings"), true);
  assert.equal(inventoryClickRoutedGlobally("inv-ai-test-key"), true);
  assert.equal(inventoryClickRoutedGlobally("inv-update"), false);
});

test("screenshot sentence: 3D filament, office, run out (rules)", () => {
  const said = "3D printer filament, it belongs in the office, but we don't have any";
  const got = understandUpdate(said, { items: [] });
  assert.equal(got.name, "3D printer filament");
  assert.equal(got.location, "Office");
  assert.equal(got.stock, "out");
});

test("validateUpdatePayload enforces schema", () => {
  const ok = validateUpdatePayload({
    changes: [{ action: "add", item: "Hooks", place: ["Kitchen", "Drawer"], stock: "low", note: "" }],
  });
  assert.ok(ok);
  assert.equal(validateUpdatePayload({ changes: [{ action: "nope", item: "x" }] }), null);
});

test("mocked Gemini JSON maps to proposal", () => {
  const payload = validateUpdatePayload({
    changes: [{
      action: "add",
      item: "3D printer filament",
      place: ["Office"],
      stock: "out",
      note: "",
    }],
  });
  const [proposal] = proposalsFromAiPayload(payload, { items: [] }, "dictated");
  assert.equal(proposal.name, "3D printer filament");
  assert.equal(proposal.location, "Office");
  assert.equal(proposal.stock, "out");
});

test("understandUpdateSmart uses rules without API key", async () => {
  storage.clear();
  writeAiSettings(mockStorage, { apiKey: "", smartUnderstanding: true });
  const result = await understandUpdateSmart("We've run out of bin bags", {
    items: [{ id: "d", name: "Bin bags", location: "Under the sink", stock: "plenty", updatedAt: "" }],
  }, { settings: readAiSettings(mockStorage) });
  assert.equal(result.source, "rules");
  assert.equal(result.proposal.name, "Bin bags");
});

test("understandUpdateSmart uses mock Gemini fetch", async () => {
  storage.clear();
  writeAiSettings(mockStorage, { provider: "gemini", apiKey: "test-key", smartUnderstanding: true });
  const fetchImpl = async (url, init) => ({
    ok: true,
    async json() {
      return {
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({
              changes: [{
                action: "move",
                item: "AA batteries",
                place: ["Kitchen", "Drawer"],
                stock: "unchanged",
                note: "",
              }],
            }) }],
          },
        }],
      };
    },
    async text() { return ""; },
  });
  const inv = {
    items: [{ id: "c", name: "AA batteries", location: "Hall", stock: "low", updatedAt: "" }],
  };
  const result = await understandUpdateSmart("batteries in the kitchen drawer", inv, {
    settings: readAiSettings(mockStorage),
    fetchImpl,
  });
  assert.equal(result.source, "gemini");
  assert.equal(result.proposal.location, "Kitchen › Drawer");
});

test("primary Gemini model id", () => {
  assert.equal(AI_MODEL_IDS.gemini, "gemini-2.5-flash-lite");
});

test("benchmark: rules accuracy on update utterances", () => {
  const houseItems = [
    { id: "a", name: "Small picture hooks", location: "Cupboard upstairs › X box", stock: "plenty", updatedAt: "" },
    { id: "b", name: "Coat hooks", location: "Garage › Toolbox", stock: "low", updatedAt: "" },
    { id: "c", name: "AA batteries", location: "Kitchen drawer", stock: "low", updatedAt: "" },
    { id: "d", name: "Bin bags", location: "Under the sink", stock: "plenty", updatedAt: "" },
    { id: "e", name: "Light bulbs", location: "Hall cupboard", stock: "plenty", updatedAt: "" },
    { id: "f", name: "Nappies", location: "Nursery › Changing unit", stock: "plenty", updatedAt: "" },
    { id: "g", name: "Superglue", location: "Kitchen drawer", stock: "plenty", updatedAt: "" },
  ];
  let hits = 0;
  for (const [said, name, , location, stock] of UPDATE_CASES) {
    const got = understandUpdate(said, { items: houseItems }, { lastItemId: "e" });
    if (got.name === name && got.location === location && got.stock === stock) hits += 1;
  }
  const extra = understandUpdate(
    "3D printer filament, it belongs in the office, but we don't have any",
    { items: [] },
  );
  if (extra.name === "3D printer filament" && extra.location === "Office" && extra.stock === "out") hits += 1;
  console.log(JSON.stringify({
    benchmark: "inventory-understanding",
    rules: { correct: hits, total: UPDATE_CASES.length + 1, pct: Number((100 * hits / (UPDATE_CASES.length + 1)).toFixed(1)) },
    gemini: "live when API key set",
    onDevice: "not shipped",
  }));
  assert.ok(hits >= UPDATE_CASES.length);
});

test("withTimeout rejects slow work", async () => {
  await assert.rejects(
    () => withTimeout(new Promise((resolve) => setTimeout(resolve, 50)), 5),
    /timeout/,
  );
});