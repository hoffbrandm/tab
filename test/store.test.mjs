import test from "node:test";
import assert from "node:assert/strict";
import { emptyHousehold } from "../household.js";
import { emptyStore, parseStore, StoreError } from "../store.js";

const friend = {
  id: "ben",
  name: "Ben",
  email: "ben@example.com",
  createdAt: "2026-08-25T10:00:00.000Z",
};

const expense = {
  id: "tx-1",
  friendId: "ben",
  type: "expense",
  amountPence: 10000,
  paidBy: "me",
  description: "Dinner",
  date: "2026-08-25",
  createdAt: "2026-08-25T10:01:00.000Z",
  myShareAdjustmentPence: 0,
};

test("empty store is the current document shape", () => {
  assert.deepEqual(emptyStore(), { version: 1, friends: [], transactions: [], household: emptyHousehold() });
});

test("a v1 gist without household still loads and gains an empty household", () => {
  const parsed = parseStore({
    version: 1,
    friends: [friend],
    transactions: [expense],
  });
  assert.deepEqual(parsed.household, emptyHousehold());
  assert.equal(parsed.friends[0].name, "Ben");
});

test("household lines are normalised and unknown fields are dropped", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      people: [{ id: "you", name: "  Alex  ", niNumber: "drop-this" }],
      incomes: [{ id: "in-1", personId: "you", label: " Take-home ", amountPence: 250000, extra: true }],
      bills: [{ id: "b-1", name: "Mortgage", amountPence: 120000, dueDay: 1, paidMonths: ["2026-08"] }],
      envelopes: [],
      cards: [],
      cardSubs: [],
      oneOffs: [{ id: "o-1", name: "MOT", month: "2026-08", estimatePence: 40000, purchased: false }],
      annualBills: [{ id: "a-1", name: "Insurance", amountPence: 240000, month: 6 }],
      pots: [{ id: "p-1", name: "Emergency", amountPence: 100000, updatedOn: "2026-08-01" }],
      pensions: [{ id: "pen-1", name: "Workplace", status: "active", note: "", policyNumber: "nope" }],
      payslips: [],
      donations: [{
        id: "d-1",
        who: "Alex",
        charity: "Example",
        date: "2026-05-02",
        amountPence: 2000,
        giftAid: true,
      }],
    },
  });
  assert.equal(parsed.household.people[0].name, "Alex");
  assert.equal("niNumber" in parsed.household.people[0], false);
  assert.equal("policyNumber" in parsed.household.pensions[0], false);
  assert.equal(parsed.household.incomes[0].label, "Take-home");
  assert.equal(parsed.household.annualBills[0].month, 6);
});

test("household amounts must be whole pence", () => {
  assert.throws(() => parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: { ...emptyHousehold(), bills: [{ id: "b-1", name: "Gas", amountPence: 10.5, dueDay: 1 }] },
  }), StoreError);
});

test("a valid store is normalised", () => {
  const parsed = parseStore({
    version: 1,
    friends: [{ ...friend, name: "  Ben  ", extra: "drop" }],
    transactions: [{ ...expense, description: " Dinner " }],
  });
  assert.equal(parsed.friends[0].name, "Ben");
  assert.equal(parsed.friends[0].email, "ben@example.com");
  assert.equal(parsed.transactions[0].description, "Dinner");
  assert.equal(parsed.transactions[0].myShareAdjustmentPence, 0);
  assert.equal("extra" in parsed.friends[0], false);
});

test("unsupported versions are rejected", () => {
  assert.throws(() => parseStore({ version: 2, friends: [], transactions: [] }), StoreError);
});

test("missing collections are rejected", () => {
  assert.throws(() => parseStore({ version: 1, friends: [] }), StoreError);
});

test("duplicate friend ids are rejected", () => {
  assert.throws(() => parseStore({ version: 1, friends: [friend, { ...friend, name: "Benny" }], transactions: [] }), StoreError);
});

test("orphan transactions are rejected", () => {
  assert.throws(() => parseStore({ version: 1, friends: [], transactions: [expense] }), StoreError);
});

test("invalid money and dates are rejected", () => {
  assert.throws(() => parseStore({ version: 1, friends: [friend], transactions: [{ ...expense, amountPence: 10.5 }] }), StoreError);
  assert.throws(() => parseStore({ version: 1, friends: [friend], transactions: [{ ...expense, date: "25/08/2026" }] }), StoreError);
});

test("expense adjustments must keep both shares at zero or more", () => {
  assert.throws(
    () => parseStore({ version: 1, friends: [friend], transactions: [{ ...expense, myShareAdjustmentPence: 10000 }] }),
    StoreError,
  );
  const parsed = parseStore({
    version: 1,
    friends: [friend],
    transactions: [{ ...expense, myShareAdjustmentPence: -200 }],
  });
  assert.equal(parsed.transactions[0].myShareAdjustmentPence, -200);
});

