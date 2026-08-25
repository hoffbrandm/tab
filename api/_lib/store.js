import { splitExpense } from "../../calculations.js";
import { HttpError } from "./http-error.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\w-]{1,80}$/;

export function emptyStore() {
  return { version: 1, friends: [], transactions: [] };
}

export function parseStore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Store must be an object.");
  }
  if (value.version !== 1) {
    throw new HttpError(400, "Unsupported store version.");
  }
  if (!Array.isArray(value.friends) || !Array.isArray(value.transactions)) {
    throw new HttpError(400, "Store must include friends and transactions arrays.");
  }

  const friends = value.friends.map(parseFriend);
  const friendIds = new Set(friends.map((friend) => friend.id));
  if (friendIds.size !== friends.length) {
    throw new HttpError(400, "Friend ids must be unique.");
  }

  const transactions = value.transactions.map((item) => parseTransaction(item, friendIds));
  const transactionIds = new Set(transactions.map((transaction) => transaction.id));
  if (transactionIds.size !== transactions.length) {
    throw new HttpError(400, "Transaction ids must be unique.");
  }

  return { version: 1, friends, transactions };
}

function parseFriend(friend) {
  if (!friend || typeof friend !== "object" || Array.isArray(friend)) {
    throw new HttpError(400, "Each friend must be an object.");
  }
  const name = String(friend.name || "").trim();
  if (!name || name.length > 60) {
    throw new HttpError(400, "Each friend needs a name.");
  }
  const email = String(friend.email || "").trim();
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new HttpError(400, "Friend email is not valid.");
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
    throw new HttpError(400, "Each transaction must be an object.");
  }
  const type = transaction.type;
  if (type !== "expense" && type !== "repayment") {
    throw new HttpError(400, "Transaction type must be expense or repayment.");
  }
  const paidBy = transaction.paidBy;
  if (paidBy !== "me" && paidBy !== "friend") {
    throw new HttpError(400, "paidBy must be me or friend.");
  }
  const amountPence = transaction.amountPence;
  if (!Number.isInteger(amountPence) || amountPence <= 0) {
    throw new HttpError(400, "Amount must be a positive whole number of pence.");
  }
  const friendId = requiredId(transaction.friendId, "Transaction friend");
  if (!friendIds.has(friendId)) {
    throw new HttpError(400, "Transaction refers to a friend that is not in the store.");
  }
  const date = String(transaction.date || "");
  if (!DATE.test(date)) {
    throw new HttpError(400, "Transaction date must be YYYY-MM-DD.");
  }
  const description = String(transaction.description || "").trim();
  if (description.length > 100) {
    throw new HttpError(400, "Transaction note is too long.");
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
      throw new HttpError(400, "Adjustment must be whole pence.");
    }
    try {
      splitExpense(amountPence, adjustment);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    parsed.myShareAdjustmentPence = adjustment;
  }

  return parsed;
}

function requiredId(value, label) {
  const id = String(value || "");
  if (!ID.test(id)) {
    throw new HttpError(400, `${label} id is invalid.`);
  }
  return id;
}

function parseTimestamp(value, label) {
  const text = String(value || "");
  const time = Date.parse(text);
  if (!text || Number.isNaN(time)) {
    throw new HttpError(400, `${label} timestamp is invalid.`);
  }
  return new Date(time).toISOString();
}
