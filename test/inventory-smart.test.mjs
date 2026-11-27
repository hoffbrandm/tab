import test from "node:test";
import assert from "node:assert/strict";
import { understandUpdate } from "../inventory.js";
import {
  proposalsFromAiPayload,
  proposalFromShortcutJson,
  validateUpdatePayload,
} from "../inventory-understand-schema.js";
import {
  ONDEVICE_MODEL_ID,
  setEngineForTests,
  webGpuUsable,
} from "../inventory-ondevice.js";
import {
  onDeviceMarkedInstalled,
  readAiSettings,
  writeAiSettings,
} from "../inventory-ai-settings.js";
import { understandUpdateSmart, withTimeout } from "../inventory-ai.js";
import { UPDATE_CASES } from "./inventory-fixtures.mjs";

const storage = new Map();
const mockStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};

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

test("mocked on-device JSON maps to proposal", () => {
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

test("understandUpdateSmart uses rules without model", async () => {
  storage.clear();
  writeAiSettings(mockStorage, { onDeviceInstalled: false, cloudFallback: false });
  const result = await understandUpdateSmart("We've run out of bin bags", {
    items: [{ id: "d", name: "Bin bags", location: "Under the sink", stock: "plenty", updatedAt: "" }],
  }, { settings: readAiSettings(mockStorage) });
  assert.equal(result.source, "rules");
  assert.equal(result.proposal.name, "Bin bags");
});

test("understandUpdateSmart uses mock on-device engine", async () => {
  storage.clear();
  onDeviceMarkedInstalled(mockStorage);
  const mockEngine = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({
            changes: [{
              action: "move",
              item: "AA batteries",
              place: ["Kitchen", "Drawer"],
              stock: "unchanged",
              note: "",
            }],
          }) } }],
        }),
      },
    },
  };
  setEngineForTests(mockEngine);
  const inv = {
    items: [{ id: "c", name: "AA batteries", location: "Hall", stock: "low", updatedAt: "" }],
  };
  const nav = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", { value: { ...nav, gpu: {} }, configurable: true });
  const result = await understandUpdateSmart("batteries in the kitchen drawer", inv, {
    settings: { ...readAiSettings(mockStorage), onDeviceInstalled: true, cloudFallback: false },
  });
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  assert.equal(result.source, "on-device");
  assert.equal(result.proposal.location, "Kitchen › Drawer");
});

test("shortcut URL payload maps to check card fields", () => {
  const json = JSON.stringify({ name: "3D printer filament", location: "Office", stock: "out" });
  const p = proposalFromShortcutJson(json, { items: [] });
  assert.equal(p.stock, "out");
  assert.equal(p.location, "Office");
});

test("on-device model id is under ~1GB class", () => {
  assert.match(ONDEVICE_MODEL_ID, /Llama-3\.2-1B/);
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
  const multi = understandUpdate(
    "I put the hooks in the drawer and the glue in the garage",
    { items: houseItems },
  );
  const total = UPDATE_CASES.length + 2;
  // Log table for agents / CI logs.
  console.log(JSON.stringify({
    benchmark: "inventory-understanding",
    rules: { correct: hits, total, pct: Number((100 * hits / total).toFixed(1)) },
    onDevice: "requires WebGPU download on device",
    cloud: "skipped without key",
    multiItemFirst: multi.name,
  }));
  assert.ok(hits >= UPDATE_CASES.length, `rules should match all ${UPDATE_CASES.length} canned cases`);
});

test("withTimeout rejects slow work", async () => {
  await assert.rejects(
    () => withTimeout(new Promise((resolve) => setTimeout(resolve, 50)), 5),
    /timeout/,
  );
});

test("webGpuUsable is false in node", () => {
  assert.equal(webGpuUsable({ navigator: {} }), false);
});