import { splitExpense } from "./calculations.js";
import {
  BUILTIN_PAYSLIP_CATEGORIES,
  normalizeDueRoll,
  emptyHousehold,
  isIsoDate,
  isMonthKey,
  coerceMonthKey,
  isTaxYearLabel,
  looksLikeDailyEnvelope,
  monthKey,
  parseMonthKey,
  normalizeWeeklyCadence,
  PAYSLIP_CATEGORY_KINDS,
  PENSION_STATUSES,
  payslipCategoriesOf,
  seedSnapshotsFromUpdatedOn,
  tickedKeysFromHappenedDates,
} from "./household.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\w-]{1,80}$/;

export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "StoreError";
  }
}

export function emptyStore() {
  return { version: 1, friends: [], transactions: [], household: emptyHousehold() };
}

export function parseStore(value, today = new Date()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StoreError("Store must be an object.");
  }
  if (value.version !== 1) {
    throw new StoreError("Unsupported store version.");
  }
  if (!Array.isArray(value.friends) || !Array.isArray(value.transactions)) {
    throw new StoreError("Store must include friends and transactions arrays.");
  }

  const friends = value.friends.map(parseFriend);
  const friendIds = new Set(friends.map((friend) => friend.id));
  if (friendIds.size !== friends.length) {
    throw new StoreError("Friend ids must be unique.");
  }

  const transactions = value.transactions.map((item) => parseTransaction(item, friendIds));
  const transactionIds = new Set(transactions.map((transaction) => transaction.id));
  if (transactionIds.size !== transactions.length) {
    throw new StoreError("Transaction ids must be unique.");
  }

  return { version: 1, friends, transactions, household: parseHousehold(value.household, today) };
}

function parseFriend(friend) {
  if (!friend || typeof friend !== "object" || Array.isArray(friend)) {
    throw new StoreError("Each friend must be an object.");
  }
  const name = String(friend.name || "").trim();
  if (!name || name.length > 60) {
    throw new StoreError("Each friend needs a name.");
  }
  const email = String(friend.email || "").trim();
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new StoreError("Friend email is not valid.");
  }
  return {
    id: requiredId(friend.id, "Friend"),
    name,
    email,
    createdAt: parseTimestamp(friend.createdAt, "Friend"),
  };
}

function parseTransaction(transaction, friendIds) {
  if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) {
    throw new StoreError("Each transaction must be an object.");
  }
  const type = transaction.type;
  if (type !== "expense" && type !== "repayment") {
    throw new StoreError("Transaction type must be expense or repayment.");
  }
  const paidBy = transaction.paidBy;
  if (paidBy !== "me" && paidBy !== "friend") {
    throw new StoreError("paidBy must be me or friend.");
  }
  const amountPence = transaction.amountPence;
  if (!Number.isInteger(amountPence) || amountPence <= 0) {
    throw new StoreError("Amount must be a positive whole number of pence.");
  }
  const friendId = requiredId(transaction.friendId, "Transaction friend");
  if (!friendIds.has(friendId)) {
    throw new StoreError("Transaction refers to a friend that is not in the store.");
  }
  const date = String(transaction.date || "");
  if (!DATE.test(date)) {
    throw new StoreError("Transaction date must be YYYY-MM-DD.");
  }
  const description = String(transaction.description || "").trim();
  if (description.length > 100) {
    throw new StoreError("Transaction note is too long.");
  }

  const parsed = {
    id: requiredId(transaction.id, "Transaction"),
    friendId,
    type,
    amountPence,
    paidBy,
    description,
    date,
    createdAt: parseTimestamp(transaction.createdAt, "Transaction"),
  };

  if (type === "expense") {
    const adjustment = transaction.myShareAdjustmentPence || 0;
    if (!Number.isInteger(adjustment)) {
      throw new StoreError("Adjustment must be whole pence.");
    }
    try {
      splitExpense(amountPence, adjustment);
    } catch (error) {
      throw new StoreError(error.message);
    }
    parsed.myShareAdjustmentPence = adjustment;
  }

  return parsed;
}

