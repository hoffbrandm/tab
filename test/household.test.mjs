import test from "node:test";
import assert from "node:assert/strict";
import { formatMoney } from "../calculations.js";
import {
  ANI_LIMIT_PENCE,
  aniFromHousehold,
  aniProjection,
  annualReservePence,
  addPendingRow,
  assertWeeklyRuleAmount,
  cashflowForMonth,
  clearPendingsForMonth,
  coerceMonthKey,
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
  keepPayslipFormRows,
  monthlyIsAllowed,
  payslipAniPence,
  payslipCategoriesOf,
  payslipIsConfirmed,
  payslipNetPence,
  payslipNetCheck,
  payslipNetHints,
  payslipGrossPaidPence,
  payslipDeductionsPence,
  payslipTaxablePayPence,
  basicRateGrossUpPence,
  payslipRecordLabels,
  pendingListTotalPence,
  pendingsForMonth,
  potsNeedCurrentMonthLog,
  rememberPayslipCategories,
  resetMonthTicks,
  savingLine,
  spendVerdict,
  spentSoFarForMonth,
  toggleWeeklySlotTick,
  ukTaxYearFromDate,
  viewPeriodLabel,
  weekliesForMonth,
  WEEKLY_CADENCE_OPTIONS,
  WEEKLY_CADENCES,
  weeklyCadenceLabel,
  weeklySlotKeysForRule,
  weeklySlotsForMonth,
  weeklyPaidFrom,
  normalizeWeeklyCadence,
  oneOffsForMonth,
  oneOffsOutsideMonth,
  exceptionsForMonth,
  exceptionsOutsideMonth,
  exceptionsTotalPence,
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
  assert.deepEqual(emptyHousehold().reserves, []);
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
  assert.equal(flow.remainingAfterPlanPence, 271000);
  assert.equal(flow.tickedWeeklyPence, 7000);
  assert.equal(flow.dueCardMonthliesPence, 2000);
  assert.equal(flow.purchasedOneOffsPence, 0);
  assert.equal(flow.reserveSpentPence, 0);
  assert.equal(flow.spentSoFarPence, 9000);
  assert.equal(flow.actualOnCardsPence, 100000);
  assert.equal(flow.cardCheckPence, -91000);
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
  assert.equal(reserved.spentSoFarPence, flow.spentSoFarPence);
  assert.equal(reserved.cardCheckPence, flow.cardCheckPence);
  assert.equal(reserved.reserveSpentPence, 0);

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
  assert.equal(flow.actualOnCardsPence, 108000);
  assert.equal(flow.spentSoFarPence, 9000);
  assert.equal(flow.cardCheckPence, -99000);
  assert.equal(flow.overUnderPence, flow.cardCheckPence);
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
  assert.equal(july.dueCardMonthliesPence, 2000);
  assert.equal(july.tickedWeeklyPence, 14000);
  assert.equal(july.spentSoFarPence, 16000);
  assert.equal(july.cardBalancesPence, 2000);
  assert.equal(july.cardCheckPence, 14000);
  assert.equal(august.cardBalancesPence, 9000);
  assert.equal(august.dueCardMonthliesPence, 0);
  assert.equal(august.spentSoFarPence, 0);
  assert.equal(august.cardCheckPence, -9000);

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
  const legacy = { id: "litter", name: "Cat litter", amountPence: 1200, cadence: "once", tickedKeys: [] };
  const nTimes = { id: "litter", name: "Cat litter", amountPence: 1200, cadence: "times", timesPerMonth: 1, tickedKeys: [] };
  assert.deepEqual(normalizeWeeklyCadence(legacy), { cadence: "times", timesPerMonth: 1 });
  assert.deepEqual(weeklySlotKeysForRule(legacy, "2026-08"), ["1"]);
  assert.deepEqual(weeklySlotKeysForRule(nTimes, "2026-08"), ["1"]);
  assert.equal(weeklySlotsForMonth({ weeklyRules: [nTimes], weeklyExtras: [] }, "2026-08").length, 1);
  assert.equal(weeklySlotsForMonth({ weeklyRules: [nTimes], weeklyExtras: [] }, "2026-05").length, 1);
  assert.equal(weeklyCadenceLabel(nTimes), "Once a month");
});

