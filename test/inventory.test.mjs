import test from "node:test";
import assert from "node:assert/strict";
import {
  applyUpdate,
  consolidateInventory,
  detectStock,
  findExistingByName,
  formatLocation,
  LOW_STOCK_COUNT_THRESHOLD,
  mergeInventories,
  normaliseItemKey,
  parseInventory,
  removeItem,
  searchItems,
  shoppingList,
  splitSearchResults,
  understandSearch,
  understandUpdate,
} from "../inventory.js";
import { addMishearAlias, autocorrectDictation, rankItemsEnhanced } from "../inventory-match.js";
import { createInventoryStore } from "../inventory-store.js";
import { listen, speechSupported } from "../inventory-speech.js";
import { UPDATE_CASES } from "./inventory-fixtures.mjs";

// Made-up household, not anyone's real one.
const house = () => parseInventory({
  version: 1,
  items: [
    { id: "a", name: "Small picture hooks", location: "Cupboard upstairs › X box", stock: "plenty", updatedAt: "2026-11-20T10:00:00Z" },
    { id: "b", name: "Coat hooks", location: "Garage › Toolbox", stock: "low", updatedAt: "2026-11-19T10:00:00Z" },
    { id: "c", name: "AA batteries", location: "Kitchen drawer", stock: "low", updatedAt: "2026-11-18T10:00:00Z" },
    { id: "d", name: "Bin bags", location: "Under the sink", stock: "plenty", updatedAt: "2026-11-17T10:00:00Z" },
    { id: "e", name: "Light bulbs", location: "Hall cupboard", stock: "plenty", updatedAt: "2026-11-16T10:00:00Z" },
    { id: "f", name: "Nappies", location: "Nursery › Changing unit", stock: "plenty", updatedAt: "2026-11-15T10:00:00Z" },
    { id: "g", name: "Superglue", location: "Kitchen drawer", stock: "plenty", updatedAt: "2026-11-14T10:00:00Z" },
  ],
});

for (const [said, name, id, location, stock] of UPDATE_CASES) {
  test(`update: ${said}`, () => {
    const got = understandUpdate(said, house(), { lastItemId: "e" });
    assert.equal(got.name, name);
    assert.equal(got.itemId, id);
    assert.equal(got.location, location);
    assert.equal(got.stock, stock);
  });
}

test("an empty inventory still reads his first sentence", () => {
  const got = understandUpdate("I have put small picture hooks into the cupboard upstairs into the X box", parseInventory({}));
  assert.equal(got.name, "Small picture hooks");
  assert.equal(got.isNew, true);
  assert.equal(got.location, "Cupboard upstairs › X box");
});

test("'here' asks where rather than guessing, and two hooks are flagged as a close call", () => {
  const here = understandUpdate("Put the picture hooks here, we've got loads", house());
  assert.equal(here.locationIsHere, true);
  const hooks = understandUpdate("I put the hooks back in the kitchen drawer", house());
  assert.equal(hooks.ambiguous, true);
  assert.deepEqual(hooks.candidates.map((row) => row.name).sort(), ["Coat hooks", "Small picture hooks"]);
});

test("stock words", () => {
  const cases = { "we've got loads": "plenty", "plenty left": "plenty", "lots of them": "plenty", "only one left": "low", "a few left": "low", "running out": "low", "nearly run out": "low", "we've run out": "out", "none left": "out", "they're finished": "out", "running low": "low", "only a couple of those left": "low" };
  for (const [text, level] of Object.entries(cases)) assert.equal(detectStock(text)?.level, level, text);
  assert.equal(detectStock("only 2 left").count, 2);
});

test("counts above the low threshold stay plenty with a note", () => {
  assert.equal(LOW_STOCK_COUNT_THRESHOLD, 5);
  const eight = understandUpdate("Spare keys in the hall, about 8 left", house());
  assert.equal(eight.stock, "plenty");
  assert.equal(eight.note, "About 8 left");
  const three = understandUpdate("Put the nappies back, only 3 left", house());
  assert.equal(three.stock, "low");
});

test("filler words and compound places stay out of the item name", () => {
  const got = understandUpdate(
    "um like basically I put the spare batteries in the blue box on the top shelf of the hall cupboard we have about 8 left",
    parseInventory({}),
  );
  assert.equal(got.name, "Spare batteries");
  assert.equal(got.stock, "plenty");
  assert.match(got.location, /Hall cupboard/i);
  assert.match(got.location, /Blue box/i);
});

