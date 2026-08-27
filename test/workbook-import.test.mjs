import test from "node:test";
import assert from "node:assert/strict";
import { applyHouseholdImport, householdFromWorkbook, importHasData, reportLines } from "../workbook-import.js";
import { cashflowForMonth, payslipNetCheck } from "../household.js";
import { parseStore } from "../store.js";
import { readXlsx } from "../xlsx.js";
import { buildWorkbookXlsx, fakeHouseholdWorkbook } from "./xlsx-fixture.mjs";

async function importFake(sheets = fakeHouseholdWorkbook()) {
  const bytes = buildWorkbookXlsx(sheets);
  const workbook = await readXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return householdFromWorkbook(workbook);
}

test("a synthetic workbook maps into household lines and keeps friend tabs", async () => {
  const { household, report } = await importFake();

  assert.equal(report.incomes, 2);
  assert.equal(report.bills, 3);
  assert.ok(household.bills.some((item) => item.name === "Mortgage" && item.amountPence === 90000 && item.dueDay === 1));
  assert.ok(household.bills.some((item) => item.name === "Phone contract"));
  assert.equal(household.bills.some((item) => item.name === "MOT"), false);
  assert.equal(household.bills.some((item) => item.name === "Insurance saving"), false);
  assert.equal("paidMonths" in household.bills.find((item) => item.name === "Mortgage"), false);
  assert.equal(report.reserves, 3);
  assert.ok(household.reserves.some((item) => item.name === "Cleaner" && item.amountPence === 8000));
  assert.ok(household.reserves.some((item) => item.name === "Nails"));
  assert.ok(household.reserves.some((item) => item.name === "£30 a day"));
  assert.equal(household.reserves.some((item) => item.name === "Insurance saving"), false);
  assert.equal(household.pendings[0].note, "Flight hold");
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
  assert.match(household.pensions[0].note, /Alex/);
  assert.match(household.pensions[0].note, /8000/);
  assert.equal(JSON.stringify(household.pensions).includes("IGNORE-ME"), false);
  assert.equal(report.payslips, 2);
  assert.equal(household.payslips.filter((item) => item.forecast).length, 1);
  assert.equal(household.payslips[0].otherDeductions[0].amountPence, 4000);
  assert.equal(household.payslips[0].taxCode, "1257L");
  assert.equal(household.payslips[0].salaryPence, 350000);
  assert.equal(household.payslips[0].grossPence, 350000);
  assert.equal(household.payslips.some((item) => item.salaryPence === 9999900 || item.grossPence === 8888800), false);
  assert.equal(household.payslips[0].taxYear, "2026-27");
  assert.equal(report.donations, 1);
  assert.equal(household.donations[0].giftAid, true);
  assert.ok(report.skipped >= 4);
  assert.ok(report.skippedWhy.includes("Expected lookups"));
  assert.ok(report.skippedWhy.includes("annual reserve"));
  assert.ok(report.skippedWhy.includes("charity leftover"));

  const store = parseStore({
    version: 1,
    friends: [{ id: "ben", name: "Ben", email: "", createdAt: "2026-08-25T10:00:00.000Z" }],
    transactions: [],
    household,
  });
  assert.equal(store.friends[0].name, "Ben");
  const existingHousehold = {
    ...store.household,
    bills: [{ id: "keep-me", name: "Old bill", amountPence: 1000, dueDay: 1, paidMonths: [] }],
  };
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
    household: existingHousehold,
  }, household, { overwrite: true });
  assert.equal(merged.friends[0].name, "Ben");
  assert.equal(merged.transactions[0].description, "Coffee");
  assert.equal(merged.household.incomes.length, 2);
  assert.equal(merged.household.bills.some((item) => item.id === "keep-me"), false);

  const kept = applyHouseholdImport({
    version: 1,
    friends: store.friends,
    transactions: merged.transactions,
    household: existingHousehold,
  }, household, { overwrite: false });
  assert.equal(kept.friends[0].name, "Ben");
  assert.equal(kept.household.bills[0].id, "keep-me");

  const flow = cashflowForMonth(store.household, "2026-04", new Date("2026-04-10T12:00:00Z"));
  // Gross 3500 less tax 600, NI 280 and the 40 cycle scheme. The sacrifice is
  // already out of gross and SMP is parental, so neither moves take-home.
  assert.equal(flow.incomePence, 258000);

  // The sheet's own Net column is carried in as the stated net, so where the
  // sheet's maths and the app's disagree the slip says so instead of hiding it.
  const imported = store.household.payslips.find((slip) => slip.periodMonth === "2026-04");
  assert.equal(imported.statedNetPence, 242000);
  const check = payslipNetCheck(imported);
  assert.equal(check.matches, false);
  assert.equal(check.differencePence, 16000);
  assert.ok(store.household.payslips[0].otherDeductions.some((row) => row.label === "Smp" || row.label === "SMP"));
  assert.equal(store.household.payslips[0].otherDeductions.find((row) => /smp/i.test(row.label)).inNet, false);
  assert.ok(flow.pendingPence >= 6000);
  const summary = reportLines(report);
  assert.ok(summary.landed.some((item) => item[0] === "Income" && item[1] === 2));
  assert.ok(summary.skippedWhy.includes("Expected lookups"));
  assert.equal(importHasData(report), true);
  assert.equal(importHasData({
    incomes: 0, bills: 0, envelopes: 0, cardSubs: 0, cards: 0, pendings: 0,
    oneOffs: 0, annualBills: 0, pots: 0, pensions: 0, payslips: 0, donations: 0, reserves: 0, skipped: 2,
  }), false);
});

test("empty workbook does not count as household data", async () => {
  const { report } = await importFake({
    Main: [["What", "In and Out"]],
    Payslips: [["Name", "Tax Year"]],
    Annually: [["For what", "How much"]],
    "Where's the money": [["Pot"]],
    Charity: [["Who Gave", "Donation", "Amount"]],
  });
  assert.equal(importHasData(report), false);
});
