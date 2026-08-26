import test from "node:test";
import assert from "node:assert/strict";
import { formatMoney } from "../calculations.js";
import {
  ANI_LIMIT_PENCE,
  aniFromHousehold,
  aniProjection,
  annualReservePence,
  addPendingRow,
  cashflowForMonth,
  currentPeriodHint,
  currentUkTaxYear,
  datesOfWeekdayInMonth,
  defaultCategoriesForNewPayslip,
  DEFAULT_PAYSLIP_CATEGORIES,
  effectiveDueDate,
  emptyHousehold,
  extraSacrificeRatio,
  giftAidGrossPence,
  householdHasData,
  incomeFromPayslipsPence,
  isCurrentMonth,
  isParentalPayLabel,
  jumpToCurrentMonthLabel,
  monthlyIsAllowed,
  payslipAniPence,
  payslipCategoriesOf,
  payslipIsConfirmed,
  payslipNetPence,
  payslipRecordLabels,
  pendingListTotalPence,
  pendingsForMonth,
  potsNeedCurrentMonthLog,
  rememberPayslipCategories,
  resetMonthTicks,
  savingLine,
  spendVerdict,
  toggleWeeklySlotTick,
  ukTaxYearFromDate,
  viewPeriodLabel,
  weekliesForMonth,
  weeklyCadenceLabel,
  weeklySlotKeysForRule,
  weeklySlotsForMonth,
} from "../household.js";

const household = {
  ...emptyHousehold(),
  people: [
    { id: "you", name: "You" },
    { id: "partner", name: "Partner" },
  ],
  incomes: [
    { id: "in-1", personId: "you", label: "Stale typed income", amountPence: 999999 },
    { id: "in-2", personId: "partner", label: "Stale typed income", amountPence: 888888 },
  ],
  payslips: [
    slipFor("you", "2026-08", 300000),
    slipFor("partner", "2026-08", 200000),
  ],
  bills: [
    { id: "b-1", name: "Mortgage", amountPence: 120000, dueDay: 1, paidMonths: ["2026-08"] },
    { id: "b-2", name: "Council tax", amountPence: 20000, dueDay: 10, paidMonths: [] },
  ],
  envelopes: [
    { id: "e-1", name: "Food shop", weeklyPence: 7000, happenedDates: ["2026-08-03"] },
  ],
  cards: [
    { id: "c-1", name: "Card one", balancePence: 80000, updatedOn: "2026-08-10" },
    { id: "c-2", name: "Card two", balancePence: 20000, updatedOn: "2026-08-10" },
  ],
  cardSubs: [
    { id: "s-1", name: "Phone", amountPence: 2000, dueDay: 5, paidMonths: [] },
    { id: "s-2", name: "Later sub", amountPence: 9000, dueDay: 28, paidMonths: [] },
  ],
  oneOffs: [
    { id: "o-1", name: "MOT", month: "2026-08", estimatePence: 40000, purchased: false },
    { id: "o-2", name: "Holiday", month: "2026-12", estimatePence: 80000, purchased: false },
  ],
  annualBills: [
    { id: "a-1", name: "Insurance", amountPence: 120000, month: 3 },
  ],
};

test("empty household templates are not treated as live data", () => {
  assert.equal(householdHasData(emptyHousehold()), false);
  assert.equal(householdHasData(household), true);
});

test("cashflow income is net pay from payslips that land in the month", () => {
  const today = new Date("2026-08-10T12:00:00Z");
  const flow = cashflowForMonth(household, "2026-08", today);
  assert.equal(flow.incomePence, 500000);
  assert.equal(flow.incomeLines.length, 2);
  assert.equal(incomeFromPayslipsPence(household, "2026-08"), 500000);

  const twoForYou = {
    ...household,
    payslips: [
      slipFor("you", "2026-08", 120000, { id: "s-a" }),
      slipFor("you", "2026-08", 80000, { id: "s-b", periodMonth: "2026-07" }),
      slipFor("partner", "2026-09", 200000),
    ],
  };
  const august = cashflowForMonth(twoForYou, "2026-08", today);
  assert.equal(august.incomePence, 200000);
  assert.equal(august.incomeLines.length, 2);
  const july = cashflowForMonth(twoForYou, "2026-07", today);
  assert.equal(july.incomePence, 0);
});