function parseHousehold(value, today = new Date()) {
  if (value == null) return emptyHousehold();
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new StoreError("Household must be an object.");
  }

  const people = Array.isArray(value.people) && value.people.length
    ? value.people.map(parsePerson)
    : emptyHousehold().people;
  const personIds = new Set(people.map((person) => person.id));
  if (personIds.size !== people.length) {
    throw new StoreError("Household person ids must be unique.");
  }

  const incomes = list(value.incomes).map((item) => parseIncome(item, personIds));
  const bills = list(value.bills).map(parseBill);
  const envelopes = list(value.envelopes).map(parseEnvelope);
  const cards = list(value.cards).map(parseCard);
  const cardIds = new Set(cards.map((card) => card.id));
  const cardSubs = list(value.cardSubs).map((item) => parseCardSub(item, cardIds));
  // "Cash in reserve" was one list holding two different things: the day money,
  // which is now the per diem in its own right, and standing cash costs like the
  // cleaner. The standing ones are read as the cash monthlies they always were,
  // which leaves Out exactly where it was — they counted as cash either way.
  const legacyReserves = list(value.reserves).map(parseReserve);
  const perDiem = parsePerDiem(value.perDiem, legacyReserves);
  const reservesAsMonthlies = legacyReserves
    .filter((item) => !looksLikeDailyEnvelope(item.name))
    .map((item) => ({
      id: `reserve-${item.id}`,
      name: item.name,
      amountPence: item.amountPence,
      dueDay: 1,
      dueRoll: normalizeDueRoll(),
      paidFrom: "cash",
    }));
  const monthlies = [...(list(value.monthlies).length
    ? list(value.monthlies).map(parseMonthly)
    : [
      ...bills.map((item) => ({ ...item, id: `cash-${item.id}`, paidFrom: "cash" })),
      ...cardSubs.map((item) => ({
        id: `card-${item.id}`,
        name: item.name,
        amountPence: item.amountPence,
        dueDay: item.dueDay,
        paidFrom: "card",
      })),
    ]), ...reservesAsMonthlies];
  const weeklyRules = list(value.weeklyRules).length
    ? list(value.weeklyRules).map(parseWeeklyRule)
    : envelopes.map((item) => ({
      id: item.id,
      name: item.name,
      amountPence: item.weeklyPence,
      cadence: "times",
      timesPerMonth: 4,
      weekday: 2,
      tickedKeys: tickedKeysFromHappenedDates(item.happenedDates),
      paidFrom: item.paidFrom === "cash" ? "cash" : "card",
    }));
  const weeklyExtras = list(value.weeklyExtras).map(parseWeeklyExtra);
  const pendings = list(value.pendings).map(parsePending);
  const oneOffs = normalizeOneOffsForViewMonth(list(value.oneOffs).map(parseOneOff), today).items;
  const exceptions = list(value.exceptions).map(parseException);
  const setAsides = list(value.setAsides).map(parseSetAside);
  const fromSavings = list(value.fromSavings).map(parseFromSavings);
  const annualBills = list(value.annualBills).map(parseAnnualBill);
  const pots = list(value.pots).map(parsePot);
  const pensions = list(value.pensions).map(parsePension);
  const payslips = list(value.payslips).map((item) => parsePayslip(item, personIds));
  const payslipCategories = payslipCategoriesOf({
    payslipCategories: list(value.payslipCategories).map(parsePayslipCategory),
    payslips,
  });
  const donations = list(value.donations).map(parseDonation);

  uniqueIds(incomes, "Income");
  uniqueIds(bills, "Bill");
  uniqueIds(envelopes, "Envelope");
  uniqueIds(monthlies, "Monthly");
  uniqueIds(weeklyRules, "Weekly rule");
  uniqueIds(weeklyExtras, "Weekly extra");
  uniqueIds(cards, "Card");
  uniqueIds(cardSubs, "Card subscription");
  uniqueIds(pendings, "Pending");
  uniqueIds(oneOffs, "One-off");
  uniqueIds(exceptions, "Exception");
  uniqueIds(setAsides, "Set aside");
  uniqueIds(fromSavings, "From savings");
  uniqueIds(annualBills, "Annual bill");
  uniqueIds(pots, "Pot");
  uniqueIds(pensions, "Pension");
  uniqueIds(payslips, "Payslip");
  uniqueIds(donations, "Donation");

  return {
    people,
    incomes,
    bills,
    envelopes,
    monthlies,
    weeklyRules,
    weeklyExtras,
    cards,
    cardSubs,
    pendings,
    perDiem,
    oneOffs,
    exceptions,
    fromSavings,
    setAsides,
    annualBills,
    pots,
    pensions,
    payslips,
    payslipCategories,
    donations,
    includeGiftAidInAni: Boolean(value.includeGiftAidInAni),
  };
}

