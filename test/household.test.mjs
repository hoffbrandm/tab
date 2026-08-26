import test from "node:test";
import assert from "node:assert/strict";
import { formatMoney } from "../calculations.js";
import {
  ANI_LIMIT_PENCE,
  aniFromHousehold,
  aniProjection,
  annualReservePence,
  cashflowForMonth,
  currentPeriodHint,
  currentUkTaxYear,
  emptyHousehold,
  envelopeMonthlyPence,
  giftAidGrossPence,
  householdHasData,
  incomeFromPayslipsPence,
  payslipAniPence,
  payslipIsConfirmed,
  payslipRecordLabels,
  resetMonthTicks,
  savingLine,
  spendVerdict,
  ukTaxYearFromDate,
  viewPeriodLabel,
  weekliesForMonth,
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

test("cashflow totals use this month’s one-offs and annual reserve / 12", () => {
  const flow = cashflowForMonth(household, "2026-08", new Date("2026-08-10T12:00:00Z"));
  assert.equal(flow.incomePence, 500000);
  assert.equal(flow.billsPence, 140000);
  assert.equal(flow.annualReservePence, 10000);
  assert.equal(flow.oneOffsPence, 40000);
  assert.equal(flow.oneOffs.map((item) => item.name).join(), "MOT");
  assert.equal(flow.committedOutPence, 190000);
  assert.equal(flow.potPence, 310000);
  assert.equal(flow.daysInMonth, 31);
  assert.equal(flow.dayOfMonth, 10);
  assert.equal(flow.allowedSoFarPence, 100000);
  assert.equal(flow.subsAllowedPence, 2000);
  assert.equal(flow.allowedWithSubsPence, 102000);
  assert.equal(flow.cardBalancesPence, 100000);
  assert.equal(flow.overUnderPence, 2000);
  assert.equal(flow.envelopesMonthlyPence, envelopeMonthlyPence(7000, "2026-08"));
  assert.equal(annualReservePence(household.annualBills), 10000);
});

test("daily envelope pro-rate is pot / days in month * day of month", () => {
  const flow = cashflowForMonth(household, "2026-08", new Date("2026-08-10T12:00:00Z"));
  assert.equal(flow.allowedSoFarPence, Math.round((310000 / 31) * 10));
});

test("a ticked card sub counts as allowed before its due day", () => {
  const ticked = {
    ...household,
    cardSubs: [{ id: "s-2", name: "Later sub", amountPence: 9000, dueDay: 28, paidMonths: ["2026-08"] }],
  };
  const flow = cashflowForMonth(ticked, "2026-08", new Date("2026-08-10T12:00:00Z"));
  assert.equal(flow.subsAllowedPence, 9000);
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
  assert.equal(flow.overUnderPence, -6000);
});

test("a new-month reset clears ticks for that month only", () => {
  const copy = structuredClone(household);
  resetMonthTicks(copy, "2026-08");
  assert.deepEqual(copy.bills[0].paidMonths, []);
  assert.deepEqual(copy.envelopes[0].happenedDates, []);
  assert.equal(copy.envelopes[0].name, "Food shop");
  assert.equal(copy.envelopes[0].weeklyPence, 7000);
  assert.equal(savingLine(cashflowForMonth(household, "2026-08", new Date("2026-08-10T12:00:00Z")), new Date("2026-08-10T12:00:00Z")), "On track to save.");
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
  assert.equal(savingLine({ ...past, potPence: -100 }, today), "March 2026 does not balance yet.");
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

test("over and underspend are plain English", () => {
  assert.equal(spendVerdict(2000, formatMoney), "£20.00 under — room on the cards.");
  assert.equal(spendVerdict(-4500, formatMoney), "£45.00 over the allowed-so-far.");
  assert.equal(spendVerdict(0, formatMoney), "Cards match the allowed-so-far.");
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
