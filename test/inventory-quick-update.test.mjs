import test from "node:test";
import assert from "node:assert/strict";
import {
  INV_QUICK_PLACEHOLDER,
  emptyQuickUpdateState,
  inlineUpdateConfirm,
} from "../inventory-quick-update.js";
import { understandUpdate } from "../inventory.js";
import { understandUpdateSmart } from "../inventory-ai.js";

test("inline update placeholder is set for the top box", () => {
  assert.match(INV_QUICK_PLACEHOLDER, /3D printer filament/i);
});

test("emptyQuickUpdateState starts idle with no proposal", () => {
  const s = emptyQuickUpdateState();
  assert.equal(s.phase, "idle");
  assert.equal(s.proposal, null);
});

test("inlineUpdateConfirm only when confirming", () => {
  assert.equal(inlineUpdateConfirm(emptyQuickUpdateState()), null);
  const confirming = {
    phase: "confirm",
    proposal: { name: "Hooks" },
    text: "hooks in the kitchen",
    draftText: "",
    error: "",
  };
  assert.equal(inlineUpdateConfirm(confirming)?.proposal.name, "Hooks");
});

test("rules path still parses filament sample for inline flow", async () => {
  const said = "3D printer filament, it belongs in the office, but we don't have any";
  const rules = understandUpdate(said, { items: [] });
  assert.equal(rules.name, "3D printer filament");
  assert.equal(rules.stock, "out");
  const smart = await understandUpdateSmart(said, { items: [] }, {
    settings: { apiKey: "", smartUnderstanding: true, provider: "gemini", geminiModel: "gemini-3.5-flash-lite" },
  });
  assert.equal(smart.source, "rules");
  assert.equal(smart.proposal.location, rules.location);
});