test("cashflow In / Out / Left is a month statement, not allowed-so-far", () => {
  const today = new Date("2026-08-10T12:00:00Z");
  const flow = cashflowForMonth(household, "2026-08", today);
  assert.equal(flow.incomePence, 500000);
  assert.equal(flow.billsPence, 140000);
  assert.equal(flow.annualReservePence, 10000);
  assert.equal(flow.oneOffsPence, 40000);
  assert.equal(flow.oneOffs.map((item) => item.name).join(), "MOT");
  assert.equal(flow.envelopesMonthlyPence, 28000);
  assert.equal(flow.cardOutPence, 11000);
  assert.equal(flow.outPence, 229000);
  assert.equal(flow.leftPence, 271000);
  assert.equal(flow.committedOutPence, 229000);
  assert.equal(flow.potPence, 271000);
  assert.equal(flow.daysInMonth, 31);
  assert.equal(annualReservePence(household.annualBills), 10000);

  const reserved = cashflowForMonth({
    ...household,
    reserves: [{ id: "r-1", name: "Daily float", amountPence: 90000 }],
  }, "2026-08", today);
  assert.equal(reserved.reservePence, 90000);
  assert.equal(reserved.outPence, 319000);
  assert.equal(reserved.leftPence, 181000);

  const future = cashflowForMonth(household, "2026-09", today);
  assert.equal(future.billsPence, 140000);
  assert.equal(future.envelopesMonthlyPence, 28000);
  assert.equal(spendVerdict(future.overUnderPence, formatMoney, { month: "2026-09", today }), "");
});

test("a monthly due on the 21st counts as allowed on or after the 21st", () => {
  const item = { id: "m-1", name: "Card due", amountPence: 5000, dueDay: 21, paidMonths: [], paidFrom: "card" };
  assert.equal(monthlyIsAllowed(item, "2026-08", 20), false);
  assert.equal(monthlyIsAllowed(item, "2026-08", 21), true);
  assert.equal(monthlyIsAllowed(item, "2026-08", 22), true);
  const leftoverTick = { ...item, paidMonths: ["2026-08"] };
  assert.equal(monthlyIsAllowed(leftoverTick, "2026-08", 10), false);
  const before = cashflowForMonth({
    ...emptyHousehold(),
    monthlies: [item],
    cards: [{ id: "c-1", name: "Card", balancePence: 5000, pendingPence: 0, updatedOn: "2026-08-20" }],
  }, "2026-08", new Date("2026-08-20T12:00:00Z"));
  assert.equal(before.allowedPence, 0);
  assert.equal(before.overUnderPence, -5000);
  const onDay = cashflowForMonth({
    ...emptyHousehold(),
    monthlies: [item],
    cards: [{ id: "c-1", name: "Card", balancePence: 5000, pendingPence: 0, updatedOn: "2026-08-21" }],
  }, "2026-08", new Date("2026-08-21T12:00:00Z"));
  assert.equal(onDay.allowedPence, 5000);
  assert.equal(onDay.overUnderPence, 0);
});

test("a weekend due day can roll to the next UK working day", () => {
  const item = { id: "m-1", name: "Card due", amountPence: 5000, dueDay: 21, dueRoll: "nextWorking", paidMonths: [], paidFrom: "card" };
  assert.equal(effectiveDueDate(item, "2026-02"), "2026-02-23");
  assert.equal(monthlyIsAllowed(item, "2026-02", 21), false);
  assert.equal(monthlyIsAllowed(item, "2026-02", 22), false);
  assert.equal(monthlyIsAllowed(item, "2026-02", 23), true);
  const calendar = { ...item, dueRoll: "calendar" };
  assert.equal(effectiveDueDate(calendar, "2026-02"), "2026-02-21");
  assert.equal(monthlyIsAllowed(calendar, "2026-02", 21), true);
  const sundayEnd = { ...item, dueDay: 31 };
  assert.equal(effectiveDueDate(sundayEnd, "2026-05"), "2026-06-01");
  assert.equal(monthlyIsAllowed(sundayEnd, "2026-05", 31), false);
});

test("first working day skips a weekend 1st", () => {
  const item = { id: "m-1", name: "Mortgage", amountPence: 1000, dueDay: 1, dueRoll: "firstWorking", paidMonths: [], paidFrom: "card" };
  assert.equal(effectiveDueDate(item, "2026-08"), "2026-08-03");
  assert.equal(monthlyIsAllowed(item, "2026-08", 1), false);
  assert.equal(monthlyIsAllowed(item, "2026-08", 2), false);
  assert.equal(monthlyIsAllowed(item, "2026-08", 3), true);
  assert.equal(effectiveDueDate(item, "2026-05"), "2026-05-01");
  assert.equal(monthlyIsAllowed(item, "2026-05", 1), true);
});