function list(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new StoreError("Household lists must be arrays.");
  return value;
}

function uniqueIds(items, label) {
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) throw new StoreError(`${label} ids must be unique.`);
}

function parsePerson(person) {
  if (!person || typeof person !== "object" || Array.isArray(person)) {
    throw new StoreError("Each person must be an object.");
  }
  return { id: requiredId(person.id, "Person"), name: requiredName(person.name, "Person") };
}

function parseIncome(income, personIds) {
  if (!income || typeof income !== "object" || Array.isArray(income)) {
    throw new StoreError("Each income must be an object.");
  }
  const personId = requiredId(income.personId, "Income person");
  if (!personIds.has(personId)) throw new StoreError("Income refers to a person that is not in the household.");
  return {
    id: requiredId(income.id, "Income"),
    personId,
    label: requiredName(income.label, "Income"),
    amountPence: moneyPence(income.amountPence, "Income"),
  };
}

function parseBill(bill) {
  if (!bill || typeof bill !== "object" || Array.isArray(bill)) {
    throw new StoreError("Each bill must be an object.");
  }
  return {
    id: requiredId(bill.id, "Bill"),
    name: requiredName(bill.name, "Bill"),
    amountPence: moneyPence(bill.amountPence, "Bill"),
    dueDay: dueDay(bill.dueDay, "Bill"),
  };
}

function parseEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new StoreError("Each envelope must be an object.");
  }
  return {
    id: requiredId(envelope.id, "Envelope"),
    name: requiredName(envelope.name, "Envelope"),
    weeklyPence: moneyPence(envelope.weeklyPence, "Envelope"),
    happenedDates: dateList(envelope.happenedDates, "Envelope"),
  };
}

function parseCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    throw new StoreError("Each card must be an object.");
  }
  const parsed = {
    id: requiredId(card.id, "Card"),
    name: requiredName(card.name, "Card"),
    balancePence: moneyPence(card.balancePence, "Card"),
    pendingPence: moneyPence(card.pendingPence, "Card pending"),
    updatedOn: optionalDate(card.updatedOn, "Card"),
  };
  parsed.snapshots = snapshotList(
    card.snapshots?.length ? card.snapshots : seedSnapshotsFromUpdatedOn(parsed, { includePending: true }),
    "Card",
    { includePending: true },
  );
  return parsed;
}

function parsePending(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each pending amount must be an object.");
  }
  const note = String(item.note || item.name || "").trim();
  if (note.length > 80) throw new StoreError("Pending note is too long.");
  const parsed = {
    id: requiredId(item.id, "Pending"),
    note,
    // A refund or credit on the statement is a negative pending amount.
    amountPence: signedPence(item.amountPence, "Pending"),
  };
  if (item.month) {
    if (!isMonthKey(item.month)) throw new StoreError("Pending month must be YYYY-MM.");
    parsed.month = item.month;
  }
  return parsed;
}

/**
 * The month's spending money: one figure for the whole month. An older
 * household kept it as the daily "cash in reserve" line, so that is where it is
 * read from when nothing has been set yet.
 */
function parsePerDiem(value, legacyReserves) {
  if (value != null) {
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new StoreError("Per diem must be an object.");
    }
    return { amountPence: moneyPence(value.amountPence, "Per diem") };
  }
  return {
    amountPence: legacyReserves
      .filter((item) => looksLikeDailyEnvelope(item.name))
      .reduce((sum, item) => sum + item.amountPence, 0),
  };
}