test("cadence options are N times a month and every week on a chosen weekday", () => {
  assert.deepEqual(WEEKLY_CADENCES, ["times", "weekday"]);
  assert.deepEqual(WEEKLY_CADENCE_OPTIONS.map((item) => item.value), ["times", "weekday"]);
  assert.equal(WEEKLY_CADENCE_OPTIONS.some((item) => /once a month/i.test(item.label)), false);
  assert.equal(WEEKLY_CADENCE_OPTIONS.some((item) => item.label === "Every weekday"), false);
  assert.equal(WEEKLY_CADENCE_OPTIONS.find((item) => item.value === "weekday").label, "Every week on a chosen weekday");
  assert.deepEqual(normalizeWeeklyCadence({}), { cadence: "times", timesPerMonth: 1 });
});

test("a weekly rule requires a typical amount", () => {
  assert.throws(() => assertWeeklyRuleAmount(0), /Typical amount is required/);
  assert.throws(() => assertWeeklyRuleAmount(null), /Typical amount is required/);
  assert.equal(assertWeeklyRuleAmount(5000), 5000);
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
  assert.equal(jumpToCurrentMonthLabel("2026-09", today), "Back to August");
  assert.equal(jumpToCurrentMonthLabel("2026-08", today), "");
  const september = cashflowForMonth({ ...emptyHousehold(), annualBills: [] }, "2026-09", today);
  assert.equal(savingLine({ ...september, potPence: -100, leftPence: -100 }, today), "September 2026 does not balance yet.");
  assert.equal(spendVerdict(0, formatMoney, { month: "2026-09", today }), "");
  assert.equal(spendVerdict(0, formatMoney, { month: "2026-08", today }), "");
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

test("the over-allowed headline is gone", () => {
  const today = new Date("2026-08-26T12:00:00Z");
  assert.equal(spendVerdict(2000, formatMoney), "");
  assert.equal(spendVerdict(-4500, formatMoney), "");
  assert.equal(spendVerdict(0, formatMoney), "");
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

test("grossed-up Gift Aid comes off adjusted net income", () => {
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
  // £800 given with Gift Aid is £1,000 gross, and adjusted net income is net
  // income less the gross donation — so it takes £1,000 off, not £200 on.
  assert.equal(result.giftAidReliefPence, 100000);
  assert.equal(result.ytdPence, 900000);
  assert.equal(result.projectedPence, result.ytdPence + result.projectedRestPence - 100000);
});

test("Gift Aid relief is off unless the planner asks for it", () => {
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
  assert.equal(off.giftAidReliefPence, 0);
  assert.equal(on.giftAidReliefPence, 100000);
  assert.equal(on.projectedPence, off.projectedPence - 100000);
  assert.ok(on.extraSacrificePence < off.extraSacrificePence);
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

test("payslip net is the slip's own arithmetic: gross paid less deductions", () => {
  assert.equal(isParentalPayLabel("SMP"), true);
  assert.equal(isParentalPayLabel("Enhanced maternity"), true);
  assert.equal(isParentalPayLabel("OSPP"), true);
  assert.equal(isParentalPayLabel("Jury service"), false);
  const slip = {
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
  };
  // Gross is the Payments total, so the bonus is already inside it. A taxable
  // benefit is never paid, so it is not in there and is not added. The salary
  // sacrifice reduced gross before it was struck, so it is not a deduction.
  // 4000 gross − (600 tax + 200 NI + 40 gym + 80 cycle + 20 jury) = 3060.
  assert.equal(payslipGrossPaidPence(slip), 400000);
  assert.equal(payslipDeductionsPence(slip), 94000);
  assert.equal(payslipNetPence(slip), 306000);

  // The same slip, but the gross typed in is the figure before the sacrifice.
  assert.equal(payslipNetPence({ ...slip, grossBeforeSacrifice: true }), 276000);
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
  assert.equal(afterTick.incomePence, before.incomePence);
  assert.equal(afterTick.weeklySlots.filter((slot) => slot.ticked).length, 1);
  hh.oneOffs[0].purchased = true;
  const afterBuy = cashflowForMonth(hh, "2026-08", today);
  assert.equal(afterBuy.outPence, before.outPence);
  assert.equal(afterBuy.oneOffsPence, 40000);
});

test("ticking a £100 weekly leaves In and Out the same and raises savings by £100", () => {
  const hh = {
    ...emptyHousehold(),
    weeklyRules: [{
      id: "amazon",
      name: "Amazon",
      amountPence: 10000,
      cadence: "times",
      timesPerMonth: 1,
      tickedKeys: [],
    }],
    cards: [{
      id: "c-1",
      name: "Card",
      balancePence: 25000,
      pendingPence: 4000,
      updatedOn: "2026-08-26",
    }],
    pendings: [{ id: "p-1", amountPence: 1500, note: "hold", month: "2026-08" }],
  };
  const today = new Date("2026-08-26T12:00:00Z");
  const before = cashflowForMonth(hh, "2026-08", today);
  assert.equal(before.incomePence, 0);
  assert.equal(before.outPence, 10000);
  assert.equal(before.spentSoFarPence, 0);
  assert.equal(before.actualOnCardsPence, 30500);
  assert.equal(before.cardCheckPence, -30500);
  assert.equal(before.weeklySlots[0].paidFrom, "card");
  toggleWeeklySlotTick(hh, before.weeklySlots[0].id, "2026-08");
  const after = cashflowForMonth(hh, "2026-08", today);
  assert.equal(after.incomePence, before.incomePence);
  assert.equal(after.outPence, before.outPence);
  assert.equal(after.actualOnCardsPence, before.actualOnCardsPence);
  assert.equal(after.spentSoFarPence, 10000);
  assert.equal(after.cardCheckPence, before.cardCheckPence + 10000);
  toggleWeeklySlotTick(hh, before.weeklySlots[0].id, "2026-08");
  const undone = cashflowForMonth(hh, "2026-08", today);
  assert.equal(undone.cardCheckPence, before.cardCheckPence);
  assert.equal(undone.spentSoFarPence, 0);
});

test("a ticked cash weekly still counts in spent so far", () => {
  const hh = {
    ...emptyHousehold(),
    weeklyRules: [{
      id: "food",
      name: "Food shop",
      amountPence: 7000,
      cadence: "times",
      timesPerMonth: 1,
      paidFrom: "cash",
      tickedKeys: ["2026-08:1"],
    }],
  };
  const flow = cashflowForMonth(hh, "2026-08", new Date("2026-08-26T12:00:00Z"));
  assert.equal(weeklyPaidFrom({}), "card");
  assert.equal(weeklyPaidFrom({ paidFrom: "cash" }), "cash");
  assert.equal(flow.weeklySlots[0].paidFrom, "cash");
  assert.equal(flow.spentSoFarPence, 7000);
  assert.equal(flow.outPence, 7000);
});

test("a card monthly due on day 1 enters spent so far on the 1st without a tick", () => {
  const hh = {
    ...emptyHousehold(),
    monthlies: [{
      id: "netflix",
      name: "Netflix",
      amountPence: 1599,
      dueDay: 1,
      paidFrom: "card",
    }],
  };
  const before = cashflowForMonth(hh, "2026-09", new Date("2026-08-26T12:00:00Z"));
  assert.equal(before.spentSoFarPence, 0);
  assert.equal(before.outPence, 1599);
  const onDay = cashflowForMonth(hh, "2026-09", new Date("2026-09-01T12:00:00Z"));
  assert.equal(onDay.spentSoFarPence, 1599);
  assert.equal(onDay.outPence, 1599);
  assert.equal(onDay.dueCardMonthliesPence, 1599);
});

test("a card monthly due on day 6 is out of spent so far on the 5th and in on the 6th", () => {
  const hh = {
    ...emptyHousehold(),
    monthlies: [{
      id: "netflix",
      name: "Netflix",
      amountPence: 1599,
      dueDay: 6,
      paidFrom: "card",
    }],
    cards: [{
      id: "c-1",
      name: "Card",
      balancePence: 8000,
      pendingPence: 0,
      updatedOn: "2026-08-05",
    }],
  };
  const fifth = cashflowForMonth(hh, "2026-08", new Date("2026-08-05T12:00:00Z"));
  assert.equal(fifth.incomePence, 0);
  assert.equal(fifth.outPence, 1599);
  assert.equal(fifth.spentSoFarPence, 0);
  assert.equal(fifth.dueCardMonthliesPence, 0);
  assert.equal(fifth.actualOnCardsPence, 8000);
  assert.equal(fifth.cardCheckPence, -8000);
  const sixth = cashflowForMonth(hh, "2026-08", new Date("2026-08-06T12:00:00Z"));
  assert.equal(sixth.incomePence, fifth.incomePence);
  assert.equal(sixth.outPence, fifth.outPence);
  assert.equal(sixth.actualOnCardsPence, fifth.actualOnCardsPence);
  assert.equal(sixth.spentSoFarPence, 1599);
  assert.equal(sixth.dueCardMonthliesPence, 1599);
  assert.equal(sixth.cardCheckPence, fifth.cardCheckPence + 1599);
  const later = cashflowForMonth(hh, "2026-08", new Date("2026-08-26T12:00:00Z"));
  assert.equal(later.spentSoFarPence, 1599);
  assert.equal(later.outPence, fifth.outPence);
  assert.equal(later.cardCheckPence, sixth.cardCheckPence);
});

test("a standing cash monthly sits in Out and never in spent so far", () => {
  const hh = {
    ...emptyHousehold(),
    monthlies: [{
      id: "mortgage",
      name: "Mortgage",
      amountPence: 120000,
      dueDay: 1,
      paidFrom: "cash",
      paidMonths: ["2026-08"],
    }],
  };
  const first = cashflowForMonth(hh, "2026-08", new Date("2026-08-01T12:00:00Z"));
  const late = cashflowForMonth(hh, "2026-08", new Date("2026-08-26T12:00:00Z"));
  assert.equal(first.outPence, 120000);
  assert.equal(late.outPence, 120000);
  assert.equal(first.spentSoFarPence, 0);
  assert.equal(late.spentSoFarPence, 0);
  assert.equal(first.dueCardMonthliesPence, 0);
  assert.equal(late.billsPence, 120000);
  assert.equal(spentSoFarForMonth(hh, "2026-08", new Date("2026-08-26T12:00:00Z")).spentSoFarPence, 0);
});

test("purchasing a planned one-off raises savings and leaves In and Out unchanged", () => {
  const hh = {
    ...emptyHousehold(),
    oneOffs: [{ id: "o-1", name: "MOT", month: "2026-08", estimatePence: 40000, purchased: false }],
    cards: [{
      id: "c-1",
      name: "Card",
      balancePence: 5000,
      pendingPence: 0,
      updatedOn: "2026-08-10",
    }],
  };
  const today = new Date("2026-08-10T12:00:00Z");
  const before = cashflowForMonth(hh, "2026-08", today);
  assert.equal(before.outPence, 40000);
  assert.equal(before.spentSoFarPence, 0);
  assert.equal(before.cardCheckPence, -5000);
  hh.oneOffs[0].purchased = true;
  const after = cashflowForMonth(hh, "2026-08", today);
  assert.equal(after.incomePence, before.incomePence);
  assert.equal(after.outPence, before.outPence);
  assert.equal(after.actualOnCardsPence, before.actualOnCardsPence);
  assert.equal(after.purchasedOneOffsPence, 40000);
  assert.equal(after.spentSoFarPence, 40000);
  assert.equal(after.cardCheckPence, before.cardCheckPence + 40000);
});

test("a future month date-gates spent so far and has no this-month verdict", () => {
  const hh = {
    ...emptyHousehold(),
    weeklyRules: [{
      id: "amazon",
      name: "Amazon",
      amountPence: 10000,
      cadence: "times",
      timesPerMonth: 1,
      tickedKeys: [],
    }],
    monthlies: [{
      id: "phone",
      name: "Phone",
      amountPence: 4500,
      dueDay: 1,
      paidFrom: "card",
    }],
    oneOffs: [{ id: "o-1", name: "MOT", month: "2026-09", estimatePence: 20000, purchased: false }],
  };
  const today = new Date("2026-08-26T12:00:00Z");
  const september = cashflowForMonth(hh, "2026-09", today);
  assert.equal(september.dayOfMonth, 0);
  assert.equal(september.outPence, 34500);
  assert.equal(september.dueCardMonthliesPence, 0);
  assert.equal(september.spentSoFarPence, 0);
  assert.equal(september.cardCheckPence, 0);
  assert.equal(spendVerdict(september.overUnderPence, formatMoney, { month: "2026-09", today }), "");
  assert.equal(savingLine(september, today).includes("This month"), false);
  assert.equal(currentPeriodHint("2026-09", today), "September 2026");
  toggleWeeklySlotTick(hh, september.weeklySlots[0].id, "2026-09");
  hh.oneOffs[0].purchased = true;
  const after = cashflowForMonth(hh, "2026-09", today);
  assert.equal(after.outPence, september.outPence);
  assert.equal(after.incomePence, september.incomePence);
  assert.equal(after.dueCardMonthliesPence, 0);
  assert.equal(after.spentSoFarPence, 30000);
  assert.equal(after.cardCheckPence, 30000);
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

test("a just-added payslip row is kept even when the label is still empty", () => {
  const added = { id: "new-row", label: "", kind: "deduction" };
  assert.equal(payslipCategoriesOf({ payslipCategories: [added] }).length, 0);
  assert.deepEqual(keepPayslipFormRows([added, { id: "", label: "Ghost" }]).map((item) => item.id), ["new-row"]);
});

test("pending amounts do not list on a future month when they belong to this month", () => {
  const today = new Date("2026-08-26T12:00:00Z");
  const hh = {
    ...emptyHousehold(),
    pendings: [{ id: "p-1", note: "hold", amountPence: 6000, month: "2026-08" }],
  };
  const august = pendingsForMonth(hh, "2026-08", today);
  const september = pendingsForMonth(hh, "2026-09", today);
  assert.equal(august.length, 1);
  assert.equal(pendingListTotalPence(august), 6000);
  assert.equal(september.length, 0);
  assert.equal(pendingListTotalPence(september), 0);
  assert.equal(cashflowForMonth(hh, "2026-09", today).pendingPence, 0);
});

test("clearing pending empties the table and pending total without touching cards", () => {
  const today = new Date("2026-08-26T12:00:00Z");
  const hh = {
    ...emptyHousehold(),
    cards: [{ id: "c-1", name: "Card one", balancePence: 80000, pendingPence: 1200, updatedOn: "2026-08-10" }],
    pendings: [
      { id: "p-1", amountPence: 2500, note: "hold", month: "2026-08" },
      { id: "p-2", amountPence: 1750, note: "", month: "2026-08" },
      { id: "p-3", amountPence: 900, note: "later", month: "2026-09" },
    ],
  };
  const before = cashflowForMonth(hh, "2026-08", today);
  assert.equal(before.pendingRows.length, 2);
  assert.equal(pendingListTotalPence(before.pendingRows), 4250);
  clearPendingsForMonth(hh, "2026-08", today);
  const after = cashflowForMonth(hh, "2026-08", today);
  assert.equal(after.pendingRows.length, 0);
  assert.equal(pendingListTotalPence(after.pendingRows), 0);
  assert.equal(hh.pendings.length, 1);
  assert.equal(hh.pendings[0].id, "p-3");
  assert.equal(hh.cards[0].balancePence, 80000);
  assert.equal(hh.cards[0].pendingPence, 1200);
});

test("one-offs for month X appear on Home for viewMonth X and sit in Out", () => {
  const today = new Date("2026-08-10T12:00:00Z");
  const hh = {
    ...emptyHousehold(),
    oneOffs: [
      { id: "o-1", name: "MOT", month: "August 2026", estimatePence: 40000, purchased: false },
      { id: "o-2", name: "Holiday", month: "2026-12-01", estimatePence: 80000, purchased: false },
      { id: "o-3", name: "Sofa", month: "2026-8", estimatePence: 120000, purchased: true },
    ],
  };
  hh.oneOffs = hh.oneOffs.map((item) => ({ ...item, month: coerceMonthKey(item.month) }));
  const august = oneOffsForMonth(hh, "2026-08");
  assert.deepEqual(august.map((item) => item.name).sort(), ["MOT", "Sofa"]);
  assert.deepEqual(oneOffsOutsideMonth(hh, "2026-08").map((item) => item.name), ["Holiday"]);
  const flow = cashflowForMonth(hh, "2026-08", today);
  assert.deepEqual(flow.oneOffs.map((item) => item.name).sort(), ["MOT", "Sofa"]);
  assert.equal(flow.oneOffsPence, 160000);
  assert.equal(flow.outPence, 160000);
  hh.oneOffs.find((item) => item.id === "o-1").purchased = true;
  const afterTick = cashflowForMonth(hh, "2026-08", today);
  assert.equal(afterTick.outPence, 160000);
  assert.equal(afterTick.oneOffs.every((item) => item.id !== "o-2"), true);
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

test("payslip ANI is taxable pay plus taxable benefits", () => {
  // Gross is already after the sacrifice, so taking it off again here would
  // understate adjusted net income — the direction that hides a £100k breach.
  assert.equal(payslipAniPence({
    grossPence: 900000,
    benefitsPence: 10000,
    salarySacrificePensionPence: 50000,
  }), 910000);
  assert.equal(payslipAniPence({
    grossPence: 900000,
    benefitsPence: 10000,
    salarySacrificePensionPence: 50000,
    grossBeforeSacrifice: true,
  }), 860000);
  // With no gross typed, salary is contractual and so sits before the sacrifice.
  assert.equal(payslipAniPence({
    salaryPence: 800000,
    bonusPence: 100000,
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

test("Savings is In minus Out and Total savings adds the card under/overspend", () => {
  const today = new Date("2026-08-10T12:00:00Z");
  const flow = cashflowForMonth(household, "2026-08", today);
  assert.equal(flow.incomePence, 500000);
  assert.equal(flow.outPence, 229000);
  assert.equal(flow.savingsPence, 271000);
  assert.equal(flow.savingsPence, flow.leftPence);
  assert.equal(flow.allowanceSoFarPence, 9000);
  assert.equal(flow.actualOnCardsPence, 100000);
  assert.equal(flow.overUnderPence, -91000);
  assert.equal(flow.overspendPence, 91000);
  assert.equal(flow.underspendPence, 0);
  assert.equal(flow.totalSavingsPence, 271000 - 91000);
});

test("a card balance lowers Total savings pound for pound and leaves Savings alone", () => {
  const today = new Date("2026-08-10T12:00:00Z");
  const before = cashflowForMonth({ ...household, cards: [] }, "2026-08", today);
  const after = cashflowForMonth({
    ...household,
    cards: [{ id: "card-1", name: "Amex", balancePence: 25000, updatedOn: "2026-08-01" }],
  }, "2026-08", today);
  assert.equal(after.savingsPence, before.savingsPence);
  assert.equal(after.totalSavingsPence, before.totalSavingsPence - 25000);
});

test("an exception raises the card allowance without moving Savings", () => {
  const today = new Date("2026-08-10T12:00:00Z");
  const base = { ...household, cards: [{ id: "card-1", name: "Amex", balancePence: 65000, updatedOn: "2026-08-01" }], pendings: [] };
  const before = cashflowForMonth(base, "2026-08", today);
  const withException = cashflowForMonth({
    ...base,
    exceptions: [{ id: "x-1", name: "Travel insurance", month: "2026-08", amountPence: 56000 }],
  }, "2026-08", today);
  assert.equal(withException.exceptionsPence, 56000);
  assert.equal(withException.allowanceSoFarPence, before.allowanceSoFarPence + 56000);
  assert.equal(withException.savingsPence, before.savingsPence);
  assert.equal(withException.overUnderPence, before.overUnderPence + 56000);
  assert.equal(withException.totalSavingsPence, before.totalSavingsPence + 56000);

  const otherMonth = cashflowForMonth({
    ...base,
    exceptions: [{ id: "x-1", name: "Travel insurance", month: "2026-07", amountPence: 56000 }],
  }, "2026-08", today);
  assert.equal(otherMonth.exceptionsPence, 0);
  assert.equal(otherMonth.totalSavingsPence, before.totalSavingsPence);
});

test("exceptions are read for the month on screen", () => {
  const hh = {
    ...emptyHousehold(),
    exceptions: [
      { id: "x-1", name: "Travel insurance", month: "2026-08", amountPence: 56000 },
      { id: "x-2", name: "School trip", month: "2026-08", amountPence: 4000 },
      { id: "x-3", name: "Ski hire", month: "2026-09", amountPence: 12000 },
    ],
  };
  assert.deepEqual(exceptionsForMonth(hh, "2026-08").map((item) => item.name), ["Travel insurance", "School trip"]);
  assert.equal(exceptionsTotalPence(hh, "2026-08"), 60000);
  assert.equal(exceptionsTotalPence(hh, "2026-10"), 0);
  assert.deepEqual(exceptionsOutsideMonth(hh, "2026-08").map((item) => item.id), ["x-3"]);

  // A month written the sheet's way still lands in August.
  const loose = { ...emptyHousehold(), exceptions: [{ id: "x-4", name: "Travel insurance", month: "August 2026", amountPence: 56000 }] };
  assert.equal(exceptionsTotalPence(loose, "2026-08"), 56000);
});

test("the card check needs a balance recorded for the month on screen", () => {
  const today = new Date("2026-08-26T12:00:00Z");
  const hh = {
    ...emptyHousehold(),
    payslips: [slipFor("you", "2026-08", 300000)],
    people: [{ id: "you", name: "You" }],
    weeklyRules: [{ id: "food", name: "Food shop", amountPence: 7000, cadence: "times", timesPerMonth: 2, tickedKeys: ["2026-07:1", "2026-07:2", "2026-08:1"] }],
    cards: [{ id: "c-1", name: "Card", balancePence: 9000, pendingPence: 0, updatedOn: "2026-08-10" }],
  };

  // August has a snapshot seeded from updatedOn, so the check is live.
  const august = cashflowForMonth(hh, "2026-08", today);
  assert.equal(august.cardCheckKnown, true);
  assert.equal(august.cardBalancesPence, 9000);
  assert.equal(august.overUnderPence, 7000 - 9000);
  assert.equal(august.totalSavingsPence, august.savingsPence - 2000);

  // July has none. Reading the missing balance as £0 would have reported the
  // whole £140 allowance as underspend.
  const july = cashflowForMonth(hh, "2026-07", today);
  assert.equal(july.cardCheckKnown, false);
  assert.deepEqual(july.cardsMissingSnapshot.map((card) => card.id), ["c-1"]);
  assert.equal(july.allowanceSoFarPence, 14000);
  assert.equal(july.cardCheckPence, 14000);
  assert.equal(july.overUnderPence, 0);
  assert.equal(july.totalSavingsPence, july.savingsPence);

  // No cards at all is a knowable check, not a missing one.
  const noCards = cashflowForMonth({ ...hh, cards: [] }, "2026-07", today);
  assert.equal(noCards.cardCheckKnown, true);
  assert.equal(noCards.overUnderPence, 14000);
});

test("pending splits into the table and anything left on the cards", () => {
  const today = new Date("2026-08-10T12:00:00Z");
  const hh = {
    ...emptyHousehold(),
    cards: [{ id: "c-1", name: "Card", balancePence: 50000, pendingPence: 3000, updatedOn: "2026-08-10" }],
    pendings: [{ id: "p-1", note: "Coffee", amountPence: 500, month: "2026-08" }],
  };
  const flow = cashflowForMonth(hh, "2026-08", today);
  assert.equal(flow.cardPendingPence, 3000);
  assert.equal(flow.pendingTablePence, 500);
  assert.equal(flow.pendingPence, 3500);
  assert.equal(flow.actualOnCardsPence, 53500);
});

test("the net on the slip is checked against the net these figures produce", () => {
  const base = {
    grossPence: 350000,
    salarySacrificePensionPence: 20000,
    taxPence: 60000,
    niPence: 28000,
    otherDeductions: [{ id: "cycle", label: "Cycle scheme", amountPence: 4000 }],
  };
  assert.equal(payslipNetPence(base), 258000);
  assert.equal(payslipNetCheck(base), null, "no stated net means nothing to check");

  const matching = { ...base, statedNetPence: 258000 };
  assert.equal(payslipNetCheck(matching).matches, true);
  assert.deepEqual(payslipNetHints(matching), []);

  // Out by exactly the sacrifice: the gross typed in is the before figure.
  const preSacrifice = { ...base, statedNetPence: 238000 };
  const check = payslipNetCheck(preSacrifice);
  assert.equal(check.matches, false);
  assert.equal(check.differencePence, 20000);
  assert.match(payslipNetHints(preSacrifice)[0], /exactly the salary sacrifice/);
  assert.match(payslipNetHints(preSacrifice)[0], /before salary sacrifice/);

  // Ticking the box resolves it.
  assert.equal(payslipNetCheck({ ...preSacrifice, grossBeforeSacrifice: true }).matches, true);

  // Taking it off twice is named too.
  const doubled = { ...base, statedNetPence: 258000, grossBeforeSacrifice: true };
  assert.match(payslipNetHints(doubled)[0], /taken off twice/);

  // Out by exactly the bonus: gross was typed as basic pay only.
  const missingBonus = { ...base, bonusPence: 50000, statedNetPence: 308000 };
  assert.match(payslipNetHints(missingBonus)[0], /exactly the bonus/);

  // Anything else falls back to naming the direction.
  const other = { ...base, statedNetPence: 250000 };
  assert.match(payslipNetHints(other)[0], /a deduction is probably missing/);
});

test("a taxable benefit counts for the £100k line and never for take-home", () => {
  const slip = { grossPence: 400000, benefitsPence: 60000, taxPence: 80000, niPence: 20000 };
  // A benefit in kind is notional. It is taxed but never paid.
  assert.equal(payslipNetPence(slip), 300000);
  assert.equal(payslipTaxablePayPence(slip), 400000);
  assert.equal(payslipAniPence(slip), 460000);
});

test("a relief-at-source pension comes off pay, and off ANI grossed up", () => {
  const slip = {
    grossPence: 500000,
    taxPence: 80000,
    niPence: 30000,
    reliefAtSourcePensionPence: 20000,
  };
  // It is paid out of pay, unlike a sacrifice, so take-home drops by the £200.
  assert.equal(payslipNetPence(slip), 370000);
  // The provider reclaims basic rate, so £200 in is £250 of pension.
  assert.equal(basicRateGrossUpPence(20000), 25000);
  assert.equal(payslipAniPence(slip), 500000 - 25000);

  // A sacrifice of the same size never reached taxable pay, so it needs no
  // second deduction — the two must not be modelled the same way.
  const sacrificed = { grossPence: 500000, taxPence: 80000, niPence: 30000, salarySacrificePensionPence: 20000 };
  assert.equal(payslipNetPence(sacrificed), 390000);
  assert.equal(payslipAniPence(sacrificed), 500000);
});

test("the sacrifice category says which pension it is", () => {
  const labels = DEFAULT_PAYSLIP_CATEGORIES.map((item) => item.label);
  assert.ok(labels.includes("Salary sacrifice pension"));
  assert.ok(labels.includes("Pension (relief at source)"));
  assert.equal(labels.includes("Pensions"), false);
});