test("card subs sit in Out for the month and paidMonths is not a tick", () => {
  const leftover = {
    ...household,
    cardSubs: [{ id: "s-2", name: "Later sub", amountPence: 9000, dueDay: 28, paidMonths: ["2026-08"] }],
  };
  const flow = cashflowForMonth(leftover, "2026-08", new Date("2026-08-10T12:00:00Z"));
  assert.equal(flow.allowedPence, 0);
  assert.equal(flow.cardOutPence, 9000);
  assert.equal(flow.outPence, leftover.bills.reduce((total, item) => total + item.amountPence, 0) + 9000 + 10000 + 40000 + 28000);
});

test("pending amounts sit with card balances against the allowed-so-far", () => {
  const withPending = {
    ...household,
    cards: household.cards.map((card, index) => (index === 0 ? { ...card, pendingPence: 5000 } : card)),
    pendings: [{ id: "p-1", name: "Flight hold", amountPence: 3000 }],
  };
  const flow = cashflowForMonth(withPending, "2026-08", new Date("2026-08-10T12:00:00Z"));
  assert.equal(flow.pendingPence, 8000);
  assert.equal(flow.cardSidePence, 108000);
  assert.equal(flow.overUnderPence, flow.allowedPence - 108000);
});

test("a new-month reset clears ticks for that month only", () => {
  const copy = structuredClone(household);
  resetMonthTicks(copy, "2026-08");
  assert.deepEqual(copy.bills[0].paidMonths, ["2026-08"]);
  assert.deepEqual(copy.envelopes[0].happenedDates, []);
  assert.equal(copy.envelopes[0].name, "Food shop");
  assert.equal(copy.envelopes[0].weeklyPence, 7000);
  const today = new Date("2026-08-10T12:00:00Z");
  const over = cashflowForMonth(household, "2026-08", today);
  assert.equal(over.leftPence > 0, true);
  assert.equal(savingLine(over, today), "This month can save.");
  const short = cashflowForMonth({
    ...emptyHousehold(),
    monthlies: [{ id: "m-1", name: "Rent", amountPence: 300000, dueDay: 1, paidMonths: [], paidFrom: "cash" }],
    payslips: [slipFor("you", "2026-08", 200000)],
    people: [{ id: "you", name: "You" }],
  }, "2026-08", today);
  assert.equal(savingLine(short, today), "This month does not balance yet.");
});

test("viewing the current month leaves previous-month ticks and the card picture alone", () => {
  const hh = {
    ...emptyHousehold(),
    weeklyRules: [{
      id: "food",
      name: "Food shop",
      amountPence: 7000,
      cadence: "weekday",
      weekday: 2,
      tickedKeys: ["2026-07:2026-07-07", "2026-07:2026-07-14"],
    }],
    monthlies: [{
      id: "phone",
      name: "Phone",
      amountPence: 2000,
      dueDay: 21,
      dueRoll: "calendar",
      paidMonths: ["2026-07"],
      paidFrom: "card",
    }],
    cards: [{
      id: "c-1",
      name: "Card",
      balancePence: 9000,
      pendingPence: 0,
      updatedOn: "2026-08-10",
      snapshots: [
        { month: "2026-07", amountPence: 2000, pendingPence: 0, updatedOn: "2026-07-31" },
        { month: "2026-08", amountPence: 9000, pendingPence: 0, updatedOn: "2026-08-10" },
      ],
    }],
  };
  const julyTicks = [...hh.weeklyRules[0].tickedKeys];
  const today = new Date("2026-08-10T12:00:00Z");
  const august = cashflowForMonth(hh, "2026-08", today);
  const july = cashflowForMonth(hh, "2026-07", today);

  assert.deepEqual(hh.weeklyRules[0].tickedKeys, julyTicks);
  assert.deepEqual(hh.monthlies[0].paidMonths, ["2026-07"]);
  assert.equal(july.weeklySlots.filter((slot) => slot.ticked).length, 2);
  assert.equal(august.weeklySlots.filter((slot) => slot.ticked).length, 0);
  assert.ok(august.weeklySlots.length > 0);
  assert.ok(august.weeklySlots.every((slot) => slot.ticked === false));
  assert.equal(july.allowedPence, 2000);
  assert.equal(july.cardBalancesPence, 2000);
  assert.equal(july.overUnderPence, 0);
  assert.equal(august.cardBalancesPence, 9000);
  assert.equal(august.allowedPence, 0);
  assert.ok(august.overUnderPence < 0);

  toggleWeeklySlotTick(hh, august.weeklySlots[0].id, "2026-08");
  assert.deepEqual(
    hh.weeklyRules[0].tickedKeys.filter((key) => String(key).startsWith("2026-07:")),
    julyTicks,
  );
  assert.ok(hh.weeklyRules[0].tickedKeys.some((key) => String(key).startsWith("2026-08:")));
  const julyAgain = cashflowForMonth(hh, "2026-07", today);
  assert.equal(julyAgain.weeklySlots.filter((slot) => slot.ticked).length, 2);
});