test("took out, used the last, half a box and a handful", () => {
  const took = understandUpdate("took the drill out of the garage", house());
  assert.equal(took.name, "Drill");
  assert.equal(took.location, "");
  assert.equal(took.tookOut, true);
  const tape = understandUpdate("we used the last of the tape", house());
  assert.equal(tape.stock, "out");
  assert.equal(tape.name, "Tape");
  const screws = understandUpdate("half a box of screws in the garage", house());
  assert.equal(screws.name, "Screws");
  assert.equal(screws.stock, "plenty");
  const nails = understandUpdate("a handful of nails left in the toolbox", house());
  assert.equal(nails.name, "Nails");
  assert.equal(nails.stock, "low");
});

test("two items in one sentence asks to split", () => {
  const got = understandUpdate("I put the hooks in the drawer and the glue in the garage", house());
  assert.equal(got.needsSplit, true);
});

test("search understands indirect household uses", () => {
  const inv = parseInventory({
    items: [
      { id: "c1", name: "Bathroom spray", location: "Under the sink", stock: "plenty", updatedAt: "2026-11-20T10:00:00Z" },
      { id: "c2", name: "AA batteries", location: "Kitchen drawer", stock: "plenty", updatedAt: "2026-11-19T10:00:00Z" },
    ],
  });
  const clean = searchItems(inv, understandSearch("something to clean the bathroom"));
  assert.ok(clean.results.length, "clean the bathroom");
  assert.equal(clean.results[0].item.name, "Bathroom spray");
  const power = searchItems(inv, understandSearch("need batteries for the remote"));
  assert.equal(power.results[0].item.name, "AA batteries");
});

test("nested places read outer first", () => {
  assert.equal(formatLocation("in the X box in the cupboard upstairs"), "Cupboard upstairs › X box");
  assert.equal(formatLocation("under the stairs"), "Under the stairs");
});

// [query, expected first suggestion, "best" or "dym"]
export const SEARCH_CASES = [
  ["where are the hooks", ["Coat hooks", "Small picture hooks"], "dym"],
  ["I'm looking for something to hang a picture", ["Small picture hooks"], "dym"],
  ["hoks", ["Coat hooks", "Small picture hooks"], "dym"],
  ["do we have any batteries?", ["AA batteries"], "dym"],
  ["where did I put the glue", ["Superglue"], "dym"],
  ["light bulb", ["Light bulbs"], "best"],
  ["nappy", ["Nappies"], "best"],
  ["where are the small picture hooks", ["Small picture hooks"], "best"],
];

for (const [query, names, where] of SEARCH_CASES) {
  test(`search: ${query}`, () => {
    const { best, didYouMean } = splitSearchResults(searchItems(house(), understandSearch(query)).results);
    const list = where === "best" ? best : didYouMean;
    assert.ok(list.length, `nothing under ${where}`);
    assert.ok(names.includes(list[0].item.name), `${list[0].item.name} first`);
  });
}

test("what's in a place lists the place", () => {
  const found = searchItems(house(), understandSearch("what's in the kitchen drawer"));
  assert.equal(found.mode, "place");
  assert.deepEqual(found.results.map((row) => row.item.name).sort(), ["AA batteries", "Superglue"]);
});

test("updates keep history, bought goes back to plenty, the shopping list is low and out", () => {
  const inv = house();
  applyUpdate(inv, { itemId: "a", name: "Small picture hooks", location: "Kitchen drawer", stock: "low" }, { now: new Date("2026-11-27T10:00:00Z") });
  const hooks = inv.items.find((item) => item.id === "a");
  assert.equal(hooks.history[0].location, "Kitchen drawer");
  assert.equal(hooks.updatedAt, "2026-11-27T10:00:00.000Z");
  assert.deepEqual(shoppingList(inv).map((item) => item.name), ["AA batteries", "Coat hooks", "Small picture hooks"]);
});

test("merging two phones keeps the newer copy and honours deletions", () => {
  const phoneA = house();
  const phoneB = house();
  applyUpdate(phoneA, { itemId: "c", name: "AA batteries", location: "Kitchen drawer", stock: "plenty" }, { now: new Date("2026-11-27T10:00:00Z") });
  removeItem(phoneB, "d", new Date("2026-11-27T11:00:00Z"));
  applyUpdate(phoneB, { name: "Matches", location: "Kitchen drawer", stock: "low" }, { now: new Date("2026-11-27T11:00:00Z"), id: "m" });
  const merged = mergeInventories(phoneA, phoneB, new Date("2026-11-27T12:00:00Z"));
  assert.equal(merged.items.find((item) => item.id === "c").stock, "plenty");
  assert.equal(merged.items.some((item) => item.id === "d"), false);
  assert.equal(merged.items.some((item) => item.id === "m"), true);
});

