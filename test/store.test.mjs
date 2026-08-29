import test from "node:test";
import assert from "node:assert/strict";
import { cashflowForMonth, emptyHousehold, oneOffsForMonth } from "../household.js";
import { emptyStore, gistOneOffsNeedRewrite, parseStore, StoreError } from "../store.js";

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

test("an old cash-in-reserve list splits into the per diem and cash monthlies", () => {
  const store = parseStore({
    version: 1, friends: [], transactions: [],
    household: { reserves: [
      { id: "daily", name: "£30 a day", amountPence: 100000 },
      { id: "cleaner", name: "Cleaner", amountPence: 20000 },
      { id: "nails", name: "Nails", amountPence: 3500 },
    ] },
  });
  // The day money is the per diem now, in its own right.
  assert.equal(store.household.perDiem.amountPence, 100000);
  assert.equal("reserves" in store.household, false);
  // The standing costs beside it were always cash going out of the bank, so
  // they are read as the cash monthlies they are — Out does not move.
  const monthlies = store.household.monthlies;
  assert.equal(monthlies.length, 2);
  assert.deepEqual(monthlies.map((item) => item.name).sort(), ["Cleaner", "Nails"]);
  assert.ok(monthlies.every((item) => item.paidFrom === "cash" && item.dueDay === 1));
  // And it survives being written back out and read again.
  const again = parseStore(JSON.parse(JSON.stringify(store))).household;
  assert.deepEqual(again.perDiem, store.household.perDiem);
  assert.deepEqual(again.monthlies, monthlies);
});

test("money held back is one month's line, like an exception", () => {
  const store = parseStore({
    version: 1, friends: [], transactions: [],
    household: { setAsides: [{ id: "s1", name: "Car service", month: "2026-08", amountPence: 50000 }] },
  });
  assert.deepEqual(store.household.setAsides, [
    { id: "s1", name: "Car service", month: "2026-08", amountPence: 50000 },
  ]);
  assert.deepEqual(parseStore(JSON.parse(JSON.stringify(store))).household.setAsides, store.household.setAsides);
  const bad = (setAside) => () => parseStore({
    version: 1, friends: [], transactions: [], household: { setAsides: [setAside] },
  });
  assert.throws(bad({ id: "s1", name: "Car service", amountPence: 1 }), /Set-aside month/);
  assert.throws(bad({ id: "s1", month: "2026-08", amountPence: 1 }), /Set aside needs a name/);
  assert.throws(bad({ id: "s1", name: "x", month: "2026-08", amountPence: -1 }), /Set aside/);
});

test("a planned one-off keeps which side it is paid from, and a usable day", () => {
  const parse = (oneOff) => parseStore({
    version: 1, friends: [], transactions: [], household: { oneOffs: [oneOff] },
  }).household.oneOffs[0];
  const base = { id: "o1", name: "Sofa", month: "2026-08", estimatePence: 60000 };
  // An older record has no side recorded, and card is what it always meant.
  assert.equal(parse(base).paidFrom, "card");
  assert.equal(parse({ ...base, paidFrom: "cash" }).paidFrom, "cash");
  assert.equal(parse({ ...base, paidFrom: "nonsense" }).paidFrom, "card");
  // A day is kept only when it is a day, so nothing downstream has to re-check.
  assert.equal(parse({ ...base, dueDay: 20 }).dueDay, 20);
  assert.equal("dueDay" in parse(base), false);
  assert.equal("dueDay" in parse({ ...base, dueDay: 0 }), false);
  assert.equal("dueDay" in parse({ ...base, dueDay: 32 }), false);
  assert.equal("dueDay" in parse({ ...base, dueDay: "20" }), false);
  // And it survives being written back out and read again.
  const store = parseStore({
    version: 1, friends: [], transactions: [],
    household: { oneOffs: [{ ...base, paidFrom: "cash", dueDay: 20 }] },
  });
  assert.deepEqual(parseStore(JSON.parse(JSON.stringify(store))).household.oneOffs, store.household.oneOffs);
});