test("a Tuesday rule makes one slot per Tuesday in the cashflow month", () => {
  const rule = { id: "food", name: "Food shop", amountPence: 7000, cadence: "weekday", weekday: 2, tickedKeys: [] };
  assert.deepEqual(datesOfWeekdayInMonth("2026-08", 2), ["2026-08-04", "2026-08-11", "2026-08-18", "2026-08-25"]);
  const keys = weeklySlotKeysForRule(rule, "2026-08");
  assert.equal(keys.length, 4);
  const slots = weeklySlotsForMonth({ weeklyRules: [rule], weeklyExtras: [] }, "2026-08");
  assert.equal(slots.length, 4);
  assert.ok(slots.every((slot) => slot.name === "Food shop" && slot.ticked === false));
});

test("every week on a weekday uses that weekday’s count in the viewed month", () => {
  const rule = { id: "food", name: "Food shop", amountPence: 7000, cadence: "weekday", weekday: 2, tickedKeys: [] };
  assert.equal(weeklyCadenceLabel(rule), "Every week on Tuesday");
  assert.equal(weeklySlotKeysForRule(rule, "2026-08").length, 4);
  assert.deepEqual(datesOfWeekdayInMonth("2026-09", 2), [
    "2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29",
  ]);
  assert.equal(weeklySlotKeysForRule(rule, "2026-09").length, 5);
  assert.equal(weeklySlotsForMonth({ weeklyRules: [rule], weeklyExtras: [] }, "2026-09").length, 5);
});

test("a Friday rule in a five-Friday month makes five slots", () => {
  const rule = { id: "amazon", name: "Amazon", amountPence: 2000, cadence: "weekday", weekday: 5, tickedKeys: [] };
  const keys = weeklySlotKeysForRule(rule, "2026-05");
  assert.deepEqual(keys, ["2026-05-01", "2026-05-08", "2026-05-15", "2026-05-22", "2026-05-29"]);
  assert.equal(weeklySlotsForMonth({ weeklyRules: [rule], weeklyExtras: [] }, "2026-05").length, 5);
});

test("a once-a-month weekly rule makes one slot", () => {
  const rule = { id: "litter", name: "Cat litter", amountPence: 1200, cadence: "once", tickedKeys: [] };
  assert.deepEqual(weeklySlotKeysForRule(rule, "2026-08"), ["1"]);
  assert.equal(weeklySlotsForMonth({ weeklyRules: [rule], weeklyExtras: [] }, "2026-08").length, 1);
  assert.equal(weeklySlotsForMonth({ weeklyRules: [rule], weeklyExtras: [] }, "2026-05").length, 1);
});

test("an N-times-a-month rule makes that many slots, not five dummy copies", () => {
  const rule = { id: "deliveroo", name: "Deliveroo", amountPence: 2500, cadence: "times", timesPerMonth: 2, tickedKeys: [] };
  assert.deepEqual(weeklySlotKeysForRule(rule, "2026-08"), ["1", "2"]);
  assert.equal(weeklySlotsForMonth({ weeklyRules: [rule], weeklyExtras: [] }, "2026-08").length, 2);
});

test("an extra weekly this month does not change the rule", () => {
  const rule = { id: "food", name: "Food shop", amountPence: 7000, cadence: "weekday", weekday: 2, tickedKeys: [] };
  const extra = { id: "extra-1", name: "Extra shop", amountPence: 4000, month: "2026-08", happened: false };
  const august = weeklySlotsForMonth({ weeklyRules: [rule], weeklyExtras: [extra] }, "2026-08");
  const september = weeklySlotsForMonth({ weeklyRules: [rule], weeklyExtras: [extra] }, "2026-09");
  assert.equal(august.length, 5);
  assert.equal(august.filter((slot) => slot.adHoc).length, 1);
  assert.equal(september.length, 5);
  assert.equal(september.filter((slot) => slot.adHoc).length, 0);
});