function parseReserve(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each reserve line must be an object.");
  }
  return {
    id: requiredId(item.id, "Reserve"),
    name: requiredName(item.name, "Reserve"),
    amountPence: moneyPence(item.amountPence, "Reserve"),
    // Where it is spent decides whether it enters the card allowance. Absent is
    // a real state, not a default: the line's name decides on read, so a value
    // is only kept when it was actually chosen.
    ...(item.paidFrom === "cash" || item.paidFrom === "card" ? { paidFrom: item.paidFrom } : {}),
  };
}

function parseMonthly(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each monthly expected must be an object.");
  }
  const paidFrom = item.paidFrom === "cash" ? "cash" : "card";
  // "First working day of the month" was day 1 rolled forward all along, so an
  // older record is stored as the rule it always meant.
  const wasFirstWorking = item.dueRoll === "firstWorking";
  const dueRoll = normalizeDueRoll(item.dueRoll);
  return {
    id: requiredId(item.id, "Monthly"),
    name: requiredName(item.name, "Monthly"),
    amountPence: moneyPence(item.amountPence, "Monthly"),
    dueDay: wasFirstWorking ? 1 : dueDay(item.dueDay, "Monthly"),
    dueRoll,
    paidFrom,
  };
}

function parseWeeklyRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new StoreError("Each weekly rule must be an object.");
  }
  const next = normalizeWeeklyCadence(rule);
  const parsed = {
    id: requiredId(rule.id, "Weekly rule"),
    name: requiredName(rule.name, "Weekly rule"),
    amountPence: moneyPence(rule.amountPence, "Weekly rule"),
    cadence: next.cadence,
    tickedKeys: tickKeyList(rule.tickedKeys, "Weekly rule"),
    paidFrom: rule.paidFrom === "cash" ? "cash" : "card",
  };
  if (next.cadence === "times") {
    parsed.timesPerMonth = next.timesPerMonth;
  }
  if (next.cadence === "weekday") {
    const weekday = Number(next.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      throw new StoreError("Weekday must be Monday (1) to Sunday (7).");
    }
    parsed.weekday = weekday;
  }
  return parsed;
}

function parseWeeklyExtra(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each extra weekly must be an object.");
  }
  if (!isMonthKey(item.month)) throw new StoreError("Extra weekly month must be YYYY-MM.");
  return {
    id: requiredId(item.id, "Weekly extra"),
    name: requiredName(item.name, "Weekly extra"),
    amountPence: moneyPence(item.amountPence, "Weekly extra"),
    month: item.month,
    happened: Boolean(item.happened),
    paidFrom: item.paidFrom === "cash" ? "cash" : "card",
  };
}

function tickKeyList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new StoreError(`${label} ticks must be an array.`);
  return [...new Set(value.map(String))].filter(Boolean).sort();
}

function parseCardSub(sub, cardIds) {
  if (!sub || typeof sub !== "object" || Array.isArray(sub)) {
    throw new StoreError("Each card subscription must be an object.");
  }
  const parsed = {
    id: requiredId(sub.id, "Card subscription"),
    name: requiredName(sub.name, "Card subscription"),
    amountPence: moneyPence(sub.amountPence, "Card subscription"),
    dueDay: dueDay(sub.dueDay, "Card subscription"),
  };
  if (sub.cardId) {
    const cardId = requiredId(sub.cardId, "Card subscription card");
    if (!cardIds.has(cardId)) throw new StoreError("Card subscription refers to a card that is not in the household.");
    parsed.cardId = cardId;
  }
  return parsed;
}

function parseOneOff(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each planned one-off must be an object.");
  }
  const month = coerceMonthKey(item.month);
  if (!isMonthKey(month)) throw new StoreError("One-off month must be YYYY-MM.");
  return {
    id: requiredId(item.id, "One-off"),
    name: requiredName(item.name, "One-off"),
    month,
    estimatePence: moneyPence(item.estimatePence, "One-off"),
    purchased: Boolean(item.purchased),
    // Card unless it says otherwise, which is what an older record means.
    paidFrom: item.paidFrom === "cash" ? "cash" : "card",
    // The day is optional, and only a card line has anywhere to use it.
    ...(Number.isInteger(item.dueDay) && item.dueDay >= 1 && item.dueDay <= 31
      ? { dueDay: item.dueDay }
      : {}),
  };
}

