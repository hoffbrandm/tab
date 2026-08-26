/** Household money: UK pence, April tax years, Gift Aid at 25%. */

export const ANI_LIMIT_PENCE = 10_000_000;
export const DEFAULT_PEOPLE = [
  { id: "person-you", name: "You" },
  { id: "person-partner", name: "Partner" },
];
export const PENSION_STATUSES = ["active", "deferred", "drawing", "other"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const TAX_YEAR = /^\d{4}-\d{2}$/;

export function emptyHousehold() {
  return {
    people: DEFAULT_PEOPLE.map((person) => ({ ...person })),
    incomes: [],
    bills: [],
    envelopes: [],
    cards: [],
    cardSubs: [],
    pendings: [],
    oneOffs: [],
    annualBills: [],
    pots: [],
    pensions: [],
    payslips: [],
    donations: [],
    includeGiftAidInAni: false,
  };
}

export function householdHasData(household) {
  if (!household || typeof household !== "object") return false;
  const lists = [
    "incomes",
    "bills",
    "envelopes",
    "cards",
    "cardSubs",
    "pendings",
    "oneOffs",
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

export function giftAidGrossPence(amountPence, giftAid) {
  if (!Number.isInteger(amountPence) || amountPence < 0) return 0;
  if (!giftAid) return amountPence;
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

export function paidInMonth(item, month) {
  return Array.isArray(item?.paidMonths) && item.paidMonths.includes(month);
}

export function happenedInMonth(envelope, month) {
  return (envelope?.happenedDates || []).filter((date) => String(date).startsWith(`${month}-`));
}

export function cardSubIsAllowed(sub, month, dayOfMonth) {
  if (paidInMonth(sub, month)) return true;
  return Number(sub.dueDay) > 0 && Number(sub.dueDay) <= dayOfMonth;
}

export function proRateDay(viewMonth, today = new Date()) {
  const current = monthKey(today);
  if (viewMonth < current) return daysInMonthKey(viewMonth);
  if (viewMonth > current) return 0;
  return today.getDate();
}

export function cashflowForMonth(household, month, today = new Date()) {
  const people = household?.people || [];
  const incomes = household?.incomes || [];
  const bills = household?.bills || [];
  const envelopes = household?.envelopes || [];
  const cards = household?.cards || [];
  const cardSubs = household?.cardSubs || [];
  const oneOffs = (household?.oneOffs || []).filter((item) => item.month === month);
  const annualBills = household?.annualBills || [];
  const days = daysInMonthKey(month);
  const dayOfMonth = proRateDay(month, today);

  const incomePence = sumPence(incomes, (item) => item.amountPence);
  const billsPence = sumPence(bills, (item) => item.amountPence);
  const annualReserve = annualReservePence(annualBills);
  const oneOffsPence = sumPence(oneOffs, (item) => item.estimatePence);
  const envelopesMonthlyPence = sumPence(envelopes, (item) => envelopeMonthlyPence(item.weeklyPence, month));
  const committedOutPence = billsPence + annualReserve + oneOffsPence;
  const potPence = incomePence - committedOutPence;
  const remainingAfterPlanPence = potPence - envelopesMonthlyPence;
  const allowedSoFarPence = days && dayOfMonth ? Math.round((potPence / days) * dayOfMonth) : 0;
  const allowedSubs = cardSubs.filter((sub) => cardSubIsAllowed(sub, month, dayOfMonth));
  const subsAllowedPence = sumPence(allowedSubs, (item) => item.amountPence);
  const allowedWithSubsPence = allowedSoFarPence + subsAllowedPence;
  const cardBalancesPence = sumPence(cards, (item) => item.balancePence);
  const pendingPence = sumPence(cards, (item) => item.pendingPence || 0)
    + sumPence(household?.pendings || [], (item) => item.amountPence);
  const cardSidePence = cardBalancesPence + pendingPence;
  const overUnderPence = allowedWithSubsPence - cardSidePence;

  return {
    month,
    daysInMonth: days,
    dayOfMonth,
    people,
    incomePence,
    billsPence,
    annualReservePence: annualReserve,
    oneOffsPence,
    oneOffs,
    envelopesMonthlyPence,
    committedOutPence,
    potPence,
    remainingAfterPlanPence,
    allowedSoFarPence,
    subsAllowedPence,
    allowedWithSubsPence,
    cardBalancesPence,
    pendingPence,
    cardSidePence,
    overUnderPence,
  };
}

export function spendVerdict(overUnderPence, formatMoney) {
  if (overUnderPence === 0) return "Cards match the allowed-so-far.";
  if (overUnderPence > 0) return `${formatMoney(overUnderPence)} under — room on the cards.`;
  return `${formatMoney(-overUnderPence)} over the allowed-so-far.`;
}

export function savingLine(flow) {
  if (flow.potPence < 0) return "This month does not balance yet.";
  if (flow.overUnderPence >= 0) return "On track to save.";
  return "Spending ahead of the pot.";
}

export function resetMonthTicks(household, month) {
  const next = household;
  for (const bill of next.bills || []) {
    bill.paidMonths = (bill.paidMonths || []).filter((item) => item !== month);
  }
  for (const sub of next.cardSubs || []) {
    sub.paidMonths = (sub.paidMonths || []).filter((item) => item !== month);
  }
  for (const envelope of next.envelopes || []) {
    envelope.happenedDates = (envelope.happenedDates || []).filter((date) => !String(date).startsWith(`${month}-`));
  }
  return next;
}

export function payslipIsConfirmed(payslip, today = new Date()) {
  if (!payslip || payslip.forecast) return false;
  const lands = payslip.moneyLandsMonth || payslip.periodMonth;
  return Boolean(lands) && lands <= monthKey(today);
}

export function payslipAniPence(payslip) {
  if (!payslip) return 0;
  const income = payslip.grossPence > 0
    ? payslip.grossPence
    : (payslip.salaryPence || 0) + (payslip.bonusPence || 0);
  return income + (payslip.benefitsPence || 0) - (payslip.salarySacrificePensionPence || 0);
}

export function giftAidForTaxYear(donations, taxYear, { who } = {}) {
  return sumPence(
    (donations || []).filter((donation) => {
      if (ukTaxYearFromDate(donation.date) !== taxYear || !donation.giftAid) return false;
      if (who && donation.who !== who) return false;
      return true;
    }),
    (donation) => giftAidGrossPence(donation.amountPence, true) - donation.amountPence,
  );
}

export function aniProjection({
  payslips = [],
  donations = [],
  personId,
  personName,
  taxYear,
  includeGiftAid = false,
  today = new Date(),
} = {}) {
  const slips = (payslips || [])
    .filter((slip) => slip.personId === personId && slip.taxYear === taxYear)
    .sort((a, b) => String(a.periodMonth).localeCompare(String(b.periodMonth)));
  const confirmed = slips.filter((slip) => payslipIsConfirmed(slip, today));
  const months = [...new Set(confirmed.map((slip) => slip.periodMonth).filter(Boolean))];
  const remainingMonths = Math.max(0, 12 - months.length);
  const ytdPence = sumPence(confirmed, payslipAniPence);
  const last = confirmed[confirmed.length - 1];
  const lastMonthlyPence = last ? payslipAniPence(last) : 0;
  const projectedRestPence = lastMonthlyPence * remainingMonths;
  const giftAidAddBackPence = includeGiftAid
    ? giftAidForTaxYear(donations, taxYear, { who: personName })
    : 0;
  const projectedPence = ytdPence + projectedRestPence + giftAidAddBackPence;
  const extraSacrificePence = Math.max(0, projectedPence - ANI_LIMIT_PENCE);
  const extraPerRemainingMonthPence = remainingMonths > 0
    ? Math.round(extraSacrificePence / remainingMonths)
    : extraSacrificePence;

  return {
    taxYear,
    confirmedCount: confirmed.length,
    monthsCounted: months.length,
    remainingMonths,
    ytdPence,
    lastMonthlyPence,
    projectedRestPence,
    giftAidAddBackPence,
    projectedPence,
    extraSacrificePence,
    extraPerRemainingMonthPence,
    underByPence: Math.max(0, ANI_LIMIT_PENCE - projectedPence),
    overLimit: projectedPence > ANI_LIMIT_PENCE,
  };
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
