import test from "node:test";
import assert from "node:assert/strict";
import {
  pensionHistoryRows,
  pensionLatest,
  pensionLegacySnapshots,
  pensionsTotalPence,
  pensionValuePence,
  removePensionValue,
  setPensionValue,
} from "../household.js";
import { parseStore } from "../store.js";
import { storeToGistContent } from "../gist-store.js";

const today = new Date("2026-11-17T12:00:00");

function storeWith(pensions) {
  return { version: 1, friends: [], transactions: [], household: { pensions } };
}

test("an old name-and-status pension loads unchanged with an empty history", () => {
  const parsed = parseStore(storeWith([{ id: "pen-1", name: "Workplace", status: "deferred", note: "Old job" }]), today);
  const pension = parsed.household.pensions[0];
  assert.equal(pension.name, "Workplace");
  assert.equal(pension.status, "deferred");
  assert.equal(pension.note, "Old job");
  assert.deepEqual(pension.snapshots, []);
  assert.equal("amountPence" in pension, false);
  assert.equal(pensionValuePence(pension), null);
});

test("an imported note with a dated value seeds one entry and keeps the note", () => {
  const note = "Alex · 2025-04-05 · £1234.56";
  const parsed = parseStore(storeWith([{ id: "pen-1", name: "Example scheme", status: "active", note }]), today);
  const pension = parsed.household.pensions[0];
  assert.equal(pension.note, note);
  assert.deepEqual(pension.snapshots, [{ month: "2025-04", amountPence: 123456, updatedOn: "2025-04-05" }]);
  assert.equal(pension.amountPence, 123456);
  assert.equal(pension.updatedOn, "2025-04-05");
});

test("a value without a date in the note is not guessed at", () => {
  assert.deepEqual(pensionLegacySnapshots({ note: "£500 a month" }), []);
});

test("a pension with a single amount becomes a one-entry history", () => {
  const dated = parseStore(storeWith([{ id: "a", name: "A", amountPence: 5000, updatedOn: "2026-03-02" }]), today);
  assert.deepEqual(dated.household.pensions[0].snapshots, [{ month: "2026-03", amountPence: 5000, updatedOn: "2026-03-02" }]);
  const undated = parseStore(storeWith([{ id: "b", name: "B", amountPence: 7000 }]), today);
  assert.deepEqual(undated.household.pensions[0].snapshots, [{ month: "2026-11", amountPence: 7000, updatedOn: "2026-11-17" }]);
});

test("an emptied history stays empty instead of re-reading the note", () => {
  const raw = storeWith([{ id: "pen-1", name: "Example", status: "active", note: "2025-04-05 · £10.00", snapshots: [] }]);
  const parsed = parseStore(raw, today);
  assert.deepEqual(parsed.household.pensions[0].snapshots, []);
});

test("updating today's value keeps earlier months and the round trip survives the gist", () => {
  let pension = { id: "pen-1", name: "Example", status: "active", note: "", snapshots: [] };
  pension = { ...pension, ...setPensionValue(pension, { date: "2026-09-30", amountPence: 100000 }) };
  pension = { ...pension, ...setPensionValue(pension, { date: "2026-11-17", amountPence: 110000 }) };
  assert.equal(pension.snapshots.length, 2);
  assert.equal(pension.amountPence, 110000);
  assert.equal(pension.updatedOn, "2026-11-17");
  // A second figure in the same month replaces that month, as pots do.
  pension = { ...pension, ...setPensionValue(pension, { date: "2026-11-20", amountPence: 111000 }) };
  assert.equal(pension.snapshots.length, 2);
  assert.equal(pensionLatest(pension).amountPence, 111000);

  const reloaded = parseStore(JSON.parse(storeToGistContent(storeWith([pension]))), today).household.pensions[0];
  assert.deepEqual(reloaded.snapshots, pension.snapshots);
  assert.equal(reloaded.amountPence, 111000);
});

test("a wrong entry can be moved or removed and the latest follows", () => {
  let pension = { snapshots: [] };
  pension = { ...pension, ...setPensionValue(pension, { date: "2026-08-01", amountPence: 9000 }) };
  pension = { ...pension, ...setPensionValue(pension, { date: "2026-10-01", amountPence: 99999 }) };
  pension = { ...pension, ...setPensionValue(pension, { date: "2026-10-03", amountPence: 9900, replaceMonth: "2026-10" }) };
  assert.equal(pensionValuePence(pension), 9900);
  pension = { ...pension, ...setPensionValue(pension, { date: "2026-09-03", amountPence: 9500, replaceMonth: "2026-10" }) };
  assert.deepEqual(pension.snapshots.map((item) => item.month), ["2026-08", "2026-09"]);
  pension = { ...pension, ...removePensionValue(pension, "2026-09") };
  assert.equal(pensionValuePence(pension), 9000);
  pension = { ...pension, ...removePensionValue(pension, "2026-08") };
  assert.equal(pensionValuePence(pension), null);
  assert.equal(pension.amountPence, undefined);
});

test("history reads newest first with the change since the entry before", () => {
  const rows = pensionHistoryRows({ snapshots: [
    { month: "2026-11", amountPence: 12000, updatedOn: "2026-11-17" },
    { month: "2026-09", amountPence: 10000, updatedOn: "2026-09-30" },
  ] });
  assert.deepEqual(rows.map((row) => [row.month, row.changePence]), [["2026-11", 2000], ["2026-09", null]]);
});

test("the pensions total uses each pension's latest value and skips ones without a value", () => {
  const total = pensionsTotalPence([
    { snapshots: [{ month: "2026-01", amountPence: 100 }, { month: "2026-10", amountPence: 300 }] },
    { snapshots: [] },
    { snapshots: [{ month: "2025-05", amountPence: 50 }] },
  ]);
  assert.equal(total, 350);
});

test("a negative or malformed pension value is refused", () => {
  assert.throws(() => setPensionValue({}, { date: "2026-11-17", amountPence: -1 }));
  assert.throws(() => setPensionValue({}, { date: "17/11/2026", amountPence: 1 }));
  assert.throws(() => parseStore(storeWith([{ id: "a", name: "A", amountPence: -5 }]), today));
});