function parseException(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each exception must be an object.");
  }
  const month = coerceMonthKey(item.month);
  if (!isMonthKey(month)) throw new StoreError("Exception month must be YYYY-MM.");
  return {
    id: requiredId(item.id, "Exception"),
    name: requiredName(item.name, "Exception"),
    month,
    amountPence: moneyPence(item.amountPence, "Exception"),
  };
}

/** Money drawn in from savings for one month, on top of its exceptions. */
function parseFromSavings(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each from-savings line must be an object.");
  }
  const month = coerceMonthKey(item.month);
  if (!isMonthKey(month)) throw new StoreError("From-savings month must be YYYY-MM.");
  return {
    id: requiredId(item.id, "From savings"),
    name: requiredName(item.name, "From savings"),
    month,
    amountPence: moneyPence(item.amountPence, "From savings"),
  };
}

/** The mirror of an exception: money kept off the cards for one month. */
function parseSetAside(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each set-aside must be an object.");
  }
  const month = coerceMonthKey(item.month);
  if (!isMonthKey(month)) throw new StoreError("Set-aside month must be YYYY-MM.");
  return {
    id: requiredId(item.id, "Set aside"),
    name: requiredName(item.name, "Set aside"),
    month,
    amountPence: moneyPence(item.amountPence, "Set aside"),
  };
}

function referenceMonthKey(today) {
  if (typeof today === "string") {
    const coerced = coerceMonthKey(today);
    if (isMonthKey(coerced)) return coerced;
  }
  if (today instanceof Date && !Number.isNaN(today.getTime())) return monthKey(today);
  return monthKey(new Date());
}

function oneOffFingerprint(items) {
  return (items || [])
    .map((item) => `${item.id}:${item.month || ""}`)
    .sort()
    .join("\n");
}

// On load, leftover import years become the current/view year (purchased or not).
// Months before today/view are dropped. Last year’s purchased rows are not kept as history.
export function normalizeOneOffsForViewMonth(oneOffs, today = new Date()) {
  const viewKey = referenceMonthKey(today);
  const view = parseMonthKey(viewKey);
  const source = Array.isArray(oneOffs) ? oneOffs : [];
  if (!view) return { items: [...source], changed: false };
  const items = [];
  for (const item of source) {
    const planned = parseMonthKey(item.month);
    if (!planned) {
      items.push(item);
      continue;
    }
    const month = planned.year < view.year
      ? `${String(view.year).padStart(4, "0")}-${String(planned.month).padStart(2, "0")}`
      : item.month;
    if (month < viewKey) continue;
    items.push(month === item.month ? item : { ...item, month });
  }
  return { items, changed: oneOffFingerprint(source) !== oneOffFingerprint(items) };
}

export function gistOneOffsNeedRewrite(rawStore, parsedStore) {
  const raw = (rawStore?.household?.oneOffs || []).map((item) => ({
    id: item?.id,
    month: coerceMonthKey(item?.month) || String(item?.month || ""),
  }));
  return oneOffFingerprint(raw) !== oneOffFingerprint(parsedStore?.household?.oneOffs);
}

function parseAnnualBill(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each annual bill must be an object.");
  }
  const parsed = {
    id: requiredId(item.id, "Annual bill"),
    name: requiredName(item.name, "Annual bill"),
    amountPence: moneyPence(item.amountPence, "Annual bill"),
  };
  if (item.month != null && item.month !== "") {
    const month = Number(item.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new StoreError("Annual bill month must be 1 to 12.");
    }
    parsed.month = month;
  }
  return parsed;
}

