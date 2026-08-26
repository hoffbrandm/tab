import test from "node:test";
import assert from "node:assert/strict";
import { applyHouseholdImport, householdFromWorkbook, importHasData, reportLines } from "../workbook-import.js";
import { cashflowForMonth } from "../household.js";
import { parseStore } from "../store.js";
import { readXlsx } from "../xlsx.js";
import { buildWorkbookXlsx, fakeHouseholdWorkbook } from "./xlsx-fixture.mjs";

test("a synthetic workbook maps into household lines and keeps friend tabs", async () => {
  const bytes = buildWorkbookXlsx(fakeHouseholdWorkbook());
  const workbook = await readXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const { household, report } = householdFromWorkbook(workbook);

  assert.equal(report.incomes, 2);
  assert.equal(report.bills, 3);
  assert.ok(household.bills.some((item) => item.name === "Mortgage" && item.amountPence === 90000 && item.dueDay === 1));
  assert.ok(household.bills.some((item) => item.name === "Phone contract"));
  assert.equal(household.bills.some((item) => item.name === "MOT"), false);
  assert.equal(report.envelopes, 1);
  assert.equal(household.envelopes[0].weeklyPence, 7000);
  assert.equal(report.cardSubs, 1);
  assert.equal(report.cards, 1);
  assert.equal(household.cards[0].balancePence, 22000);
  assert.equal(report.pendings, 1);
  assert.equal(report.oneOffs, 2);
  assert.equal(household.oneOffs.find((item) => item.name === "MOT").estimatePence, 18000);
  assert.equal(report.annualBills, 1);
  assert.equal(household.annualBills[0].amountPence, 120000);
  assert.equal(report.pots, 2);
  assert.equal(household.pots.find((item) => item.name === "Emergency").amountPence, 150000);
  assert.equal(household.pots.find((item) => item.name === "Bills").amountPence, 40000);
  assert.equal(report.pensions, 1);
  assert.equal(household.pensions[0].name, "Workplace");
  assert.equal(report.payslips, 2);
  assert.equal(household.payslips.filter((item) => item.forecast).length, 1);
  assert.equal(household.payslips[0].otherDeductions[0].amountPence, 4000);
  assert.equal(household.payslips[0].taxCode, "1257L");
  assert.equal(report.donations, 1);
  assert.equal(household.donations[0].giftAid, true);
  assert.ok(report.skipped >= 1);

  const store = parseStore({
    version: 1,
    friends: [{ id: "ben", name: "Ben", email: "", createdAt: "2026-08-25T10:00:00.000Z" }],
    transactions: [],
    household,
  });
  assert.equal(store.friends[0].name, "Ben");
  const merged = applyHouseholdImport({
    version: 1,
    friends: store.friends,
    transactions: [{
      id: "tx-1",
      friendId: "ben",
      type: "expense",
      amountPence: 2000,
      paidBy: "me",
      description: "Coffee",
      date: "2026-08-25",
      createdAt: "2026-08-25T10:01:00.000Z",
      myShareAdjustmentPence: 0,
    }],
    household: store.household,
  }, household, { overwrite: true });
  assert.equal(merged.friends[0].name, "Ben");
  assert.equal(merged.transactions[0].description, "Coffee");
  assert.equal(merged.household.incomes.length, 2);

  const flow = cashflowForMonth(store.household, "2026-08", new Date("2026-08-10T12:00:00Z"));
  assert.equal(flow.incomePence, 430000);
  assert.ok(flow.pendingPence >= 6000);
  const summary = reportLines(report);
  assert.ok(summary.landed.some((item) => item[0] === "Income" && item[1] === 2));
  assert.equal(importHasData(report), true);
  assert.equal(importHasData({
    incomes: 0, bills: 0, envelopes: 0, cardSubs: 0, cards: 0, pendings: 0,
    oneOffs: 0, annualBills: 0, pots: 0, pensions: 0, payslips: 0, donations: 0, skipped: 2,
  }), false);
});