test("a new month regenerates weekly slots, all unticked", () => {
  const householdWithRules = {
    weeklyRules: [{
      id: "food",
      name: "Food shop",
      amountPence: 7000,
      cadence: "weekday",
      weekday: 2,
      tickedKeys: ["2026-08:2026-08-04", "2026-08:2026-08-11"],
    }],
    weeklyExtras: [],
  };
  const august = weeklySlotsForMonth(householdWithRules, "2026-08");
  const september = weeklySlotsForMonth(householdWithRules, "2026-09");
  assert.equal(august.filter((slot) => slot.ticked).length, 2);
  assert.ok(september.length > 0);
  assert.ok(september.every((slot) => slot.ticked === false));
  assert.ok(september.every((slot) => slot.name === "Food shop"));
});

test("weekly lines are a template: a new month is the same lines, unticked", () => {
  const august = weekliesForMonth(household, "2026-08");
  const september = weekliesForMonth(household, "2026-09");
  assert.equal(august.length, 1);
  assert.equal(september.length, 1);
  assert.equal(august[0].id, september[0].id);
  assert.equal(august[0].name, september[0].name);
  assert.equal(august[0].weeklyPence, september[0].weeklyPence);
  assert.equal(august[0].ticked, true);
  assert.equal(september[0].ticked, false);
  assert.deepEqual(september[0].happenedDates, []);
});

test("historical month labels stay historical", () => {
  const today = new Date("2026-08-26T12:00:00Z");
  assert.equal(viewPeriodLabel("2026-03"), "March 2026");
  assert.equal(currentPeriodHint("2026-03", today), "March 2026");
  assert.equal(currentPeriodHint("2026-08", today), "This month");
  const labels = payslipRecordLabels({
    periodMonth: "2026-03",
    moneyLandsMonth: "2026-04",
    taxYear: "2025-26",
  });
  assert.equal(labels.period, "March 2026");
  assert.equal(labels.lands, "April 2026");
  assert.equal(labels.taxYear, "2025-26");
  const past = cashflowForMonth({ ...emptyHousehold(), annualBills: [] }, "2026-03", today);
  assert.equal(savingLine({ ...past, potPence: -100, leftPence: -100 }, today), "March 2026 does not balance yet.");
});

test("September 2026 is not this month on 26 August 2026", () => {
  const today = new Date("2026-08-26T12:00:00Z");
  assert.equal(isCurrentMonth("2026-09", today), false);
  assert.equal(isCurrentMonth("2026-08", today), true);
  assert.equal(currentPeriodHint("2026-09", today), "September 2026");
  assert.equal(jumpToCurrentMonthLabel("2026-09", today), "Back to August 2026");
  assert.equal(jumpToCurrentMonthLabel("2026-08", today), "");
  const september = cashflowForMonth({ ...emptyHousehold(), annualBills: [] }, "2026-09", today);
  assert.equal(savingLine({ ...september, potPence: -100, leftPence: -100 }, today), "September 2026 does not balance yet.");
  assert.equal(spendVerdict(0, formatMoney, { month: "2026-09", today }), "");
  assert.equal(spendVerdict(0, formatMoney, { month: "2026-08", today }), "Cards match the allowed expecteds.");
});

test("annual bills become the cashflow monthly reserve", () => {
  const today = new Date("2026-08-10T12:00:00Z");
  const one = cashflowForMonth({
    ...emptyHousehold(),
    annualBills: [{ id: "a-1", name: "Insurance", amountPence: 120000, month: 3 }],
  }, "2026-08", today);
  assert.equal(one.annualReservePence, 10000);
  assert.equal(annualReservePence([{ amountPence: 120000 }]), 10000);
  const edited = cashflowForMonth({
    ...emptyHousehold(),
    annualBills: [{ id: "a-1", name: "Insurance", amountPence: 240000, month: 3 }],
  }, "2026-08", today);
  assert.equal(edited.annualReservePence, 20000);
});

test("over and underspend stay off future months", () => {
  const today = new Date("2026-08-26T12:00:00Z");
  assert.equal(spendVerdict(2000, formatMoney), "£20.00 under — room on the cards.");
  assert.equal(spendVerdict(-4500, formatMoney), "£45.00 over the allowed expecteds.");
  assert.equal(spendVerdict(0, formatMoney), "Cards match the allowed expecteds.");
  assert.equal(spendVerdict(0, formatMoney, { month: "2026-09", today }), "");
});