function parsePot(pot) {
  if (!pot || typeof pot !== "object" || Array.isArray(pot)) {
    throw new StoreError("Each pot must be an object.");
  }
  const parsed = {
    id: requiredId(pot.id, "Pot"),
    name: requiredName(pot.name, "Pot"),
    amountPence: moneyPence(pot.amountPence, "Pot"),
    updatedOn: optionalDate(pot.updatedOn, "Pot"),
  };
  parsed.snapshots = snapshotList(
    pot.snapshots?.length ? pot.snapshots : seedSnapshotsFromUpdatedOn(parsed),
    "Pot",
  );
  return parsed;
}

function parsePayslipCategory(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each payslip category must be an object.");
  }
  const kind = PAYSLIP_CATEGORY_KINDS.includes(item.kind)
    ? item.kind
    : (item.inNet === false || item.parental ? "parental" : "deduction");
  const builtin = BUILTIN_PAYSLIP_CATEGORIES.find((entry) => entry.kind === kind && kind !== "deduction" && kind !== "parental");
  return {
    id: requiredId(item.id || builtin?.id || `cat-${kind}`, "Payslip category"),
    label: requiredName(item.label || builtin?.label, "Payslip category"),
    kind,
  };
}

function snapshotList(value, label, { includePending = false } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new StoreError(`${label} snapshots must be an array.`);
  const byMonth = new Map();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new StoreError(`${label} snapshot must be an object.`);
    }
    if (!isMonthKey(item.month)) throw new StoreError(`${label} snapshot month must be YYYY-MM.`);
    byMonth.set(item.month, {
      month: item.month,
      amountPence: moneyPence(item.amountPence, `${label} snapshot`),
      ...(includePending ? { pendingPence: moneyPence(item.pendingPence, `${label} snapshot pending`) } : {}),
      updatedOn: optionalDate(item.updatedOn, `${label} snapshot`),
    });
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function parsePension(pension) {
  if (!pension || typeof pension !== "object" || Array.isArray(pension)) {
    throw new StoreError("Each pension must be an object.");
  }
  const status = String(pension.status || "other");
  if (!PENSION_STATUSES.includes(status)) {
    throw new StoreError("Pension status is not valid.");
  }
  const note = String(pension.note || "").trim();
  if (note.length > 120) throw new StoreError("Pension note is too long.");
  return {
    id: requiredId(pension.id, "Pension"),
    name: requiredName(pension.name, "Pension"),
    status,
    note,
  };
}

function parsePayslip(slip, personIds) {
  if (!slip || typeof slip !== "object" || Array.isArray(slip)) {
    throw new StoreError("Each payslip must be an object.");
  }
  const personId = requiredId(slip.personId, "Payslip person");
  if (!personIds.has(personId)) throw new StoreError("Payslip refers to a person that is not in the household.");
  if (!isTaxYearLabel(slip.taxYear)) throw new StoreError("Payslip tax year is not valid.");
  if (!isMonthKey(slip.periodMonth)) throw new StoreError("Payslip period must be YYYY-MM.");
  const moneyLandsMonth = slip.moneyLandsMonth || slip.periodMonth;
  if (!isMonthKey(moneyLandsMonth)) throw new StoreError("Payslip landing month must be YYYY-MM.");
  const note = String(slip.note || "").trim();
  if (note.length > 200) throw new StoreError("Payslip note is too long.");
  const otherDeductions = list(slip.otherDeductions)
    .map(parseDeduction)
    .filter((item) => item.label || item.amountPence);
  uniqueIds(otherDeductions, "Payslip deduction");
  return {
    id: requiredId(slip.id, "Payslip"),
    personId,
    taxYear: slip.taxYear,
    periodMonth: slip.periodMonth,
    salaryPence: moneyPence(slip.salaryPence, "Payslip salary"),
    grossPence: moneyPence(slip.grossPence, "Payslip gross"),
    bonusPence: moneyPence(slip.bonusPence, "Payslip bonus"),
    // An allowance was briefly its own field; it is a benefit that gets paid.
    benefitsPence: moneyPence(slip.benefitsPence, "Payslip benefits") || moneyPence(slip.allowancePence, "Payslip benefits"),
    benefitsPaid: Boolean(slip.benefitsPaid) || moneyPence(slip.allowancePence, "Payslip benefits") > 0,
    salarySacrificePensionPence: moneyPence(slip.salarySacrificePensionPence, "Payslip salary sacrifice"),
    reliefAtSourcePensionPence: moneyPence(slip.reliefAtSourcePensionPence, "Payslip relief-at-source pension"),
    grossBeforeSacrifice: Boolean(slip.grossBeforeSacrifice),
    grossExcludesBonus: Boolean(slip.grossExcludesBonus),
    otherDeductions,
    taxPence: moneyPence(slip.taxPence, "Payslip tax"),
    niPence: moneyPence(slip.niPence, "Payslip NI"),
    // netPence is derived and cached; statedNetPence is what the slip itself says.
    netPence: moneyPence(slip.netPence, "Payslip net"),
    statedNetPence: moneyPence(slip.statedNetPence, "Payslip stated net"),
    note,
    moneyLandsMonth,
    forecast: Boolean(slip.forecast),
    taxCode: optionalTaxCode(slip.taxCode),
  };
}

