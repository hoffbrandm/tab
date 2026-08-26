import { splitExpense } from "./calculations.js";
import {
  emptyHousehold,
  isIsoDate,
  isMonthKey,
  isTaxYearLabel,
  PENSION_STATUSES,
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

export function parseStore(value) {
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

  return { version: 1, friends, transactions, household: parseHousehold(value.household) };
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

function parseHousehold(value) {
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
  const pendings = list(value.pendings).map(parsePending);
  const oneOffs = list(value.oneOffs).map(parseOneOff);
  const annualBills = list(value.annualBills).map(parseAnnualBill);
  const pots = list(value.pots).map(parsePot);
  const pensions = list(value.pensions).map(parsePension);
  const payslips = list(value.payslips).map((item) => parsePayslip(item, personIds));
  const donations = list(value.donations).map(parseDonation);

  uniqueIds(incomes, "Income");
  uniqueIds(bills, "Bill");
  uniqueIds(envelopes, "Envelope");
  uniqueIds(cards, "Card");
  uniqueIds(cardSubs, "Card subscription");
  uniqueIds(pendings, "Pending");
  uniqueIds(oneOffs, "One-off");
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
    cards,
    cardSubs,
    pendings,
    oneOffs,
    annualBills,
    pots,
    pensions,
    payslips,
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
    paidMonths: monthList(bill.paidMonths, "Bill"),
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
  return {
    id: requiredId(card.id, "Card"),
    name: requiredName(card.name, "Card"),
    balancePence: moneyPence(card.balancePence, "Card"),
    pendingPence: moneyPence(card.pendingPence, "Card pending"),
    updatedOn: optionalDate(card.updatedOn, "Card"),
  };
}

function parsePending(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new StoreError("Each pending amount must be an object.");
  }
  return {
    id: requiredId(item.id, "Pending"),
    name: requiredName(item.name, "Pending"),
    amountPence: moneyPence(item.amountPence, "Pending"),
  };
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
    paidMonths: monthList(sub.paidMonths, "Card subscription"),
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
  if (!isMonthKey(item.month)) throw new StoreError("One-off month must be YYYY-MM.");
  return {
    id: requiredId(item.id, "One-off"),
    name: requiredName(item.name, "One-off"),
    month: item.month,
    estimatePence: moneyPence(item.estimatePence, "One-off"),
    purchased: Boolean(item.purchased),
  };
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
  return {
    id: requiredId(pot.id, "Pot"),
    name: requiredName(pot.name, "Pot"),
    amountPence: moneyPence(pot.amountPence, "Pot"),
    updatedOn: optionalDate(pot.updatedOn, "Pot"),
  };
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
    benefitsPence: moneyPence(slip.benefitsPence, "Payslip benefits"),
    salarySacrificePensionPence: moneyPence(slip.salarySacrificePensionPence, "Payslip salary sacrifice"),
    otherDeductions,
    taxPence: moneyPence(slip.taxPence, "Payslip tax"),
    niPence: moneyPence(slip.niPence, "Payslip NI"),
    netPence: moneyPence(slip.netPence, "Payslip net"),
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
  return {
    id: requiredId(item.id, "Deduction"),
    label,
    amountPence: moneyPence(item.amountPence, "Deduction"),
  };
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

function monthList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new StoreError(`${label} paid months must be an array.`);
  const months = [...new Set(value.map(String))].filter(Boolean);
  if (months.some((month) => !isMonthKey(month))) {
    throw new StoreError(`${label} paid month must be YYYY-MM.`);
  }
  return months.sort();
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