test("UK tax year starts on 6 April", () => {
  assert.equal(ukTaxYearFromDate("2026-04-05"), "2025-26");
  assert.equal(ukTaxYearFromDate("2026-04-06"), "2026-27");
  assert.equal(ukTaxYearFromDate("2026-03-31"), "2025-26");
  assert.equal(currentUkTaxYear(new Date("2026-08-26T12:00:00Z")), "2026-27");
});

test("Gift Aid adds 25% to the donation", () => {
  assert.equal(giftAidGrossPence(10000, true), 12500);
  assert.equal(giftAidGrossPence(8000, true), 10000);
  assert.equal(giftAidGrossPence(10000, false), 10000);
});

test("£100k helper projects remaining months and extra salary sacrifice", () => {
  const slips = [
    slip("2026-04", 900000),
    slip("2026-05", 900000),
    slip("2026-06", 900000),
    slip("2026-07", 900000),
    slip("2026-08", 900000),
    slip("2026-09", 900000, { forecast: true }),
  ];
  const result = aniProjection({
    payslips: slips,
    personId: "you",
    taxYear: "2026-27",
    today: new Date("2026-08-26T12:00:00Z"),
  });
  assert.equal(result.confirmedCount, 5);
  assert.equal(result.remainingMonths, 7);
  assert.equal(result.ytdPence, 4500000);
  assert.equal(result.projectedRestPence, 6300000);
  assert.equal(result.projectedPence, 10800000);
  assert.equal(result.extraSacrificePence, 800000);
  assert.equal(result.extraPerRemainingMonthPence, Math.round(800000 / 7));
  assert.equal(result.extraSacrificeOfRemaining, 800000 / 6300000);
  assert.equal(extraSacrificeRatio(result), 800000 / 6300000);
  assert.equal(result.overLimit, true);
  assert.ok(result.projectedPence > ANI_LIMIT_PENCE);
});

test("£100k helper ignores forecast rows and can stay under the cliff", () => {
  const confirmed = [
    slip("2026-04", 800000),
    slip("2026-05", 800000),
    slip("2026-06", 800000),
    slip("2026-07", 800000),
    slip("2026-08", 800000),
    slip("2026-09", 800000),
    slip("2026-10", 800000),
    slip("2026-11", 800000),
    slip("2026-12", 800000),
    slip("2027-01", 800000),
    slip("2027-02", 800000),
    slip("2027-03", 800000, { forecast: true }),
  ];
  const result = aniProjection({
    payslips: confirmed,
    personId: "you",
    taxYear: "2026-27",
    today: new Date("2027-02-10T12:00:00Z"),
  });
  assert.equal(result.confirmedCount, 11);
  assert.equal(result.remainingMonths, 1);
  assert.equal(result.ytdPence, 8800000);
  assert.equal(result.projectedPence, 9600000);
  assert.equal(result.extraSacrificePence, 0);
  assert.equal(result.underByPence, 400000);
  assert.equal(result.overLimit, false);
});

test("Gift Aid from giving in the tax year feeds the £100k helper", () => {
  const donations = [{
    id: "d-1",
    who: "you",
    charity: "Example",
    date: "2026-05-01",
    amountPence: 80000,
    giftAid: true,
  }];
  const result = aniFromHousehold({
    people: [{ id: "you", name: "You" }],
    payslips: [slip("2026-04", 900000)],
    donations,
  }, {
    personId: "you",
    taxYear: "2026-27",
    today: new Date("2026-08-26T12:00:00Z"),
  });
  assert.equal(result.giftAidAddBackPence, 20000);
  assert.equal(result.ytdPence, 900000);
  assert.equal(result.projectedPence, result.ytdPence + result.projectedRestPence + 20000);
});

test("Gift Aid add-back is off unless the planner asks for it", () => {
  const donations = [{
    id: "d-1",
    who: "You",
    charity: "Example",
    date: "2026-05-01",
    amountPence: 80000,
    giftAid: true,
  }];
  const slips = [slip("2026-04", 9000000)];
  const off = aniProjection({
    payslips: slips,
    donations,
    personId: "you",
    personName: "You",
    taxYear: "2026-27",
    includeGiftAid: false,
    today: new Date("2026-08-26T12:00:00Z"),
  });
  const on = aniProjection({
    payslips: slips,
    donations,
    personId: "you",
    personName: "You",
    taxYear: "2026-27",
    includeGiftAid: true,
    today: new Date("2026-08-26T12:00:00Z"),
  });
  assert.equal(off.giftAidAddBackPence, 0);
  assert.equal(on.giftAidAddBackPence, 20000);
});