function optionalTaxCode(value) {
  const code = String(value || "").trim();
  if (!code) return "";
  if (code.length > 20) throw new StoreError("Payslip tax code is too long.");
  return code;
}

function parseDeduction(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each payslip deduction must be an object.");
  }
  const label = String(item.label || "").trim();
  if (label.length > 80) throw new StoreError("Deduction name is too long.");
  const parsed = {
    id: requiredId(item.id, "Deduction"),
    label,
    amountPence: moneyPence(item.amountPence, "Deduction"),
  };
  if (item.extra) parsed.extra = true;
  if (item.inNet === false || item.parental || item.kind === "parental") parsed.inNet = false;
  return parsed;
}

function parseDonation(donation) {
  if (!donation || typeof donation !== "object" || Array.isArray(donation)) {
    throw new StoreError("Each donation must be an object.");
  }
  if (!isIsoDate(donation.date)) throw new StoreError("Donation date must be YYYY-MM-DD.");
  return {
    id: requiredId(donation.id, "Donation"),
    who: requiredName(donation.who, "Donation who"),
    charity: requiredName(donation.charity, "Charity"),
    date: donation.date,
    amountPence: moneyPence(donation.amountPence, "Donation"),
    giftAid: Boolean(donation.giftAid),
  };
}

function requiredName(value, label) {
  const name = String(value || "").trim();
  if (!name || name.length > 80) throw new StoreError(`${label} needs a name.`);
  return name;
}

function signedPence(value, label) {
  const amount = value == null || value === "" ? 0 : value;
  if (!Number.isInteger(amount)) {
    throw new StoreError(`${label} must be a whole number of pence.`);
  }
  return amount;
}

function moneyPence(value, label) {
  const amount = value == null || value === "" ? 0 : value;
  if (!Number.isInteger(amount) || amount < 0) {
    throw new StoreError(`${label} must be a whole number of pence.`);
  }
  return amount;
}

function dueDay(value, label) {
  const day = value == null || value === "" ? 1 : Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new StoreError(`${label} due day must be 1 to 31.`);
  }
  return day;
}

function dateList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new StoreError(`${label} dates must be an array.`);
  const dates = [...new Set(value.map(String))].filter(Boolean);
  if (dates.some((date) => !isIsoDate(date))) {
    throw new StoreError(`${label} date must be YYYY-MM-DD.`);
  }
  return dates.sort();
}

function optionalDate(value, label) {
  if (!value) return "";
  if (!isIsoDate(value)) throw new StoreError(`${label} date must be YYYY-MM-DD.`);
  return value;
}

function requiredId(value, label) {
  const id = String(value || "");
  if (!ID.test(id)) {
    throw new StoreError(`${label} id is invalid.`);
  }
  return id;
}

function parseTimestamp(value, label) {
  const text = String(value || "");
  const time = Date.parse(text);
  if (!text || Number.isNaN(time)) {
    throw new StoreError(`${label} timestamp is invalid.`);
  }
  return new Date(time).toISOString();
}