test("repayments do not keep a share adjustment", () => {
  const parsed = parseStore({
    version: 1,
    friends: [friend],
    transactions: [{ ...expense, id: "tx-2", type: "repayment", myShareAdjustmentPence: 50 }],
  });
  assert.equal("myShareAdjustmentPence" in parsed.transactions[0], false);
});

test("older bills and card subs become monthlies with unique ids", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      bills: [{ id: "1", name: "Mortgage", amountPence: 120000, dueDay: 1, paidMonths: [] }],
      cardSubs: [{ id: "1", name: "Phone", amountPence: 2000, dueDay: 21, paidMonths: [] }],
    },
  });
  assert.equal(parsed.household.monthlies.length, 2);
  assert.equal(parsed.household.monthlies[0].paidFrom, "cash");
  assert.equal(parsed.household.monthlies[1].paidFrom, "card");
  assert.equal(parsed.household.monthlies[1].dueDay, 21);
  assert.notEqual(parsed.household.monthlies[0].id, parsed.household.monthlies[1].id);
});

test("older envelopes become weekly rules, not five cloned rows", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      envelopes: [{ id: "e-1", name: "Food shop", weeklyPence: 7000, happenedDates: ["2026-08-04"] }],
    },
  });
  assert.equal(parsed.household.weeklyRules.length, 1);
  assert.equal(parsed.household.weeklyRules[0].cadence, "times");
  assert.equal(parsed.household.weeklyRules[0].timesPerMonth, 4);
  assert.deepEqual(parsed.household.weeklyRules[0].tickedKeys, ["2026-08:1"]);
});

test("monthlies keep a working-day due roll and pots keep snapshots", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      monthlies: [{
        id: "m-1",
        name: "Card",
        amountPence: 5000,
        dueDay: 21,
        dueRoll: "nextWorking",
        paidMonths: ["2026-07"],
        paidFrom: "card",
      }],
      pots: [{
        id: "p-1",
        name: "Emergency",
        amountPence: 120000,
        updatedOn: "2026-08-01",
        snapshots: [
          { month: "2026-07", amountPence: 100000, updatedOn: "2026-07-02" },
          { month: "2026-08", amountPence: 120000, updatedOn: "2026-08-01" },
        ],
      }],
      payslipCategories: [{ id: "bonus", label: "Bonus", kind: "bonus" }],
    },
  });
  assert.equal(parsed.household.monthlies[0].dueRoll, "nextWorking");
  assert.equal("paidMonths" in parsed.household.monthlies[0], false);
  assert.equal(parsed.household.pots[0].snapshots.length, 2);
  assert.equal(parsed.household.pots[0].snapshots[0].amountPence, 100000);
  assert.ok(parsed.household.payslipCategories.some((item) => item.kind === "bonus"));
});

test("parental-pay categories stay outside net when parsed", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      payslipCategories: [{ id: "smp", label: "SMP", kind: "parental" }],
      payslips: [{
        id: "s-1",
        personId: "person-you",
        taxYear: "2026-27",
        periodMonth: "2026-08",
        salaryPence: 300000,
        grossPence: 300000,
        bonusPence: 0,
        benefitsPence: 0,
        salarySacrificePensionPence: 0,
        taxPence: 0,
        niPence: 0,
        netPence: 300000,
        note: "",
        moneyLandsMonth: "2026-08",
        otherDeductions: [{ id: "smp", label: "SMP", amountPence: 12000, inNet: false }],
      }],
    },
  });
  assert.equal(parsed.household.payslipCategories.find((item) => item.id === "smp").kind, "parental");
  assert.equal(parsed.household.payslips[0].otherDeductions[0].inNet, false);
});

test("pendings keep a note and month, and reserves are standing outs", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      pendings: [{ id: "p-1", name: "Flight hold", amountPence: 3000, month: "2026-08" }],
      reserves: [{ id: "r-1", name: "Daily float", amountPence: 90000 }],
    },
  });
  assert.equal(parsed.household.pendings[0].note, "Flight hold");
  assert.equal(parsed.household.pendings[0].month, "2026-08");
  assert.equal("name" in parsed.household.pendings[0], false);
  assert.equal(parsed.household.reserves[0].name, "Daily float");
  assert.equal(parsed.household.reserves[0].amountPence, 90000);
});

test("weekday weekly rules keep their calendar cadence", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      weeklyRules: [{
        id: "food",
        name: "Food shop",
        amountPence: 7000,
        cadence: "weekday",
        weekday: 2,
        tickedKeys: ["2026-08:2026-08-04"],
      }],
    },
  });
  assert.equal(parsed.household.weeklyRules[0].weekday, 2);
  assert.deepEqual(parsed.household.weeklyRules[0].tickedKeys, ["2026-08:2026-08-04"]);
});