test("pots remind quietly when this calendar month has no snapshot", () => {
  const pots = [{
    id: "p-1",
    name: "Emergency",
    amountPence: 100000,
    updatedOn: "2026-07-02",
    snapshots: [{ month: "2026-07", amountPence: 100000, updatedOn: "2026-07-02" }],
  }];
  assert.equal(potsNeedCurrentMonthLog(pots, new Date("2026-08-26T12:00:00Z")), true);
  assert.equal(potsNeedCurrentMonthLog(pots, new Date("2026-07-26T12:00:00Z")), false);
  assert.equal(potsNeedCurrentMonthLog([], new Date("2026-08-26T12:00:00Z")), false);
  const logged = [{
    ...pots[0],
    snapshots: [
      ...pots[0].snapshots,
      { month: "2026-08", amountPence: 110000, updatedOn: "2026-08-10" },
    ],
  }];
  assert.equal(potsNeedCurrentMonthLog(logged, new Date("2026-08-26T12:00:00Z")), false);
});

test("payslip categories stay available after a later slip leaves them unused", () => {
  const hh = {
    payslips: [{
      bonusPence: 25000,
      benefitsPence: 0,
      salarySacrificePensionPence: 0,
      otherDeductions: [{ id: "d-1", label: "Cycle scheme", amountPence: 4000 }],
    }],
    payslipCategories: [],
  };
  rememberPayslipCategories(hh, payslipCategoriesOf(hh));
  assert.ok(hh.payslipCategories.some((item) => item.kind === "bonus"));
  assert.ok(hh.payslipCategories.some((item) => item.label === "Cycle scheme"));
  const later = payslipCategoriesOf({
    payslipCategories: hh.payslipCategories,
    payslips: [{ bonusPence: 0, otherDeductions: [] }],
  });
  assert.ok(later.some((item) => item.kind === "bonus"));
  assert.ok(later.some((item) => item.label === "Cycle scheme"));
});

test("payslip net is gross through jury-service deductions and skips parental pay", () => {
  assert.equal(isParentalPayLabel("SMP"), true);
  assert.equal(isParentalPayLabel("Enhanced maternity"), true);
  assert.equal(isParentalPayLabel("OSPP"), true);
  assert.equal(isParentalPayLabel("Jury service"), false);
  assert.equal(payslipNetPence({
    grossPence: 400000,
    bonusPence: 20000,
    benefitsPence: 5000,
    salarySacrificePensionPence: 30000,
    taxPence: 60000,
    niPence: 20000,
    otherDeductions: [
      { id: "gym", label: "Gym flex", amountPence: 4000 },
      { id: "cycle", label: "Cycle scheme", amountPence: 8000 },
      { id: "jury", label: "Jury service", amountPence: 2000 },
      { id: "smp", label: "SMP", amountPence: 15000 },
      { id: "mat", label: "Enhanced maternity", amountPence: 80000, inNet: false },
    ],
  }), 301000);
  assert.equal(payslipNetPence({
    grossPence: 400000,
    netPence: 999999,
    otherDeductions: [{ id: "smp", label: "SMP", amountPence: 15000 }],
  }), 400000);
});

test("Home In uses calculated payslip net, not a typed take-home leftover", () => {
  const hh = {
    ...emptyHousehold(),
    people: [{ id: "you", name: "You" }],
    payslips: [slipFor("you", "2026-08", 999999, {
      grossPence: 300000,
      taxPence: 40000,
      niPence: 20000,
      netPence: 999999,
    })],
  };
  const flow = cashflowForMonth(hh, "2026-08", new Date("2026-08-10T12:00:00Z"));
  assert.equal(flow.incomePence, 240000);
});

test("weekly ticks and purchased one-offs do not move Out", () => {
  const hh = {
    ...emptyHousehold(),
    weeklyRules: [{
      id: "food",
      name: "Food shop",
      amountPence: 7000,
      cadence: "times",
      timesPerMonth: 4,
      tickedKeys: [],
    }],
    oneOffs: [{ id: "o-1", name: "MOT", month: "2026-08", estimatePence: 40000, purchased: false }],
  };
  const today = new Date("2026-08-10T12:00:00Z");
  const before = cashflowForMonth(hh, "2026-08", today);
  assert.equal(before.outPence, 68000);
  toggleWeeklySlotTick(hh, before.weeklySlots[0].id, "2026-08");
  const afterTick = cashflowForMonth(hh, "2026-08", today);
  assert.equal(afterTick.outPence, before.outPence);
  assert.equal(afterTick.weeklySlots.filter((slot) => slot.ticked).length, 1);
  hh.oneOffs[0].purchased = true;
  const afterBuy = cashflowForMonth(hh, "2026-08", today);
  assert.equal(afterBuy.outPence, before.outPence);
  assert.equal(afterBuy.oneOffsPence, 40000);
});

