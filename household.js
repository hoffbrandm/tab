/** Household money: UK pence, April tax years, Gift Aid at 25%. */

export const ANI_LIMIT_PENCE = 10_000_000;
export const DEFAULT_PEOPLE = [
  { id: "person-you", name: "You" },
  { id: "person-partner", name: "Partner" },
];
export const PENSION_STATUSES = ["active", "deferred", "drawing", "other"];
export const WEEKLY_CADENCES = ["times", "weekday"];
export const WEEKLY_CADENCE_OPTIONS = [
  { value: "times", label: "N times a month" },
  { value: "weekday", label: "Every week on a chosen weekday" },
];
export const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];
export const MONTHLY_PAID_FROM = ["card", "cash"];
// "First working day of the month" was only ever "day 1, or the next working
// day" — the same rule with dueDay 1 — so it is no longer its own roll.
export const DUE_ROLLS = ["calendar", "nextWorking"];
export const PAYSLIP_CATEGORY_KINDS = ["bonus", "benefits", "sacrifice", "pension", "tax", "ni", "extra", "deduction", "parental"];
export const BUILTIN_PAYSLIP_CATEGORIES = [
  { id: "bonus", label: "Bonus", kind: "bonus" },
  // The payslip's own word. Whether the benefit is money you receive or is only
  // taxed is settled by the net the payslip prints, not by picking a category:
  // nobody should have to know the difference to enter their own pay.
  { id: "benefits", label: "Benefits", kind: "benefits" },
  // "Pensions" said nothing about which kind, and the two behave differently.
  { id: "sacrifice", label: "Salary sacrifice pension", kind: "sacrifice" },
  { id: "pension", label: "Pension (relief at source)", kind: "pension" },
  { id: "tax", label: "Tax", kind: "tax" },
  { id: "ni", label: "NI", kind: "ni" },
];
export const SHEET_PAYSLIP_DEDUCTIONS = [
  // A funded cashplan is added to the payments and taken straight back off, so
  // it shows on the slip as two lines that cancel. Both are here, because a
  // slip that shows two lines should be enterable as two lines.
  { id: "cashplan-funded", label: "Cashplan funded", kind: "extra" },
  { id: "cashplan-deducted", label: "Cashplan deducted", kind: "deduction" },
  { id: "will-writing", label: "Will writing", kind: "deduction" },
  { id: "critical-illness-ee", label: "Critical illness EE", kind: "deduction" },
  { id: "critical-illness-dp", label: "Critical illness DP", kind: "deduction" },
  { id: "payroll-giving", label: "Payroll giving", kind: "deduction" },
  { id: "gym-flex", label: "Gym flex", kind: "deduction" },
  { id: "dental", label: "Dental", kind: "deduction" },
  { id: "cycle-scheme", label: "Cycle scheme", kind: "deduction" },
  { id: "jury-service", label: "Jury service", kind: "deduction" },
  { id: "smp", label: "SMP", kind: "parental" },
  { id: "enhanced-maternity", label: "Enhanced maternity", kind: "parental" },
  { id: "enhanced-paternity", label: "Enhanced paternity", kind: "parental" },
  { id: "ospp", label: "OSPP", kind: "parental" },
];
export const DEFAULT_PAYSLIP_CATEGORIES = [
  ...BUILTIN_PAYSLIP_CATEGORIES,
  ...SHEET_PAYSLIP_DEDUCTIONS,
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const TAX_YEAR = /^\d{4}-\d{2}$/;
const MONTH_NAMES = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

export function emptyHousehold() {
  return {
    people: DEFAULT_PEOPLE.map((person) => ({ ...person })),
    incomes: [],
    bills: [],
    envelopes: [],
    monthlies: [],
    weeklyRules: [],
    weeklyExtras: [],
    cards: [],
    cardSubs: [],
    pendings: [],
    // The month's spending money as one figure for the whole month. It is
    // divided by the days in the month to give a rate, and the days elapsed
    // decide how much of it the cards are allowed to carry so far.
    perDiem: { amountPence: 0 },
    oneOffs: [],
    exceptions: [],
    fromSavings: [],
    setAsides: [],
    annualBills: [],
    pots: [],
    pensions: [],
    payslips: [],
    payslipCategories: [],
    donations: [],
    includeGiftAidInAni: true,
  };
}

export function householdHasData(household) {
  if (!household || typeof household !== "object") return false;
  const lists = [
    "incomes",
    "bills",
    "envelopes",
    "monthlies",
    "weeklyRules",
    "weeklyExtras",
    "cards",
    "cardSubs",
    "pendings",
    "oneOffs",
    "exceptions",
    "fromSavings",
    "setAsides",
    "annualBills",
    "pots",
    "pensions",
    "payslips",
    "donations",
  ];
  if (lists.some((key) => Array.isArray(household[key]) && household[key].length > 0)) return true;
  const names = (household.people || []).map((person) => String(person.name || "").trim());
  const defaults = DEFAULT_PEOPLE.map((person) => person.name);
  return names.length > 0 && (names.length !== defaults.length || names.some((name, index) => name !== defaults[index]));
}

export function isoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthKey(date = new Date()) {
  return isoDate(date).slice(0, 7);
}

export function parseMonthKey(month) {
  if (!MONTH.test(String(month || ""))) return null;
  const [year, mon] = String(month).split("-").map(Number);
  if (mon < 1 || mon > 12) return null;
  return { year, month: mon };
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function daysInMonthKey(month) {
  const parsed = parseMonthKey(month);
  if (!parsed) return 0;
  return daysInMonth(parsed.year, parsed.month);
}

export function addMonths(month, delta) {
  const parsed = parseMonthKey(month);
  if (!parsed) return month;
  const date = new Date(parsed.year, parsed.month - 1 + delta, 1);
  return monthKey(date);
}

export function monthLabel(month) {
  const parsed = parseMonthKey(month);
  if (!parsed) return String(month || "");
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(parsed.year, parsed.month - 1, 1),
  );
}

export function monthName(month) {
  const parsed = parseMonthKey(month);
  if (!parsed) return String(month || "");
  return new Intl.DateTimeFormat("en-GB", { month: "long" }).format(
    new Date(parsed.year, parsed.month - 1, 1),
  );
}

export function ordinalDay(day) {
  const n = Number(day);
  if (!Number.isInteger(n) || n < 1) return "";
  const remainder = n % 100;
  if (remainder >= 11 && remainder <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
}

export function taxYearLabel(startYear) {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

export function taxYearStartYear(label) {
  const match = String(label || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end !== (start + 1) % 100) return null;
  return start;
}

export function ukTaxYearFromDate(dateStr) {
  const text = String(dateStr || "");
  if (!DATE.test(text)) return "";
  const [year, month, day] = text.split("-").map(Number);
  const startsThisCalendarYear = month > 4 || (month === 4 && day >= 6);
  return taxYearLabel(startsThisCalendarYear ? year : year - 1);
}

export function currentUkTaxYear(today = new Date()) {
  return ukTaxYearFromDate(isoDate(today));
}

export function taxYearOptions(today = new Date(), years = 6) {
  const currentStart = taxYearStartYear(currentUkTaxYear(today));
  return Array.from({ length: years }, (_, index) => taxYearLabel(currentStart - index));
}

export function taxYearOptionsFor(selected, today = new Date(), years = 6) {
  const options = taxYearOptions(today, years);
  if (selected && isTaxYearLabel(selected) && !options.includes(selected)) options.push(selected);
  return options.sort().reverse();
}

export function isCurrentMonth(month, today = new Date()) {
  return month === monthKey(today);
}

/**
 * Home answers three questions: what the plan says, where today sits against
 * it, and where the month lands. Only a month in progress can answer the second
 * — a month that has not started has no "so far", and a finished one has no
 * "still to come" — so the phase decides which parts of the statement are real.
 */
export function monthPhase(month, today = new Date()) {
  const current = monthKey(today);
  if (month < current) return "past";
  if (month > current) return "future";
  return "current";
}

export function viewPeriodLabel(month) {
  return monthLabel(month);
}

export function currentPeriodHint(month, today = new Date()) {
  return isCurrentMonth(month, today) ? "This month" : monthLabel(month);
}

export function jumpToCurrentMonthLabel(viewedMonth, today = new Date()) {
  if (isCurrentMonth(viewedMonth, today)) return "";
  return `Back to ${monthName(monthKey(today))}`;
}

export function payslipLandsMonth(payslip) {
  return payslip?.moneyLandsMonth || payslip?.periodMonth || "";
}

export function payslipRecordLabels(payslip) {
  return {
    period: monthLabel(payslip?.periodMonth),
    lands: monthLabel(payslipLandsMonth(payslip)),
    taxYear: String(payslip?.taxYear || ""),
  };
}

export function payslipsForCashflowMonth(payslips, month) {
  return (payslips || []).filter((slip) => payslipLandsMonth(slip) === month);
}

export function incomeLinesFromPayslips(household, month) {
  const people = household?.people || [];
  return payslipsForCashflowMonth(household?.payslips, month).map((slip) => ({
    id: slip.id,
    personId: slip.personId,
    personName: people.find((person) => person.id === slip.personId)?.name || "",
    amountPence: payslipNetAsReadPence(slip),
    forecast: Boolean(slip.forecast),
    periodMonth: slip.periodMonth,
    moneyLandsMonth: payslipLandsMonth(slip),
    taxYear: slip.taxYear,
  }));
}

export function incomeFromPayslipsPence(household, month) {
  return sumPence(incomeLinesFromPayslips(household, month), (item) => item.amountPence);
}

export function weekliesForMonth(household, month) {
  if ((household?.weeklyRules || []).length || (household?.weeklyExtras || []).length) {
    return weeklySlotsForMonth(household, month);
  }
  return (household?.envelopes || []).map((item) => {
    const happenedDates = happenedInMonth(item, month);
    return {
      id: item.id,
      name: item.name,
      weeklyPence: item.weeklyPence,
      amountPence: item.weeklyPence,
      happenedDates,
      ticked: happenedDates.length > 0,
    };
  });
}

export function weekdayLabel(weekday) {
  return WEEKDAYS.find((item) => item.value === Number(weekday))?.label || "";
}

export function jsWeekdayToIso(jsDay) {
  return jsDay === 0 ? 7 : jsDay;
}

export function datesOfWeekdayInMonth(month, weekday) {
  const parsed = parseMonthKey(month);
  if (!parsed) return [];
  const wanted = Number(weekday);
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > 7) return [];
  const dates = [];
  const days = daysInMonth(parsed.year, parsed.month);
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(parsed.year, parsed.month - 1, day);
    if (jsWeekdayToIso(date.getDay()) === wanted) {
      dates.push(`${month}-${String(day).padStart(2, "0")}`);
    }
  }
  return dates;
}

export function normalizeWeeklyCadence(rule = {}) {
  if (rule.cadence === "weekday") {
    return { cadence: "weekday", weekday: Number(rule.weekday) };
  }
  if (rule.cadence === "once") {
    return { cadence: "times", timesPerMonth: 1 };
  }
  const times = Number(rule.timesPerMonth);
  return {
    cadence: "times",
    timesPerMonth: Number.isInteger(times) && times >= 1 && times <= 12 ? times : 1,
  };
}

export function assertWeeklyRuleAmount(amountPence) {
  if (!Number.isInteger(amountPence) || amountPence <= 0) {
    throw new Error("Typical amount is required.");
  }
  return amountPence;
}

export function weeklySlotKeysForRule(rule, month) {
  if (!rule) return [];
  const next = normalizeWeeklyCadence(rule);
  if (next.cadence === "weekday") return datesOfWeekdayInMonth(month, next.weekday);
  return Array.from({ length: next.timesPerMonth }, (_, index) => String(index + 1));
}

export function tickedKeysFromHappenedDates(dates) {
  const byMonth = new Map();
  for (const date of dates || []) {
    const month = String(date).slice(0, 7);
    if (!MONTH.test(month)) continue;
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(date);
  }
  const keys = [];
  for (const [month, items] of byMonth) {
    items.sort().forEach((_, index) => keys.push(`${month}:${index + 1}`));
  }
  return keys;
}

export function weeklyRulesOf(household) {
  if (Array.isArray(household?.weeklyRules) && household.weeklyRules.length) {
    return household.weeklyRules;
  }
  return (household?.envelopes || []).map((item) => ({
    id: item.id,
    name: item.name,
    amountPence: item.weeklyPence,
    cadence: "times",
    timesPerMonth: 4,
    weekday: 2,
    tickedKeys: tickedKeysFromHappenedDates(item.happenedDates),
    paidFrom: weeklyPaidFrom(item),
  }));
}

export function monthliesOf(household) {
  if (Array.isArray(household?.monthlies) && household.monthlies.length) {
    return household.monthlies;
  }
  return [
    ...(household?.bills || []).map((item) => ({ ...item, paidFrom: "cash" })),
    ...(household?.cardSubs || []).map((item) => ({ ...item, paidFrom: "card" })),
  ];
}

/**
 * The day of the month a weekly slot falls due, so a shop that has not come
 * round yet is not money the cards are allowed to be carrying.
 *
 * A rule set to a weekday says its own date. A rule set to N times a month has
 * no dates, so the slots are spread evenly and each falls due at the start of
 * its own slice: four shops in a 31-day month come due on the 1st, 8th, 16th
 * and 24th, which is the week-by-week shape the rule is standing in for.
 */
export function weeklySlotDueDay(slotKey, index, count, month) {
  if (DATE.test(String(slotKey))) return Number(String(slotKey).slice(8, 10));
  const days = daysInMonthKey(month);
  if (!days || !count || count <= 0) return 1;
  return Math.min(days, Math.floor((index * days) / count) + 1);
}

export function weeklySlotsForMonth(household, month) {
  const slots = [];
  for (const rule of weeklyRulesOf(household)) {
    const keys = weeklySlotKeysForRule(rule, month);
    keys.forEach((key, index) => {
      slots.push({
        id: `${rule.id}:${key}`,
        ruleId: rule.id,
        extraId: "",
        name: rule.name,
        amountPence: rule.amountPence,
        weeklyPence: rule.amountPence,
        month,
        slotKey: key,
        date: DATE.test(key) ? key : "",
        dueDay: weeklySlotDueDay(key, index, keys.length, month),
        ticked: (rule.tickedKeys || []).includes(`${month}:${key}`),
        adHoc: false,
        paidFrom: weeklyPaidFrom(rule),
      });
    });
  }
  for (const extra of (household?.weeklyExtras || []).filter((item) => item.month === month)) {
    slots.push({
      id: extra.id,
      ruleId: "",
      extraId: extra.id,
      name: extra.name,
      amountPence: extra.amountPence,
      weeklyPence: extra.amountPence,
      month,
      slotKey: extra.id,
      date: "",
      // An extra was added because it happened, so it is due the moment it is
      // there rather than waiting for a date it does not have.
      dueDay: 1,
      ticked: Boolean(extra.happened),
      adHoc: true,
      paidFrom: weeklyPaidFrom(extra),
    });
  }
  return slots;
}

/** A slot the month has reached: the cards are allowed to be carrying it. */
export function weeklySlotIsDue(slot, dayOfMonth) {
  return Number(slot?.dueDay || 1) <= dayOfMonth;
}

export function weeklyCadenceLabel(rule) {
  const next = normalizeWeeklyCadence(rule);
  if (next.cadence === "weekday") {
    const day = weekdayLabel(next.weekday);
    return day ? `Every week on ${day}` : "Every week on a chosen weekday";
  }
  return next.timesPerMonth === 1 ? "Once a month" : `${next.timesPerMonth} times a month`;
}

/** Old records may still say firstWorking; it means day 1, rolled forward. */
export function normalizeDueRoll(value) {
  if (value === "firstWorking") return "nextWorking";
  return DUE_ROLLS.includes(value) ? value : "calendar";
}

export function dueDayOf(item) {
  return item?.dueRoll === "firstWorking" ? 1 : item?.dueDay;
}

export function isUkWeekend(dateStr) {
  if (!DATE.test(String(dateStr || ""))) return false;
  const [year, month, day] = String(dateStr).split("-").map(Number);
  return jsWeekdayToIso(new Date(year, month - 1, day).getDay()) >= 6;
}

export function addDaysIso(dateStr, delta) {
  if (!DATE.test(String(dateStr || ""))) return "";
  const [year, month, day] = String(dateStr).split("-").map(Number);
  return isoDate(new Date(year, month - 1, day + Number(delta || 0)));
}

export function nextWorkingDate(dateStr) {
  let current = String(dateStr || "");
  if (!DATE.test(current)) return "";
  while (isUkWeekend(current)) current = addDaysIso(current, 1);
  return current;
}

export function firstWorkingDate(month) {
  const parsed = parseMonthKey(month);
  if (!parsed) return "";
  return nextWorkingDate(`${month}-01`);
}

export function calendarDueDate(month, dueDay) {
  const days = daysInMonthKey(month);
  if (!days) return "";
  const day = Number(dueDay);
  const clamped = Number.isInteger(day) && day > 0 ? Math.min(day, days) : 1;
  return `${month}-${String(clamped).padStart(2, "0")}`;
}

export function effectiveDueDate(item, month) {
  const roll = normalizeDueRoll(item?.dueRoll);
  const calendar = calendarDueDate(month, dueDayOf(item));
  return roll === "nextWorking" ? nextWorkingDate(calendar) : calendar;
}

export function effectiveDueDay(item, month) {
  const date = effectiveDueDate(item, month);
  if (!date) return 0;
  if (date.slice(0, 7) !== month) return daysInMonthKey(month) + 1;
  return Number(date.slice(8));
}

export function monthlyDueLabel(item, month) {
  const roll = normalizeDueRoll(item?.dueRoll);
  const day = ordinalDay(dueDayOf(item));
  if (roll === "nextWorking") {
    const effective = effectiveDueDate(item, month);
    const rolled = effective && effective !== calendarDueDate(month, dueDayOf(item));
    if (rolled && effective.slice(0, 7) === month) {
      return `${day} · next working day ${ordinalDay(Number(effective.slice(8)))}`;
    }
    if (rolled) return `${day} · next working day (after this month)`;
    return `${day} · next working day if weekend`;
  }
  return day ? `Due ${day}` : "Due";
}

export function monthlyIsAllowed(item, month, dayOfMonth) {
  const due = effectiveDueDay(item, month);
  return due > 0 && due <= dayOfMonth;
}

export function weeklyPaidFrom(item) {
  return item?.paidFrom === "cash" ? "cash" : "card";
}

export function toggleWeeklySlotTick(household, slotId, month) {
  const extras = household.weeklyExtras || [];
  const extra = extras.find((item) => item.id === slotId);
  if (extra && extra.month === month) {
    extra.happened = !extra.happened;
    return household;
  }
  const split = String(slotId).indexOf(":");
  if (split < 0) return household;
  const ruleId = slotId.slice(0, split);
  const key = slotId.slice(split + 1);
  const rule = (household.weeklyRules || weeklyRulesOf(household)).find((item) => item.id === ruleId);
  if (!rule) return household;
  if (!household.weeklyRules?.length && household.envelopes) {
    const envelope = household.envelopes.find((item) => item.id === ruleId);
    if (envelope && DATE.test(key)) {
      const dates = new Set(envelope.happenedDates || []);
      if (dates.has(key)) dates.delete(key);
      else dates.add(key);
      envelope.happenedDates = [...dates].sort();
      return household;
    }
  }
  const stamp = `${month}:${key}`;
  const ticks = new Set(rule.tickedKeys || []);
  if (ticks.has(stamp)) ticks.delete(stamp);
  else ticks.add(stamp);
  rule.tickedKeys = [...ticks].sort();
  return household;
}

export function giftAidGrossPence(amountPence, giftAid) {
  if (!Number.isInteger(amountPence) || amountPence < 0) return 0;
  if (!giftAid) return amountPence;
  return Math.round((amountPence * 5) / 4);
}

/** Basic-rate gross-up: a contribution paid from net pay is worth 100/80. */
export function basicRateGrossUpPence(amountPence) {
  if (!Number.isInteger(amountPence) || amountPence <= 0) return 0;
  return Math.round((amountPence * 5) / 4);
}

export function donationGrossPence(donation) {
  return giftAidGrossPence(donation.amountPence, donation.giftAid);
}

export function sumPence(items, read) {
  return (items || []).reduce((total, item) => total + (read ? read(item) : item), 0);
}

export function annualReservePence(annualBills, months = 12) {
  const divisor = Number(months) > 0 ? Number(months) : 12;
  return Math.round(sumPence(annualBills, (item) => item.amountPence) / divisor);
}

export function envelopeMonthlyPence(weeklyPence, month) {
  const days = daysInMonthKey(month);
  if (!days || !Number.isInteger(weeklyPence)) return 0;
  return Math.round((weeklyPence * days) / 7);
}

export function perDiemTotalPence(household) {
  const amount = household?.perDiem?.amountPence;
  return Number.isInteger(amount) && amount > 0 ? amount : 0;
}

/** The whole-month figure spread over the month: a per diem's daily rate. */
export function perDiemDailyPence(household, month) {
  const days = daysInMonthKey(month);
  const total = perDiemTotalPence(household);
  return days > 0 ? Math.round(total / days) : 0;
}

/**
 * What the per diem allows by today: the days gone by, times the whole month's
 * figure over the days in the month. In a 30-day month on the 10th, a £1,000
 * per diem allows £333.33 — ten days of it.
 */
export function perDiemSoFarPence(household, month, today = new Date()) {
  const days = daysInMonthKey(month);
  if (days <= 0) return 0;
  return Math.round((perDiemTotalPence(household) * proRateDay(month, today)) / days);
}

/**
 * The per diem used to be one line among several "cash in reserve" rows, and a
 * name was all that said which side it was spent on. It is its own figure now,
 * so the only thing this decides is which of those old rows becomes the per
 * diem when a stored household is read: the daily envelope did ride on a card,
 * and a cleaner or a set of nails never did.
 */
export function looksLikeDailyEnvelope(name) {
  return /\ba day\b|daily|thousand|envelope|float/i.test(String(name || ""));
}

export function paidInMonth(item, month) {
  return Array.isArray(item?.paidMonths) && item.paidMonths.includes(month);
}

export function happenedInMonth(envelope, month) {
  return (envelope?.happenedDates || []).filter((date) => String(date).startsWith(`${month}-`));
}

export function cardSubIsAllowed(sub, month, dayOfMonth) {
  return Number(sub.dueDay) > 0 && Number(sub.dueDay) <= dayOfMonth;
}

export function proRateDay(viewMonth, today = new Date()) {
  const current = monthKey(today);
  if (viewMonth < current) return daysInMonthKey(viewMonth);
  if (viewMonth > current) return 0;
  return today.getDate();
}

/**
 * Allowed Expenses in the sheet: what the card is allowed to carry by today.
 * In and Out stay the month plan. Cash monthlies never enter this total.
 *
 * Cash in reserve is the month's spending money — "roughly £30 a day" — so it
 * is allowed a day at a time, not all at once. It pro-rates by day-of-month,
 * as the sheet's column L does: a third of the way through the month, a third
 * of the reserve is allowed.
 */
export function exceptionMonthKey(item) {
  return coerceMonthKey(item?.month);
}

export function exceptionsForMonth(household, month) {
  return (household?.exceptions || []).filter((item) => exceptionMonthKey(item) === month);
}

export function exceptionsOutsideMonth(household, month) {
  return (household?.exceptions || []).filter((item) => exceptionMonthKey(item) !== month);
}

export function exceptionsTotalPence(household, month) {
  return sumPence(exceptionsForMonth(household, month), (item) => item.amountPence);
}

/**
 * Money drawn in from savings to cover the month. Every exception is already
 * money that came out of another pot, so the exceptions are carried here
 * automatically and anything typed on top is an extra transfer in.
 *
 * This is what makes the statement add up. An exception used to be a positive
 * number that the savings total stepped over — an asterisk on the one row that
 * broke the rule. As an ordinary expense funded by an ordinary transfer in, the
 * two cancel exactly and the column simply totals.
 */
export function fromSavingsForMonth(household, month) {
  return (household?.fromSavings || []).filter((item) => coerceMonthKey(item?.month) === month);
}

export function fromSavingsOutsideMonth(household, month) {
  return (household?.fromSavings || []).filter((item) => coerceMonthKey(item?.month) !== month);
}

/** What was typed, on top of the exceptions the month already draws in. */
export function extraFromSavingsPence(household, month) {
  return sumPence(fromSavingsForMonth(household, month), (item) => item.amountPence);
}

/**
 * Money deliberately kept off the cards this month — "don't spend this". It is
 * the mirror of an exception: an exception is paid from another pot, so the
 * cards may carry that much more without it reading as overspend; a set-aside
 * is money that is not to be spent at all, so the cards may carry that much
 * less. Neither moves the plan, and neither is spent — which is the point. Hold
 * a set-aside and the month comes in under, and the saving is that much bigger.
 */
export function setAsidesForMonth(household, month) {
  return (household?.setAsides || []).filter((item) => coerceMonthKey(item?.month) === month);
}

export function setAsidesOutsideMonth(household, month) {
  return (household?.setAsides || []).filter((item) => coerceMonthKey(item?.month) !== month);
}

export function setAsideTotalPence(household, month) {
  return sumPence(setAsidesForMonth(household, month), (item) => item.amountPence);
}

/**
 * Two different questions, asked of the same month, that were one figure until
 * now: what the cards are *allowed* to be carrying by today, and what they are
 * *actually* carrying from each category.
 *
 * Allowed is a matter of the calendar. A weekly slot dated the 20th is money
 * the cards may carry from the 20th, whether or not the shop happened; a card
 * monthly counts from its due date; the per diem counts a day at a time. Spent
 * is a matter of what was recorded: the weeklies ticked, the planned bought.
 *
 * Splitting them is what makes the check mean anything. While allowed followed
 * the ticks, ticking a weekly moved both sides at once and the month could
 * never read as under on it.
 */
export function spentSoFarForMonth(household, month, today = new Date()) {
  const dayOfMonth = proRateDay(month, today);
  const monthlies = monthliesOf(household);
  const cardMonthlies = monthlies.filter((item) => item.paidFrom !== "cash");
  const weeklySlots = weeklySlotsForMonth(household, month);
  const oneOffs = oneOffsForMonth(household, month);
  const dueWeeklyPence = sumPence(
    weeklySlots.filter((slot) => weeklySlotIsDue(slot, dayOfMonth)),
    (item) => item.amountPence,
  );
  const tickedWeeklyPence = sumPence(
    weeklySlots.filter((slot) => slot.ticked),
    (item) => item.amountPence,
  );
  const dueCardMonthlies = cardMonthlies.filter((item) => monthlyIsAllowed(item, month, dayOfMonth));
  const dueCardMonthliesPence = sumPence(dueCardMonthlies, (item) => item.amountPence);
  // A planned one-off is planned for the month rather than for a day of it, so
  // the whole month is when it may be bought — there is no date to wait for.
  const plannedAllowedPence = dayOfMonth > 0 ? sumPence(oneOffs, (item) => item.estimatePence) : 0;
  const purchasedOneOffsPence = sumPence(
    oneOffs.filter((item) => item.purchased),
    (item) => item.estimatePence,
  );
  const days = daysInMonthKey(month);
  const reserveTotalPence = perDiemTotalPence(household);
  const reserveSpentPence = days > 0 ? Math.round((reserveTotalPence * dayOfMonth) / days) : 0;
  return {
    dayOfMonth,
    reserveTotalPence,
    dueWeeklyPence,
    tickedWeeklyPence,
    dueCardMonthlies,
    dueCardMonthliesPence,
    plannedAllowedPence,
    purchasedOneOffsPence,
    reserveSpentPence,
    // What the calendar allows on the cards by today, and what the cards are
    // actually carrying from these categories. Exceptions join both later.
    allowedSoFarPence: dueWeeklyPence + dueCardMonthliesPence + plannedAllowedPence + reserveSpentPence,
    spentSoFarPence: tickedWeeklyPence + dueCardMonthliesPence + purchasedOneOffsPence + reserveSpentPence,
  };
}

/**
 * Every line behind Out, named and totalled, so the statement can be walked
 * rather than trusted. Grouped the way the money leaves: what goes out of the
 * bank, then what lands on the cards. Weekly rules collapse to one row each
 * ("Food shop · 4 × £400.00") because four identical slots is noise, not detail.
 */
/**
 * The month as the source spreadsheet's Main Table lays it out: one row per
 * category, with the three columns it uses — what the category does to In and
 * Out, what it lets the cards carry by today, and what is really on the cards.
 *
 * This is the shape the household is actually read in, so Home shows it rather
 * than a rearrangement of it. Every figure here already existed on the flow;
 * nothing is recomputed, so the rows and the totals cannot drift apart.
 */
export function monthStatementRows(household, month, today = new Date()) {
  const flow = cashflowForMonth(household, month, today);
  const rows = [
    { id: "income", label: "Income", flowPence: flow.incomePence },
    // Every exception came out of another pot, so the month draws that much in
    // from savings whether or not anything else is typed. The two cancel, which
    // is why the column below adds up without an exception to the rule.
    ...(flow.fromSavingsPence
      ? [{
        id: "fromsavings",
        label: "From savings",
        flowPence: flow.fromSavingsPence,
        // Short enough not to clip the name column.
        note: flow.exceptionsPence
          ? (flow.extraFromSavingsPence ? "plus exceptions" : "the exceptions")
          : "drawn in",
      }]
      : []),
    // The annual saving is a standing cash line on the sheet, not its own row.
    { id: "cash", label: "Cash out", flowPence: -(flow.billsPence + flow.annualReservePence) },
    // Allowed is what the calendar permits by today; on cards is what has
    // actually been recorded. For the per diem and card monthlies those are the
    // same fact — there is nothing to tick — so both columns carry it.
    { id: "perdiem", label: "Per diem", flowPence: -flow.cardReservePence, allowedPence: flow.reserveSpentPence, cardPence: flow.reserveSpentPence },
    { id: "cardout", label: "Credit card out", flowPence: -flow.cardOutPence, allowedPence: flow.dueCardMonthliesPence, cardPence: flow.dueCardMonthliesPence },
    // These two are where the columns come apart, and where the month is won or
    // lost: allowed once the slot's date arrives, on the cards once it is ticked.
    { id: "weekly", label: "Weekly expenses", flowPence: -flow.envelopesMonthlyPence, allowedPence: flow.dueWeeklyPence, cardPence: flow.tickedWeeklyPence },
    { id: "planned", label: "Monthly expenses", flowPence: -flow.oneOffsPence, allowedPence: flow.plannedAllowedPence, cardPence: flow.purchasedOneOffsPence },
    // An ordinary expense now, funded by the transfer in above.
    { id: "exceptions", label: "Exceptions", flowPence: -flow.exceptionsPence, allowedPence: flow.exceptionsPence, cardPence: flow.exceptionsPence },
    // The only row that takes the allowance down: money decided against rather
    // than money spent, so it never reaches the month column.
    ...(flow.setAsidePence
      ? [{ id: "setaside", label: "Set aside", allowedPence: -flow.setAsidePence, note: "don't spend this", aside: true }]
      : []),
  ];
  // What the cards actually say, which is a different kind of fact from the
  // rows above: those are the plan read against the calendar, these are typed
  // off a statement. Keeping them apart is what lets the column foot.
  const actualRows = [
    { id: "pending", label: "Pending", cardPence: flow.pendingPence },
    { id: "cards", label: "Credit cards", cardPence: flow.cardBalancesPence },
  ];
  return {
    rows,
    actualRows,
    savingsPence: flow.savingsPence,
    allowedPence: flow.allowanceSoFarPence,
    // The rows above foot to this: it is their sum, not the card statement.
    onCardsPence: flow.onCardsSoFarPence,
    actualOnCardsPence: flow.actualOnCardsPence,
    overUnderPence: flow.overUnderPence,
    cardCheckKnown: flow.cardCheckKnown,
    totalSavingsPence: flow.totalSavingsPence,
    dayOfMonth: flow.dayOfMonth,
    daysInMonth: flow.daysInMonth,
    monthPhase: flow.monthPhase,
  };
}

export function outBreakdownForMonth(household, month, today = new Date()) {
  const flow = cashflowForMonth(household, month, today);
  const weeklyByRule = new Map();
  for (const slot of flow.weeklySlots) {
    const key = slot.ruleId || slot.id;
    const seen = weeklyByRule.get(key) || { name: slot.name, count: 0, amountPence: 0, eachPence: slot.amountPence };
    seen.count += 1;
    seen.amountPence += slot.amountPence;
    weeklyByRule.set(key, seen);
  }
  const cash = [
    ...flow.cashMonthlies.map((item) => ({ name: item.name, amountPence: item.amountPence, detail: monthlyDueLabel(item, month) })),
    ...(flow.annualReservePence ? [{ name: "Annual bills, saved monthly", amountPence: flow.annualReservePence, detail: "Annual total ÷ 12" }] : []),
  ];
  const card = [
    ...flow.cardMonthlies.map((item) => ({ name: item.name, amountPence: item.amountPence, detail: monthlyDueLabel(item, month) })),
    // count and eachPence rather than a formatted string: money is formatted in
    // one place, and that place is the view.
    ...[...weeklyByRule.values()].map((rule) => ({
      name: rule.name,
      amountPence: rule.amountPence,
      count: rule.count,
      eachPence: rule.eachPence,
    })),
    ...flow.oneOffs.map((item) => ({ name: item.name, amountPence: item.estimatePence, detail: "Planned" })),
    // dailyPence rather than a formatted string: money is formatted in one
    // place, and that place is the view.
    ...(perDiemTotalPence(household)
      ? [{ name: "Per diem", amountPence: perDiemTotalPence(household), dailyPence: perDiemDailyPence(household, month) }]
      : []),
    // Spending like any other, so it is in Out and it is in this breakdown —
    // what pays for it is the transfer in on the statement, not an exemption.
    ...flow.exceptions.map((item) => ({ name: item.name, amountPence: item.amountPence, detail: "From savings" })),
  ];
  return {
    cash,
    card,
    cashTotalPence: sumPence(cash, (item) => item.amountPence),
    cardTotalPence: sumPence(card, (item) => item.amountPence),
  };
}

export function cashflowForMonth(household, month, today = new Date()) {
  const people = household?.people || [];
  const incomeLines = incomeLinesFromPayslips(household, month);
  const monthlies = monthliesOf(household);
  const cashMonthlies = monthlies.filter((item) => item.paidFrom === "cash");
  const cardMonthlies = monthlies.filter((item) => item.paidFrom !== "cash");
  const weeklySlots = weeklySlotsForMonth(household, month);
  const cards = cardsForMonth(household, month, today);
  const oneOffs = oneOffsForMonth(household, month);
  const annualBills = household?.annualBills || [];
  const days = daysInMonthKey(month);
  const live = spentSoFarForMonth(household, month, today);
  const dayOfMonth = live.dayOfMonth;

  const incomePence = incomeFromPayslipsPence(household, month);
  const billsPence = sumPence(cashMonthlies, (item) => item.amountPence);
  const cardOutPence = sumPence(cardMonthlies, (item) => item.amountPence);
  // The per diem is the month's spending money, and it is spent on the cards.
  const cardReservePence = perDiemTotalPence(household);
  const reservePence = cardReservePence;
  const annualReserve = annualReservePence(annualBills);
  const oneOffsPence = sumPence(oneOffs, (item) => item.estimatePence);
  const envelopesMonthlyPence = sumPence(weeklySlots, (item) => item.amountPence);
  // Out splits the way the money actually leaves. Cash is what leaves the bank:
  // standing cash monthlies and the annual saving. The per diem is spent on the
  // cards, so it sits on the card side — counting it as bank money in the plan
  // and card money in the check would be the same £1,000 counted twice.
  const cashOutPence = billsPence + annualReserve;
  // Card commitments are the ones that are going to be paid: card monthlies,
  // this month's planned, and every weekly slot. The per diem rides on top and
  // is the part that is chosen day by day, so it is tracked apart from them.
  const cardCommitmentsPence = cardOutPence + oneOffsPence + envelopesMonthlyPence;
  const cardPlanPence = cardCommitmentsPence + cardReservePence;
  // An exception is money spent, so it is in Out like any other spending. It
  // used to be a positive row the savings total stepped over — an asterisk on
  // the one line that broke the rule. What funds it is the transfer in below,
  // and the two cancel, so the statement's column simply totals.
  const exceptions = exceptionsForMonth(household, month);
  const exceptionsPence = sumPence(exceptions, (item) => item.amountPence);
  const outPence = cashOutPence + cardPlanPence + exceptionsPence;
  // In is the month's pay plus whatever is drawn in from savings: the
  // exceptions, which came from another pot by definition, and anything typed
  // on top to cover a month that does not otherwise reach.
  const fromSavings = fromSavingsForMonth(household, month);
  const extraFromSavingsPence = sumPence(fromSavings, (item) => item.amountPence);
  const fromSavingsPence = exceptionsPence + extraFromSavingsPence;
  const inPence = incomePence + fromSavingsPence;
  const leftPence = inPence - outPence;
  const cardBalancesPence = sumPence(cards, (item) => item.balancePence);
  const pendingRows = pendingsForMonth(household, month, today);
  const cardPendingPence = sumPence(cards, (item) => item.pendingPence || 0);
  const pendingTablePence = pendingListTotalPence(pendingRows);
  const pendingPence = cardPendingPence + pendingTablePence;
  const cardSidePence = cardBalancesPence + pendingPence;
  // A card with no balance recorded for this month reads as £0, which would
  // report the whole allowance as underspend. The check is unknown instead.
  const cardsMissingSnapshot = cards.filter((item) => item.missingSnapshot);
  const cardCheckKnown = cardsMissingSnapshot.length === 0;
  const dueWeeklyPence = live.dueWeeklyPence;
  const tickedWeeklyPence = live.tickedWeeklyPence;
  const plannedAllowedPence = live.plannedAllowedPence;
  const purchasedOneOffsPence = live.purchasedOneOffsPence;
  const dueCardMonthliesPence = live.dueCardMonthliesPence;
  const reserveSpentPence = live.reserveSpentPence;
  const actualOnCardsPence = cardSidePence;
  // A set-aside is the mirror: money that is not to be spent, so the cards are
  // allowed to carry that much less. It never moves the plan or the saving —
  // holding it is what turns it into a saving, through the underspend.
  const setAsides = setAsidesForMonth(household, month);
  const setAsidePence = sumPence(setAsides, (item) => item.amountPence);
  // What the cards may be carrying by today, and what they are carrying from
  // each category. The five that make up a card: the per diem, card monthlies,
  // weeklies, this month's planned, and exceptions.
  const allowanceSoFarPence = live.allowedSoFarPence + exceptionsPence - setAsidePence;
  const onCardsSoFarPence = live.spentSoFarPence + exceptionsPence;
  // Sheet footer: Savings is In minus Out; the card check is the over/underspend
  // against the allowance; Total Savings adds the two.
  const savingsPence = leftPence;
  const cardCheckPence = allowanceSoFarPence - actualOnCardsPence;
  const overUnderPence = cardCheckKnown ? cardCheckPence : 0;
  const totalSavingsPence = savingsPence + overUnderPence;
  const overspendPence = overUnderPence < 0 ? -overUnderPence : 0;
  const underspendPence = overUnderPence > 0 ? overUnderPence : 0;
  // The end-of-month view. allowanceSoFar is the card-side plan pro-rated to
  // today; the same total on the last day is the whole card plan plus the whole
  // reserve plus exceptions. The gap between them is what the month still has
  // left to spend, which is the number that answers "can we still pull it back".
  const phase = monthPhase(month, today);
  const daysLeft = Math.max(0, days - dayOfMonth);
  const fullMonthAllowancePence = cardPlanPence + exceptionsPence - setAsidePence;
  const remainingPlanPence = fullMonthAllowancePence - allowanceSoFarPence;
  // What is still to come splits in two, and the halves are not the same kind
  // of money. Weeklies, card monthlies and planned one-offs are expected to be
  // paid — they are not a lever, and treating them as spending money left says
  // there is more room in the month than there is. They stop being "still to
  // come" once the calendar reaches them, spent or not. The per diem is the
  // part that is genuinely chosen day to day, so it is the only half worth a
  // per-day figure. The two add back to the whole remaining plan.
  const committedToComePence = cardCommitmentsPence - (dueWeeklyPence + dueCardMonthliesPence + plannedAllowedPence);
  const reserveLeftPence = cardReservePence - reserveSpentPence;
  const perDayReserveLeftPence = daysLeft > 0 && reserveLeftPence > 0 ? Math.round(reserveLeftPence / daysLeft) : 0;
  // Where the month lands: the plan's saving carried forward with however far
  // ahead or behind today already is. Same number as Total savings — named for
  // the question it answers rather than for the sheet row it came from.
  const forecastSavingPence = totalSavingsPence;
  // Spend the rest of the plan exactly and the cards finish here.
  const forecastCardsPence = actualOnCardsPence + remainingPlanPence;

  return {
    month,
    monthPhase: phase,
    daysLeft,
    fullMonthAllowancePence,
    remainingPlanPence,
    committedToComePence,
    reserveLeftPence,
    perDayReserveLeftPence,
    forecastSavingPence,
    forecastCardsPence,
    daysInMonth: days,
    dayOfMonth,
    people,
    incomeLines,
    incomePence,
    inPence,
    fromSavings,
    extraFromSavingsPence,
    fromSavingsPence,
    billsPence,
    cardOutPence,
    cashOutPence,
    cardCommitmentsPence,
    cardPlanPence,
    reservePence,
    cardReservePence,
    perDiemDailyPence: perDiemDailyPence(household, month),
    reserveTotalPence: live.reserveTotalPence,
    monthlies,
    cashMonthlies,
    cardMonthlies,
    weeklySlots,
    annualReservePence: annualReserve,
    oneOffsPence,
    oneOffs,
    envelopesMonthlyPence,
    outPence,
    leftPence,
    cardBalancesPence,
    cardsMissingSnapshot,
    cardCheckKnown,
    pendingRows,
    pendingPence,
    cardPendingPence,
    pendingTablePence,
    cardSidePence,
    overUnderPence,
    dueWeeklyPence,
    tickedWeeklyPence,
    plannedAllowedPence,
    dueCardMonthliesPence,
    purchasedOneOffsPence,
    reserveSpentPence,
    spentSoFarPence: live.spentSoFarPence,
    onCardsSoFarPence,
    actualOnCardsPence,
    exceptions,
    exceptionsPence,
    setAsides,
    setAsidePence,
    allowanceSoFarPence,
    savingsPence,
    cardCheckPence,
    overspendPence,
    underspendPence,
    totalSavingsPence,
  };
}

export function spendVerdict() {
  return "";
}

export function savingLine(flow, today = new Date()) {
  const left = flow?.leftPence || 0;
  const when = isCurrentMonth(flow.month, today) ? "This month" : monthLabel(flow.month);
  if (left < 0) return `${when} does not balance yet.`;
  return `${when} can save.`;
}

export function upsertMonthSnapshot(list, snapshot) {
  const month = String(snapshot?.month || "");
  if (!MONTH.test(month)) return [...(list || [])];
  const next = (list || []).filter((item) => item.month !== month);
  next.push({
    month,
    amountPence: Number.isInteger(snapshot.amountPence) ? snapshot.amountPence : 0,
    ...(Number.isInteger(snapshot.pendingPence) ? { pendingPence: snapshot.pendingPence } : {}),
    ...(snapshot.updatedOn ? { updatedOn: snapshot.updatedOn } : {}),
  });
  return next.sort((a, b) => a.month.localeCompare(b.month));
}

export function snapshotForMonth(list, month) {
  return (list || []).find((item) => item.month === month) || null;
}

export function seedSnapshotsFromUpdatedOn(item, { includePending = false } = {}) {
  if (Array.isArray(item?.snapshots) && item.snapshots.length) return item.snapshots;
  const month = String(item?.updatedOn || "").slice(0, 7);
  if (!MONTH.test(month)) return [];
  const amountPence = Number.isInteger(item.amountPence)
    ? item.amountPence
    : (Number.isInteger(item.balancePence) ? item.balancePence : 0);
  return upsertMonthSnapshot([], {
    month,
    amountPence,
    ...(includePending ? { pendingPence: item.pendingPence || 0 } : {}),
    updatedOn: item.updatedOn,
  });
}

export function cardsForMonth(household, month, today = new Date()) {
  const live = isCurrentMonth(month, today);
  return (household?.cards || []).map((card) => {
    const snapshots = seedSnapshotsFromUpdatedOn(card, { includePending: true });
    const snap = snapshotForMonth(snapshots, month);
    if (snap) {
      return {
        ...card,
        snapshots,
        balancePence: snap.amountPence,
        pendingPence: snap.pendingPence || 0,
        missingSnapshot: false,
      };
    }
    // The live month falls back to the card's own running balance. A card
    // carrying neither would total to NaN and print "£NaN" on the statement,
    // so an absent figure reads as nothing on the card, as a past month does.
    if (live) {
      return {
        ...card,
        snapshots,
        balancePence: Number.isInteger(card.balancePence) ? card.balancePence : 0,
        pendingPence: Number.isInteger(card.pendingPence) ? card.pendingPence : 0,
        missingSnapshot: false,
      };
    }
    return { ...card, snapshots, balancePence: 0, pendingPence: 0, missingSnapshot: true };
  });
}

export function potSnapshotsOf(pot) {
  return seedSnapshotsFromUpdatedOn(pot);
}

export function potHasSnapshotForMonth(pot, month) {
  return Boolean(snapshotForMonth(potSnapshotsOf(pot), month));
}

export function potsNeedCurrentMonthLog(pots, today = new Date()) {
  const month = monthKey(today);
  if (!pots?.length) return false;
  return pots.some((pot) => !potHasSnapshotForMonth(pot, month));
}

export function potHistoryMonths(pots) {
  const months = new Set();
  for (const pot of pots || []) {
    for (const snap of potSnapshotsOf(pot)) months.add(snap.month);
  }
  return [...months].sort();
}

export function potHistorySeries(pots) {
  const months = potHistoryMonths(pots);
  return (pots || []).map((pot) => {
    const snaps = potSnapshotsOf(pot);
    let last = null;
    const points = months.map((month) => {
      const snap = snapshotForMonth(snaps, month);
      if (snap) last = snap.amountPence;
      return { month, amountPence: last, recorded: Boolean(snap) };
    });
    return { id: pot.id, name: pot.name, points };
  });
}

/**
 * The rows a payslip form may show: real categories, each at most once. A form
 * that listed the same category twice would take two amounts for one figure and
 * keep whichever it read last, so the list is deduplicated here rather than at
 * each of the places that build one.
 */
export function keepPayslipFormRows(rows) {
  const seen = new Set();
  return (rows || []).filter((item) => {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function builtinPayslipCategory(kind) {
  return BUILTIN_PAYSLIP_CATEGORIES.find((category) => category.kind === kind);
}

export function payslipCategoriesOf(household) {
  const seen = new Map();
  const remember = (category) => {
    const kind = PAYSLIP_CATEGORY_KINDS.includes(category?.kind) ? category.kind : "deduction";
    const label = String(category?.label || "").trim();
    if (!label) return;
    const id = String(category?.id || "").trim()
      || (kind === "deduction" || kind === "extra" || kind === "parental" ? `${kind}-${label.toLowerCase()}` : kind);
    const key = kind === "deduction" || kind === "extra" || kind === "parental" ? `${kind}:${label.toLowerCase()}` : kind;
    if (seen.has(key)) return;
    seen.set(key, { id, label, kind });
  };
  for (const item of household?.payslipCategories || []) remember(item);
  for (const slip of household?.payslips || []) {
    // By kind, never by position: these were index lookups, and adding a
    // category in the middle silently shifted every one after it, so a salary
    // sacrifice registered as the new category, tax as the pension, and so on.
    if (slip.bonusPence) remember(builtinPayslipCategory("bonus"));
    if (slip.benefitsPence) remember(builtinPayslipCategory("benefits"));
    if (slip.salarySacrificePensionPence) remember(builtinPayslipCategory("sacrifice"));
    if (slip.reliefAtSourcePensionPence) remember(builtinPayslipCategory("pension"));
    if (slip.taxPence) remember(builtinPayslipCategory("tax"));
    if (slip.niPence) remember(builtinPayslipCategory("ni"));
    for (const row of slip.otherDeductions || []) {
      if (row.label) remember({
        id: row.id,
        label: row.label,
        kind: row.extra ? "extra" : (payslipAmountOutsideNet(row) ? "parental" : "deduction"),
      });
    }
  }
  return [...seen.values()];
}

export function masterPayslipCategories(household) {
  return payslipCategoriesOf({
    payslipCategories: [
      ...DEFAULT_PAYSLIP_CATEGORIES,
      ...(household?.payslipCategories || []),
    ],
    payslips: household?.payslips || [],
  });
}

export function rememberPayslipCategories(household, extras = []) {
  const next = payslipCategoriesOf({
    payslipCategories: [
      ...DEFAULT_PAYSLIP_CATEGORIES,
      ...(household.payslipCategories || []),
      ...extras,
    ],
    payslips: household.payslips || [],
  });
  household.payslipCategories = next;
  return household;
}

export function unusedBuiltinPayslipCategories(categories) {
  const used = new Set((categories || []).map((item) => item.kind));
  return BUILTIN_PAYSLIP_CATEGORIES.filter((item) => !used.has(item.kind));
}

export function unusedMasterPayslipCategories(onSlip, master) {
  const usedIds = new Set((onSlip || []).map((item) => item.id));
  const usedKeys = new Set((onSlip || []).map((item) => `${item.kind}:${String(item.label || "").trim().toLowerCase()}`));
  return (master || []).filter((item) => {
    const key = `${item.kind}:${String(item.label || "").trim().toLowerCase()}`;
    return !usedIds.has(item.id) && !usedKeys.has(key);
  });
}

export function payslipAmountForCategory(slip, category) {
  if (!slip || !category) return 0;
  if (category.kind === "bonus") return slip.bonusPence || 0;
  if (category.kind === "benefits") return slip.benefitsPence || 0;
  if (category.kind === "sacrifice") return slip.salarySacrificePensionPence || 0;
  if (category.kind === "pension") return slip.reliefAtSourcePensionPence || 0;
  if (category.kind === "tax") return slip.taxPence || 0;
  if (category.kind === "ni") return slip.niPence || 0;
  const label = String(category.label || "").trim().toLowerCase();
  const row = (slip.otherDeductions || []).find((item) => String(item.label || "").trim().toLowerCase() === label);
  return row?.amountPence || 0;
}

/** The inverse of payslipAmountForCategory: one category's amount, written in. */
export function withPayslipCategoryAmount(slip, category, amountPence) {
  const next = { ...(slip || {}) };
  if (!category) return next;
  if (category.kind === "bonus") next.bonusPence = amountPence;
  else if (category.kind === "benefits") next.benefitsPence = amountPence;
  else if (category.kind === "sacrifice") next.salarySacrificePensionPence = amountPence;
  else if (category.kind === "pension") next.reliefAtSourcePensionPence = amountPence;
  else if (category.kind === "tax") next.taxPence = amountPence;
  else if (category.kind === "ni") next.niPence = amountPence;
  else {
    const label = String(category.label || "").trim().toLowerCase();
    const rows = [...(next.otherDeductions || [])];
    const at = rows.findIndex((item) => String(item.label || "").trim().toLowerCase() === label);
    const row = {
      id: category.id,
      label: category.label,
      amountPence,
      ...(category.kind === "extra" ? { extra: true } : {}),
      ...(category.kind === "parental" ? { inNet: false } : {}),
    };
    if (at >= 0) rows[at] = { ...rows[at], ...row };
    else rows.push(row);
    next.otherDeductions = rows;
  }
  return next;
}

/**
 * Last month's figures, offered only where this month's are still blank.
 *
 * Most of a payslip repeats: the tax code, the sacrifice, the gym flex. Filling
 * them in silently would be worse than leaving them empty — a figure you did
 * not type looks exactly like one you did, so you would have to check every
 * field to find out which the app had decided for you. So this fills nothing on
 * its own: it is what one deliberate tap borrows, and it never touches a field
 * that already has something in it. Type this month's net afterwards and the
 * check that already exists says whether the borrowed figures still add up.
 */
export function payslipFillFromPrevious(current, previous, categories) {
  const fills = [];
  if (!previous) return { fills };
  for (const field of ["salaryPence", "grossPence"]) {
    if ((current?.[field] || 0) > 0) continue;
    const amountPence = previous[field] || 0;
    if (amountPence > 0) fills.push({ field, amountPence });
  }
  for (const category of categories || []) {
    if (payslipAmountForCategory(current, category) > 0) continue;
    const amountPence = payslipAmountForCategory(previous, category);
    if (amountPence > 0) fills.push({ category, amountPence });
  }
  // The tax code is the field that changes least of all, and it is not money.
  if (!String(current?.taxCode || "").trim() && String(previous.taxCode || "").trim()) {
    fills.push({ field: "taxCode", text: String(previous.taxCode).trim() });
  }
  return { fills };
}

/** The fills applied, so the form can be re-rendered from one slip. */
export function payslipWithFills(slip, fills) {
  let next = { ...(slip || {}) };
  for (const fill of fills || []) {
    if (fill.field) next[fill.field] = fill.text == null ? fill.amountPence : fill.text;
    else next = withPayslipCategoryAmount(next, fill.category, fill.amountPence);
  }
  return next;
}

export function payslipCategoryIsExtra(category) {
  return category?.kind === "bonus" || category?.kind === "benefits" || category?.kind === "extra";
}

export function isParentalPayLabel(label) {
  const value = String(label || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!value) return false;
  return /\b(smp|ospp|shpp|sap|maternity|paternity|parental)\b/.test(value);
}

export function payslipAmountOutsideNet(row) {
  if (!row) return false;
  if (row.inNet === false) return true;
  if (row.kind === "parental" || row.parental) return true;
  return isParentalPayLabel(row.label);
}

/**
 * Gross actually paid. `grossPence` is the payslip's Payments total, so it
 * already carries basic salary, bonus, and any statutory or enhanced parental
 * pay — that is why those are not added again anywhere below.
 *
 * Salary sacrifice is not an employee deduction: the employee gives up
 * contractual pay and the employer pays the pension, so the Payments total is
 * already reduced by it. A slip that instead shows gross before the sacrifice
 * sets grossBeforeSacrifice, and only then does the sacrifice come off.
 */
export function payslipGrossPaidPence(slip) {
  let gross = slip?.grossPence || 0;
  // Some slips (and the sheet's "Gross Per Month") show basic pay with the
  // bonus as its own column rather than inside the Payments total.
  if (slip?.grossExcludesBonus) gross += slip.bonusPence || 0;
  if (slip?.grossBeforeSacrifice) gross -= slip.salarySacrificePensionPence || 0;
  return gross;
}

/**
 * Every net these figures could mean, one per way of reading Gross. Which one
 * a slip uses is a fact about the payslip, not about the person filling this
 * in — so rather than ask, show each reading with its number and let the one
 * that matches the payslip be picked by eye.
 */
export function payslipNetReadings(slip) {
  const sacrifice = slip?.salarySacrificePensionPence || 0;
  const bonus = slip?.bonusPence || 0;
  const benefits = slip?.benefitsPence || 0;
  const sacrificeWays = sacrifice > 0 ? [false, true] : [false];
  const bonusWays = bonus > 0 ? [false, true] : [false];
  // Whether a benefit is money is the same kind of question as how gross is
  // written, so it is read off the payslip's net the same way rather than asked.
  const benefitWays = benefits > 0 ? [false, true] : [false];
  const readings = [];
  for (const grossBeforeSacrifice of sacrificeWays) {
    for (const grossExcludesBonus of bonusWays) {
      for (const benefitsPaid of benefitWays) {
        const shape = { ...slip, grossBeforeSacrifice, grossExcludesBonus, benefitsPaid };
        readings.push({
          // The benefit half of the id only appears when there is a benefit,
          // so a slip without one keeps the id it always had.
          id: `${grossBeforeSacrifice ? "pre" : "post"}-sacrifice-${grossExcludesBonus ? "without" : "with"}-bonus${benefits > 0 ? `-${benefitsPaid ? "paid" : "notional"}-benefit` : ""}`,
          grossBeforeSacrifice,
          grossExcludesBonus,
          benefitsPaid,
          hasBenefits: benefits > 0,
          label: payslipReadingLabel(grossBeforeSacrifice, grossExcludesBonus, benefitsPaid, benefits > 0),
          grossPaidPence: payslipGrossPaidPence(shape),
          netPence: payslipNetPence(shape),
          current: Boolean(slip?.grossBeforeSacrifice) === grossBeforeSacrifice
            && Boolean(slip?.grossExcludesBonus) === grossExcludesBonus
            // With no benefit on the slip there is no question to be current
            // about, so a benefit-free slip must not fail to mark its reading.
            && (benefits <= 0 || benefitsArePaid(slip) === benefitsPaid),
        });
      }
    }
  }
  const stated = slip?.statedNetPence;
  if (Number.isInteger(stated) && stated > 0) {
    for (const reading of readings) reading.matchesStated = reading.netPence === stated;
  }
  return readings;
}

/**
 * The one reading that lands on the net the payslip prints. A payslip always
 * prints its net, so typing that single figure settles every ambiguity at once
 * — how gross is written, whether a bonus sits inside it, whether a benefit is
 * money — with nobody having to know the words for any of them.
 */
export function resolvedPayslipReading(slip) {
  const stated = slip?.statedNetPence;
  if (!Number.isInteger(stated) || stated <= 0) return null;
  const matching = payslipNetReadings(slip).filter((reading) => reading.netPence === stated);
  return matching.length === 1 ? matching[0] : null;
}

/**
 * The slip as the payslip's own net says to read it. A payslip that prints its
 * net has already settled how gross is written and whether a benefit is money,
 * so a slip carrying that figure is read correctly wherever it is used — not
 * only while its form happens to be open. When nothing resolves, the slip is
 * left exactly as it was rather than guessed at.
 */
export function payslipAsRead(slip) {
  const resolved = resolvedPayslipReading(slip);
  if (resolved) {
    return {
      ...slip,
      grossBeforeSacrifice: resolved.grossBeforeSacrifice,
      grossExcludesBonus: resolved.grossExcludesBonus,
      benefitsPaid: resolved.benefitsPaid,
    };
  }
  // No net typed, but salary ÷ 12 still settles the sacrifice on its own.
  if (!slip?.grossBeforeSacrifice && (slip?.salarySacrificePensionPence || 0) > 0 && grossIsSalaryOverTwelve(slip)) {
    return { ...slip, grossBeforeSacrifice: true };
  }
  return slip;
}

/** Net as the payslip itself says it, when the payslip says it. */
/**
 * A slip with its net typed and nothing else on it. Entering a whole payslip is
 * a job; knowing what lands in the bank this month is not, and the second
 * should not wait on the first. Type the net, the month is right, and the
 * detail can follow whenever.
 */
export function payslipIsNetOnly(slip) {
  const stated = slip?.statedNetPence;
  if (!Number.isInteger(stated) || stated <= 0) return false;
  return (slip?.grossPence || 0) <= 0 && (slip?.salaryPence || 0) <= 0;
}

/** True when there is enough on the slip to work taxable pay out of it. */
export function payslipHasDetail(slip) {
  return (slip?.grossPence || 0) > 0 || (slip?.salaryPence || 0) > 0;
}

export function payslipNetAsReadPence(slip) {
  // Nothing to do the slip's arithmetic on, so the net it prints is the answer.
  if (payslipIsNetOnly(slip)) return slip.statedNetPence;
  return payslipNetPence(payslipAsRead(slip));
}

/** What the app worked out, in the words of the payslip rather than payroll. */
export function payslipReadingSummary(reading) {
  if (!reading) return "";
  const parts = [reading.grossBeforeSacrifice
    ? "the salary sacrifice comes off the gross you typed"
    : "the gross you typed is what the slip pays"];
  if (reading.grossExcludesBonus) parts.push("the bonus is paid on top of it");
  if (reading.hasBenefits) {
    parts.push(reading.benefitsPaid
      ? "the benefit is money you actually receive"
      : "the benefit is taxed but never paid to you");
  }
  return `${parts.join(", ")}.`;
}

function payslipReadingLabel(grossBeforeSacrifice, grossExcludesBonus, benefitsPaid, hasBenefits) {
  const gross = !grossBeforeSacrifice && !grossExcludesBonus ? "Gross is the Payments total on the slip"
    : grossBeforeSacrifice && !grossExcludesBonus ? "Gross is before the salary sacrifice"
      : !grossBeforeSacrifice && grossExcludesBonus ? "Gross is basic pay, with the bonus on top"
        : "Gross is basic pay before the sacrifice, with the bonus on top";
  if (!hasBenefits) return gross;
  return `${gross}, and the benefit ${benefitsPaid ? "is paid to you" : "is taxed but not paid"}`;
}

/**
 * Deductions the payslip takes off gross: tax, NI, a relief-at-source pension
 * (paid out of pay, unlike a sacrifice), and the deduction rows.
 */
export function payslipDeductionsPence(slip) {
  return (slip?.taxPence || 0)
    + (slip?.niPence || 0)
    + (slip?.reliefAtSourcePensionPence || 0)
    + sumPence(
      (slip?.otherDeductions || []).filter((row) => !row.extra && !payslipAmountOutsideNet(row)),
      (row) => row.amountPence,
    );
}

/** Additions paid on top of the Payments total, if a slip is built that way. */
export function payslipAdditionsPence(slip) {
  return sumPence(
    (slip?.otherDeductions || []).filter((row) => row.extra && !payslipAmountOutsideNet(row)),
    (row) => row.amountPence,
  );
}

/**
 * The payslip's own arithmetic: Net pay = Total gross pay − Total deductions.
 *
 * Taxable benefits are deliberately absent. A benefit in kind is notional — it
 * is taxed but never paid, so it cannot raise the money that lands in the bank.
 * It belongs in adjusted net income, and only there.
 */
/**
 * A benefit is taxable either way. Whether it is also money depends on the
 * slip: a car allowance is paid, private medical is not. benefitsPaid says
 * which, and the net printed on the payslip is what settles it.
 */
export function benefitsArePaid(slip) {
  return slip?.benefitsPaid !== false;
}

export function payslipBenefitsInNetPence(slip) {
  return benefitsArePaid(slip) ? (slip?.benefitsPence || 0) : 0;
}

/**
 * Gross typed as salary ÷ 12 is the contractual monthly figure, and contractual
 * pay is by definition before any salary sacrifice. That is a fact about the
 * number, not a guess about the slip, so it is applied rather than only warned
 * about — otherwise a slip with no net typed reads a whole sacrifice too high
 * every month.
 */
export function grossIsSalaryOverTwelve(slip) {
  const salary = slip?.salaryPence || 0;
  const gross = slip?.grossPence || 0;
  if (salary <= 0 || gross <= 0) return false;
  return Math.abs(gross - Math.round(salary / 12)) <= 1;
}

export function payslipNetPence(slip) {
  if (!slip) return 0;
  return payslipGrossPaidPence(slip) + payslipAdditionsPence(slip) + payslipBenefitsInNetPence(slip) - payslipDeductionsPence(slip);
}

/**
 * What the slip is worth for the £100k line: taxable pay plus taxable benefits.
 * Taxable pay is already net of any salary sacrifice, so the sacrifice is not
 * subtracted a second time here.
 */
export function payslipTaxablePayPence(slip) {
  if (!slip) return 0;
  if ((slip.grossPence || 0) > 0) return payslipGrossPaidPence(slip);
  // No gross typed. Salary is contractual, so it is a before-sacrifice figure.
  return (slip.salaryPence || 0) + (slip.bonusPence || 0) - (slip.salarySacrificePensionPence || 0);
}

/** True when more than one reading of Gross is possible for this slip. */
export function payslipHasSeveralReadings(slip) {
  return payslipNetReadings(slip).length > 1;
}

/**
 * The net the payslip itself states, against the net these figures produce.
 * A mismatch means a category is missing, misfiled, or gross was typed on the
 * wrong side of the sacrifice — better caught here than carried into Home.
 */
export function payslipNetCheck(slip) {
  const statedPence = slip?.statedNetPence;
  if (!Number.isInteger(statedPence) || statedPence <= 0) return null;
  const calculatedPence = payslipNetPence(slip);
  return {
    statedPence,
    calculatedPence,
    differencePence: calculatedPence - statedPence,
    matches: calculatedPence === statedPence,
  };
}

/**
 * Why a stated net and a calculated net disagree. The gap is usually exactly
 * one figure on the slip, and naming which one is more use than "does not
 * match" — the conventions here are the part people get wrong.
 */
/**
 * Gross typed as salary ÷ 12 is the contractual figure, which is before any
 * salary sacrifice. Left un-ticked it overstates net by the whole sacrifice
 * every month, and nothing catches it unless a net is typed — so this check
 * does not wait for one.
 */
export function payslipGrossReadingWarning(slip) {
  // A net that settles the reading has already answered this; warning anyway
  // would be telling someone to check what the app just worked out for them.
  if (resolvedPayslipReading(slip)) return "";
  const sacrifice = slip?.salarySacrificePensionPence || 0;
  const salary = slip?.salaryPence || 0;
  const gross = slip?.grossPence || 0;
  if (sacrifice <= 0 || salary <= 0 || gross <= 0 || slip?.grossBeforeSacrifice) return "";
  if (!grossIsSalaryOverTwelve(slip)) return "";
  return "Gross here is salary ÷ 12, so the salary sacrifice is being taken off it. Type the Total gross pay the payslip itself shows if that is not what this figure is.";
}

export function payslipNetHints(slip) {
  const warning = payslipGrossReadingWarning(slip);
  const check = payslipNetCheck(slip);
  if (!check || check.matches) return warning ? [warning] : [];
  const difference = check.differencePence;
  const sacrifice = slip?.salarySacrificePensionPence || 0;
  const bonus = slip?.bonusPence || 0;
  const benefits = slip?.benefitsPence || 0;
  const hints = warning ? [warning] : [];
  if (sacrifice > 0 && difference === sacrifice && !slip?.grossBeforeSacrifice) {
    hints.push("That is exactly the salary sacrifice, so the Gross typed here looks like the figure before it came off. Tick “Gross is before salary sacrifice”.");
  }
  if (sacrifice > 0 && difference === -sacrifice && slip?.grossBeforeSacrifice) {
    hints.push("That is exactly the salary sacrifice, and it is being taken off twice. Untick “Gross is before salary sacrifice”.");
  }
  if (bonus > 0 && difference === -bonus && !slip?.grossExcludesBonus) {
    hints.push("That is exactly the bonus, so the Gross typed here looks like basic pay with the bonus alongside it.");
  }
  if (bonus > 0 && difference === bonus && slip?.grossExcludesBonus) {
    hints.push("That is exactly the bonus, and it is being counted twice — the Payments total already has it.");
  }
  if (benefits > 0 && difference === benefits) {
    hints.push("That is exactly the taxable benefit, and the slip pays it in cash. Move it to “Cash allowance”, which counts in net as well as for the £100k line.");
  }
  if (benefits > 0 && difference === -benefits) {
    hints.push("That is exactly the taxable benefit. A benefit in kind is never paid to you, so it does not belong in Gross — it counts for the £100k line only.");
  }
  if (!hints.length) {
    hints.push(difference > 0
      ? "The calculation pays out more than the slip does, so a deduction is probably missing from Categories."
      : "The calculation pays out less than the slip does, so a deduction is probably too large, or Gross is too low.");
  }
  return hints;
}

export function usedPayslipCategories(slip, categories) {
  return (categories || []).filter((category) => (payslipAmountForCategory(slip, category) || 0) > 0);
}

export function previousPayslipForPerson(household, personId, beforeMonth = "") {
  return (household?.payslips || [])
    .filter((slip) => slip.personId === personId)
    .filter((slip) => !beforeMonth || String(slip.periodMonth) < beforeMonth)
    .sort((a, b) => String(b.periodMonth).localeCompare(String(a.periodMonth)))[0] || null;
}

/**
 * The months a new slip should open on. You add a payslip in the month the
 * money arrives — that is the month you are looking at and the month the
 * household spends it in — and the slip itself is for the period before.
 *
 * How far before is a fact about the person's employer, not a rule, so it is
 * read off their last slip: one is paid a month in arrears, another in the same
 * month. With no history to read, a month back is the common case.
 */
export function payslipMonthsForNewSlip(household, personId, landsMonth) {
  const last = previousPayslipForPerson(household, personId);
  const lastLands = last?.moneyLandsMonth || last?.periodMonth;
  const known = last?.periodMonth && lastLands
    ? monthsBetween(lastLands, last.periodMonth)
    : null;
  const offset = Number.isInteger(known) ? known : -1;
  return { moneyLandsMonth: landsMonth, periodMonth: addMonths(landsMonth, offset) };
}

/** Whole months from one month key to another, negative when it goes back. */
export function monthsBetween(from, to) {
  const a = parseMonthKey(from);
  const b = parseMonthKey(to);
  if (!a || !b) return null;
  return (b.year - a.year) * 12 + (b.month - a.month);
}

export function defaultCategoriesForNewPayslip(household, personId) {
  const last = previousPayslipForPerson(household, personId);
  if (!last) return [];
  return usedPayslipCategories(last, payslipCategoriesOf(household));
}

export function pendingsForMonth(household, month, today = new Date()) {
  const items = household?.pendings || [];
  const dated = items.filter((item) => item.month);
  if (dated.length) return items.filter((item) => item.month === month);
  return isCurrentMonth(month, today) ? items : [];
}

export function pendingListTotalPence(pendings) {
  return sumPence(pendings, (item) => item.amountPence);
}

export function coerceMonthKey(value, fallbackYear = new Date().getFullYear()) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12) {
    const year = Number.isInteger(fallbackYear) ? fallbackYear : new Date().getFullYear();
    return `${year}-${String(value).padStart(2, "0")}`;
  }
  const raw = String(value).trim();
  if (parseMonthKey(raw)) return raw;
  if (DATE.test(raw)) return raw.slice(0, 7);
  const padded = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (padded) {
    const month = Number(padded[2]);
    if (month >= 1 && month <= 12) return `${padded[1]}-${String(month).padStart(2, "0")}`;
  }
  const dotted = raw.match(/^(\d{4})[/.](\d{1,2})$/);
  if (dotted) {
    const month = Number(dotted[2]);
    if (month >= 1 && month <= 12) return `${dotted[1]}-${String(month).padStart(2, "0")}`;
  }
  const namedYear = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (namedYear && MONTH_NAMES[namedYear[1].toLowerCase()]) {
    return `${namedYear[2]}-${String(MONTH_NAMES[namedYear[1].toLowerCase()]).padStart(2, "0")}`;
  }
  const named = MONTH_NAMES[raw.toLowerCase()];
  if (named) {
    const year = Number.isInteger(fallbackYear) ? fallbackYear : new Date().getFullYear();
    return `${year}-${String(named).padStart(2, "0")}`;
  }
  return "";
}

export function oneOffMonthKey(item) {
  return coerceMonthKey(item?.month);
}

export function oneOffsForMonth(household, month) {
  return (household?.oneOffs || []).filter((item) => oneOffMonthKey(item) === month);
}

export function oneOffsOutsideMonth(household, month) {
  return (household?.oneOffs || []).filter((item) => oneOffMonthKey(item) !== month);
}

/**
 * Planned totals per month, this month and every month after it that has
 * something in it. Sorted forward, so a month filling up is easy to spot.
 */
export function plannedMonthTotals(household, fromMonth) {
  const byMonth = new Map();
  for (const item of household?.oneOffs || []) {
    const month = oneOffMonthKey(item);
    if (!month || month < fromMonth) continue;
    const row = byMonth.get(month) || { month, totalPence: 0, count: 0 };
    row.totalPence += item.estimatePence || 0;
    row.count += 1;
    byMonth.set(month, row);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function clearPendingsForMonth(household, month, today = new Date()) {
  const items = household?.pendings || [];
  const visible = new Set(pendingsForMonth(household, month, today).map((item) => item.id));
  household.pendings = items.filter((item) => !visible.has(item.id));
  return household;
}

export function addPendingRow(household, { id, amountPence = 0, note = "", month = "" } = {}) {
  const next = household.pendings || [];
  next.push({
    id: String(id || `pending-${next.length + 1}`),
    note: String(note || "").trim(),
    amountPence: Number.isInteger(amountPence) ? amountPence : 0,
    ...(month ? { month } : {}),
  });
  household.pendings = next;
  return household;
}

export function extraSacrificeRatio(projection) {
  const remaining = Number(projection?.projectedRestPence) || 0;
  const extra = Number(projection?.extraSacrificePence) || 0;
  if (extra <= 0) return 0;
  if (remaining <= 0) return 0;
  return extra / remaining;
}

export function resetMonthTicks(household, month) {
  const next = household;
  for (const envelope of next.envelopes || []) {
    envelope.happenedDates = (envelope.happenedDates || []).filter((date) => !String(date).startsWith(`${month}-`));
  }
  for (const rule of next.weeklyRules || []) {
    rule.tickedKeys = (rule.tickedKeys || []).filter((key) => !String(key).startsWith(`${month}:`));
  }
  for (const extra of next.weeklyExtras || []) {
    if (extra.month === month) extra.happened = false;
  }
  return next;
}

export function payslipIsConfirmed(payslip, today = new Date()) {
  if (!payslip || payslip.forecast) return false;
  const lands = payslip.moneyLandsMonth || payslip.periodMonth;
  return Boolean(lands) && lands <= monthKey(today);
}

/**
 * Adjusted net income for one slip: taxable pay plus taxable benefits, less the
 * grossed-up relief-at-source pension. A sacrifice needs no line here — it
 * never reached taxable pay. Grossed-up Gift Aid comes off across the year, in
 * aniProjection, because giving is not tied to a slip.
 */
export function payslipAniPence(payslip) {
  if (!payslip) return 0;
  const slip = payslipAsRead(payslip);
  return payslipTaxablePayPence(slip)
    + (slip.benefitsPence || 0)
    - basicRateGrossUpPence(slip.reliefAtSourcePensionPence || 0);
}

/**
 * Grossed-up Gift Aid donations for the tax year. Adjusted net income is net
 * income less the *gross* donation (ITA 2007 s58), so an £80 gift with Gift
 * Aid takes £100 off adjusted net income — it does not add the £20 uplift on.
 */
export function giftAidForTaxYear(donations, taxYear, { who } = {}) {
  const wanted = String(who || "").trim().toLowerCase();
  return sumPence(
    (donations || []).filter((donation) => {
      if (ukTaxYearFromDate(donation.date) !== taxYear || !donation.giftAid) return false;
      if (wanted && String(donation.who || "").trim().toLowerCase() !== wanted) return false;
      return true;
    }),
    (donation) => giftAidGrossPence(donation.amountPence, true),
  );
}

export function aniProjection({
  payslips = [],
  donations = [],
  personId,
  personName,
  taxYear,
  includeGiftAid = true,
  today = new Date(),
} = {}) {
  const slips = (payslips || [])
    .filter((slip) => slip.personId === personId && slip.taxYear === taxYear)
    .sort((a, b) => String(a.periodMonth).localeCompare(String(b.periodMonth)));
  // A net-only slip has no taxable pay on it, so it cannot count here. Left in,
  // it would read as a £0 month and drag the whole run-rate down with it, which
  // is worse than saying plainly that it is not counted.
  const allConfirmed = slips.filter((slip) => payslipIsConfirmed(slip, today));
  const confirmed = allConfirmed.filter(payslipHasDetail);
  const netOnlyCount = allConfirmed.length - confirmed.length;
  const months = [...new Set(confirmed.map((slip) => slip.periodMonth).filter(Boolean))];
  const remainingMonths = Math.max(0, 12 - months.length);
  const ytdPence = sumPence(confirmed, payslipAniPence);
  const last = confirmed[confirmed.length - 1];
  const lastMonthlyPence = last ? payslipAniPence(last) : 0;
  const projectedRestPence = lastMonthlyPence * remainingMonths;
  const giftAidReliefPence = includeGiftAid
    ? giftAidForTaxYear(donations, taxYear, { who: personName })
    : 0;
  const projectedPence = Math.max(0, ytdPence + projectedRestPence - giftAidReliefPence);
  const extraSacrificePence = Math.max(0, projectedPence - ANI_LIMIT_PENCE);
  const extraPerRemainingMonthPence = remainingMonths > 0
    ? Math.round(extraSacrificePence / remainingMonths)
    : extraSacrificePence;
  const extraSacrificeOfRemaining = extraSacrificeRatio({
    extraSacrificePence,
    projectedRestPence,
  });

  return {
    taxYear,
    confirmedCount: confirmed.length,
    monthsCounted: months.length,
    netOnlyCount,
    remainingMonths,
    ytdPence,
    lastMonthlyPence,
    projectedRestPence,
    giftAidReliefPence,
    projectedPence,
    extraSacrificePence,
    extraPerRemainingMonthPence,
    extraSacrificeOfRemaining,
    underByPence: Math.max(0, ANI_LIMIT_PENCE - projectedPence),
    overLimit: projectedPence > ANI_LIMIT_PENCE,
  };
}

export function aniFromHousehold(household, { personId, taxYear, today = new Date() } = {}) {
  const person = (household?.people || []).find((item) => item.id === personId);
  return aniProjection({
    payslips: household?.payslips || [],
    donations: household?.donations || [],
    personId,
    personName: person?.name,
    taxYear,
    includeGiftAid: true,
    today,
  });
}

export function isMonthKey(value) {
  return Boolean(parseMonthKey(value));
}

export function isIsoDate(value) {
  return DATE.test(String(value || ""));
}

export function isTaxYearLabel(value) {
  return taxYearStartYear(value) !== null;
}

export { DATE, MONTH, TAX_YEAR };