test("money drawn in from savings is one month's line, like an exception", () => {
  const store = parseStore({
    version: 1, friends: [], transactions: [],
    household: { fromSavings: [{ id: "f1", name: "Cover the shortfall", month: "2026-08", amountPence: 100000 }] },
  });
  assert.deepEqual(store.household.fromSavings, [
    { id: "f1", name: "Cover the shortfall", month: "2026-08", amountPence: 100000 },
  ]);
  assert.deepEqual(parseStore(JSON.parse(JSON.stringify(store))).household.fromSavings, store.household.fromSavings);
  const bad = (line) => () => parseStore({
    version: 1, friends: [], transactions: [], household: { fromSavings: [line] },
  });
  assert.throws(bad({ id: "f1", name: "x", amountPence: 1 }), /From-savings month/);
  assert.throws(bad({ id: "f1", month: "2026-08", amountPence: 1 }), /From savings needs a name/);
  assert.throws(bad({ id: "f1", name: "x", month: "2026-08", amountPence: -1 }), /From savings/);
});

test("a per diem already set is kept as it stands", () => {
  const store = parseStore({
    version: 1, friends: [], transactions: [],
    household: { perDiem: { amountPence: 123400 } },
  });
  assert.equal(store.household.perDiem.amountPence, 123400);
  assert.throws(() => parseStore({
    version: 1, friends: [], transactions: [],
    household: { perDiem: { amountPence: -1 } },
  }), /Per diem/);
});


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
  assert.equal(parsed.household.weeklyRules[0].paidFrom, "card");
});

test("weekly rules keep paidFrom and default missing ones to card", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      weeklyRules: [
        { id: "amazon", name: "Amazon", amountPence: 10000, cadence: "times", timesPerMonth: 1, tickedKeys: [] },
        { id: "food", name: "Food shop", amountPence: 7000, cadence: "times", timesPerMonth: 1, tickedKeys: [], paidFrom: "cash" },
      ],
    },
  });
  assert.equal(parsed.household.weeklyRules[0].paidFrom, "card");
  assert.equal(parsed.household.weeklyRules[1].paidFrom, "cash");
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

test("pendings keep a note and month", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      pendings: [{ id: "p-1", name: "Flight hold", amountPence: 3000, month: "2026-08" }],
    },
  });
  assert.equal(parsed.household.pendings[0].note, "Flight hold");
  assert.equal(parsed.household.pendings[0].month, "2026-08");
  assert.equal("name" in parsed.household.pendings[0], false);
});

test("once-a-month weekly rules become N times with N=1", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      weeklyRules: [{
        id: "litter",
        name: "Cat litter",
        amountPence: 1200,
        cadence: "once",
        tickedKeys: ["2026-08:1"],
      }],
    },
  });
  assert.equal(parsed.household.weeklyRules[0].cadence, "times");
  assert.equal(parsed.household.weeklyRules[0].timesPerMonth, 1);
});

test("one-off months such as August 2026 match the viewed month", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      oneOffs: [
        { id: "o-1", name: "MOT", month: "August 2026", estimatePence: 40000, purchased: false },
        { id: "o-2", name: "Sofa", month: "2026-08-15", estimatePence: 120000, purchased: true },
      ],
    },
  }, new Date("2026-08-15T12:00:00Z"));
  assert.equal(parsed.household.oneOffs[0].month, "2026-08");
  assert.equal(parsed.household.oneOffs[1].month, "2026-08");
});