test("a bad item is dropped, not fatal", () => {
  const inv = parseInventory({ items: [null, { id: "x" }, { id: "y", name: "Tape", stock: "weird" }] });
  assert.deepEqual(inv.items.map((item) => [item.name, item.stock]), [["Tape", "plenty"]]);
});

test("the inventory is its own gist file: writes touch inventory.json only, and never over an unreadable one", async () => {
  const calls = [];
  let content = null;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body });
    if (init.method === "PATCH") {
      content = JSON.parse(init.body).files["inventory.json"].content;
      return new Response("{}", { status: 200 });
    }
    const files = { "tab.json": { content: "{}" } };
    if (content) files["inventory.json"] = { content };
    return new Response(JSON.stringify({ id: "g", files }), { status: 200 });
  };
  const client = createInventoryStore({ token: "t", fetchImpl });
  assert.equal((await client.read("g")).exists, false);
  await client.write(house(), "g");
  const patch = calls.find((call) => call.method === "PATCH");
  assert.deepEqual(Object.keys(JSON.parse(patch.body).files), ["inventory.json"]);
  assert.equal(JSON.parse(patch.body).public, undefined);
  assert.equal((await client.read("g")).inventory.items.length, 7);
  content = "{not json";
  await assert.rejects(client.write(house(), "g"), /not valid JSON/);
});

test("normalised names dedupe: printer paper twice becomes one item", () => {
  const inv = parseInventory({
    version: 1,
    items: [{ id: "p1", name: "Printer paper", location: "Office", stock: "plenty", updatedAt: "2026-11-27T10:00:00Z" }],
  });
  applyUpdate(inv, { name: "printer papers", location: "Office drawer", stock: "low" }, { now: new Date("2026-11-27T11:00:00Z") });
  assert.equal(inv.items.length, 1);
  assert.equal(inv.items[0].name, "Printer paper");
  assert.equal(inv.items[0].stock, "low");
});

test("Printer paper. and printer papers share one normalised key", () => {
  assert.equal(normaliseItemKey("Printer paper."), normaliseItemKey("printer papers"));
  assert.equal(normaliseItemKey("3-D printer filament"), normaliseItemKey("3D printer filaments"));
});

test("consolidate on load merges identical normalised names", () => {
  const raw = parseInventory({
    version: 1,
    items: [
      { id: "a", name: "Printer paper", location: "Office", stock: "plenty", updatedAt: "2026-11-27T10:00:00Z", aliases: [] },
      { id: "b", name: "printer papers", location: "Garage", stock: "low", updatedAt: "2026-11-28T10:00:00Z", aliases: [] },
    ],
  });
  const merged = consolidateInventory(raw);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].stock, "low");
  assert.equal(merged.items[0].location, "Garage");
});

test("misheard 3d printed complement matches filament item and learns alias", () => {
  const inv = parseInventory({
    version: 1,
    items: [{ id: "f", name: "3D printer filament", location: "Office", stock: "plenty", updatedAt: "2026-11-27T10:00:00Z" }],
  });
  const corrected = autocorrectDictation("3d printed complement", inv);
  assert.match(corrected, /printer filament/);
  const ranked = rankItemsEnhanced(corrected, inv.items);
  assert.ok(ranked[0].score >= 0.78);
  assert.equal(ranked[0].item.name, "3D printer filament");
  const got = understandUpdate("I put the 3d printed complement in the office drawer", inv);
  assert.equal(got.itemId, "f");
  const aliases = addMishearAlias(inv.items[0], "3d printed complement", "3D printer filament");
  applyUpdate(inv, { itemId: "f", name: "3D printer filament", location: "Office drawer", stock: "plenty", learnAlias: "3d printed complement" });
  assert.ok(inv.items[0].aliases.includes("3d printed complement"));
  const next = understandUpdate("put 3d printed complement upstairs", inv);
  assert.equal(next.itemId, "f");
});

test("findExistingByName catches near duplicates", () => {
  const inv = parseInventory({
    version: 1,
    items: [{ id: "p", name: "Printer paper", location: "Office", stock: "plenty", updatedAt: "2026-11-27T10:00:00Z" }],
  });
  assert.equal(findExistingByName(inv, "Printer paper.").item.id, "p");
});

test("speech: absent API is reported, a silent session is stopped by the watchdog", async () => {
  assert.equal(speechSupported({}), false);
  let error = "";
  listen({ win: {}, onError: (code) => { error = code; } });
  assert.equal(error, "service-not-allowed");
  class Silent { start() { this.onstart?.(); } stop() { this.onend?.(); } abort() { this.onend?.(); } }
  const errors = [];
  listen({ win: { webkitSpeechRecognition: Silent }, onError: (code) => errors.push(code), nothingMs: 20 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(errors, ["no-speech"]);
});