test("the settings category list keeps the sheet column set after a slip is saved", () => {
  const hh = {
    ...emptyHousehold(),
    payslips: [{
      taxPence: 4000,
      niPence: 2000,
      otherDeductions: [{ id: "smp", label: "SMP", amountPence: 5000, inNet: false }],
    }],
  };
  rememberPayslipCategories(hh, []);
  const labels = hh.payslipCategories.map((item) => item.label);
  assert.ok(DEFAULT_PAYSLIP_CATEGORIES.every((item) => labels.includes(item.label)));
  assert.ok(hh.payslipCategories.some((item) => item.kind === "parental" && item.label === "SMP"));
  assert.ok(hh.payslipCategories.some((item) => item.label === "Jury service"));
});

test("a new payslip defaults to the previous month’s used categories", () => {
  const hh = {
    ...emptyHousehold(),
    people: [{ id: "you", name: "You" }],
    payslipCategories: [
      { id: "bonus", label: "Bonus", kind: "bonus" },
      { id: "tax", label: "Tax", kind: "tax" },
      { id: "gym", label: "Gym", kind: "deduction" },
      { id: "cycle", label: "Cycle", kind: "deduction" },
    ],
    payslips: [{
      id: "aug",
      personId: "you",
      periodMonth: "2026-08",
      bonusPence: 25000,
      taxPence: 60000,
      otherDeductions: [{ id: "gym", label: "Gym", amountPence: 4000 }],
    }],
  };
  const defaults = defaultCategoriesForNewPayslip(hh, "you");
  assert.deepEqual(defaults.map((item) => item.id).sort(), ["bonus", "gym", "tax"]);
  assert.equal(defaults.some((item) => item.id === "cycle"), false);
});

test("pending table rows add to the total without a per-row modal", () => {
  const hh = { ...emptyHousehold(), pendings: [] };
  addPendingRow(hh, { id: "p-1", amountPence: 2500, note: "", month: "2026-08" });
  addPendingRow(hh, { id: "p-2", amountPence: 1750, note: "hold", month: "2026-08" });
  assert.equal(hh.pendings.length, 2);
  assert.equal(pendingListTotalPence(hh.pendings), 4250);
  assert.equal(pendingsForMonth(hh, "2026-08", new Date("2026-08-26T12:00:00Z")).length, 2);
  const flow = cashflowForMonth(hh, "2026-08", new Date("2026-08-26T12:00:00Z"));
  assert.equal(flow.pendingPence, 4250);
});

test("payslip ANI is gross plus benefits minus salary sacrifice", () => {
  assert.equal(payslipAniPence({
    grossPence: 900000,
    benefitsPence: 10000,
    salarySacrificePensionPence: 50000,
  }), 860000);
  assert.equal(payslipIsConfirmed({
    forecast: false,
    moneyLandsMonth: "2026-09",
    periodMonth: "2026-09",
  }, new Date("2026-08-26T12:00:00Z")), false);
  assert.equal(payslipIsConfirmed({
    forecast: false,
    moneyLandsMonth: "2026-08",
    periodMonth: "2026-08",
  }, new Date("2026-08-26T12:00:00Z")), true);
});

function slipFor(personId, landsMonth, netPence, extra = {}) {
  return slip(extra.periodMonth || landsMonth, netPence, {
    personId,
    netPence,
    moneyLandsMonth: landsMonth,
    ...extra,
  });
}

function slip(periodMonth, aniPence, extra = {}) {
  return {
    id: extra.id || `slip-${periodMonth}-${extra.personId || "you"}`,
    personId: "you",
    taxYear: "2026-27",
    periodMonth,
    salaryPence: aniPence,
    grossPence: aniPence,
    bonusPence: 0,
    benefitsPence: 0,
    salarySacrificePensionPence: 0,
    otherDeductions: [],
    taxPence: 0,
    niPence: 0,
    netPence: aniPence,
    note: "",
    moneyLandsMonth: periodMonth,
    forecast: false,
    ...extra,
  };
}