test("imported one-offs move to this year and previous months are dropped", () => {
  const today = new Date("2026-08-15T12:00:00Z");
  const raw = {
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      oneOffs: [
        { id: "o-open", name: "Open item", month: "2025-08", estimatePence: 5000, purchased: false },
        { id: "o-bought", name: "Bought item", month: "2025-08", estimatePence: 7000, purchased: true },
        { id: "o-later", name: "Later item", month: "2025-09", estimatePence: 3000, purchased: false },
        { id: "o-jan", name: "January leftover", month: "2025-01", estimatePence: 2000, purchased: false },
        { id: "o-past", name: "This-year past", month: "2026-01", estimatePence: 1000, purchased: true },
      ],
    },
  };
  const parsed = parseStore(raw, today);
  const byId = Object.fromEntries(parsed.household.oneOffs.map((item) => [item.id, item]));
  assert.equal(byId["o-open"].month, "2026-08");
  assert.equal(byId["o-bought"].month, "2026-08");
  assert.equal(byId["o-later"].month, "2026-09");
  assert.equal(byId["o-jan"], undefined);
  assert.equal(byId["o-past"], undefined);
  assert.equal(parsed.household.oneOffs.every((item) => !String(item.month).startsWith("2025-")), true);
  assert.deepEqual(oneOffsForMonth(parsed.household, "2026-08").map((item) => item.id).sort(), ["o-bought", "o-open"]);
  const flow = cashflowForMonth(parsed.household, "2026-08", today);
  assert.equal(flow.oneOffsPence, 12000);
  assert.equal(flow.outPence, 12000);
  assert.equal(gistOneOffsNeedRewrite(raw, parsed), true);
  assert.equal(gistOneOffsNeedRewrite(parsed, parsed), false);
});

test("September load drops August planned rows, including purchased", () => {
  const today = new Date("2026-09-10T12:00:00Z");
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      oneOffs: [
        { id: "o-open", name: "Open item", month: "2026-08", estimatePence: 5000, purchased: false },
        { id: "o-bought", name: "Bought item", month: "2026-08", estimatePence: 7000, purchased: true },
        { id: "o-later", name: "Later item", month: "2025-09", estimatePence: 3000, purchased: false },
      ],
    },
  }, today);
  assert.deepEqual(parsed.household.oneOffs.map((item) => `${item.id}:${item.month}`), ["o-later:2026-09"]);
  assert.deepEqual(oneOffsForMonth(parsed.household, "2026-08"), []);
  assert.deepEqual(oneOffsForMonth(parsed.household, "2026-09").map((item) => item.id), ["o-later"]);
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

test("exceptions round-trip and need a month, a name, and an amount", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      exceptions: [{ id: "x-1", name: "Travel insurance", month: "2026-08", amountPence: 56000 }],
    },
  });
  assert.deepEqual(parsed.household.exceptions, [
    { id: "x-1", name: "Travel insurance", month: "2026-08", amountPence: 56000 },
  ]);

  const older = parseStore({ version: 1, friends: [], transactions: [], household: { ...emptyHousehold(), exceptions: undefined } });
  assert.deepEqual(older.household.exceptions, []);

  assert.throws(() => parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: { ...emptyHousehold(), exceptions: [{ id: "x-1", name: "No month", amountPence: 100 }] },
  }), /Exception month must be YYYY-MM\./);
});

test("a pending row may be a credit, and firstWorking becomes day 1 rolled on", () => {
  const parsed = parseStore({
    version: 1,
    friends: [],
    transactions: [],
    household: {
      ...emptyHousehold(),
      pendings: [
        { id: "p-1", note: "Coffee", amountPence: 500, month: "2026-08" },
        { id: "p-2", note: "Refund", amountPence: -4000, month: "2026-08" },
      ],
      monthlies: [
        { id: "m-1", name: "Mortgage", amountPence: 140000, dueRoll: "firstWorking", dueDay: 9, paidFrom: "cash" },
      ],
    },
  });
  assert.equal(parsed.household.pendings[1].amountPence, -4000);
  // The retired roll is stored as the rule it always meant.
  assert.equal(parsed.household.monthlies[0].dueRoll, "nextWorking");
  assert.equal(parsed.household.monthlies[0].dueDay, 1);
});
