/** Currency is represented as whole pence throughout this module. */
export function splitExpense(amountPence, myShareAdjustmentPence = 0) {
  const baseMyShare = Math.floor(amountPence / 2);
  const mySharePence = baseMyShare + myShareAdjustmentPence;
  if (!Number.isInteger(amountPence) || amountPence <= 0) throw new Error("Amount must be a positive whole number of pence.");
  if (!Number.isInteger(myShareAdjustmentPence)) throw new Error("Adjustment must be whole pence.");
  if (mySharePence < 0 || mySharePence > amountPence) throw new Error("Adjustment cannot make either person's share negative.");
  return { mySharePence, friendSharePence: amountPence - mySharePence };
}

/** A flat, named amount for each side rather than a nudge off half. */
export function splitExact(amountPence, mySharePence) {
  if (!Number.isInteger(amountPence) || amountPence <= 0) throw new Error("Amount must be a positive whole number of pence.");
  if (!Number.isInteger(mySharePence) || mySharePence < 0 || mySharePence > amountPence) {
    throw new Error("Share must be between zero and the total.");
  }
  return { mySharePence, friendSharePence: amountPence - mySharePence };
}

/** Split by headcount on each side, e.g. 3 of mine against 1 of theirs. */
export function splitByPeople(amountPence, myCount, friendCount) {
  if (!Number.isInteger(amountPence) || amountPence <= 0) throw new Error("Amount must be a positive whole number of pence.");
  if (!Number.isInteger(myCount) || !Number.isInteger(friendCount) || myCount < 0 || friendCount < 0 || myCount + friendCount <= 0) {
    throw new Error("Enter how many people are on each side.");
  }
  const mySharePence = Math.round((amountPence * myCount) / (myCount + friendCount));
  return { mySharePence, friendSharePence: amountPence - mySharePence };
}

export function resolveSplit(transaction) {
  if (transaction.splitMode === "exact") return splitExact(transaction.amountPence, transaction.mySharePence);
  if (transaction.splitMode === "shares") return splitByPeople(transaction.amountPence, transaction.myShareUnits, transaction.friendShareUnits);
  return splitExpense(transaction.amountPence, transaction.myShareAdjustmentPence || 0);
}

export function transactionImpact(transaction) {
  // A positive balance means the friend still owes me. Cash paid to me reduces it;
  // cash I pay to the friend increases it.
  if (transaction.type === "repayment") return transaction.paidBy === "friend" ? -transaction.amountPence : transaction.amountPence;
  if (transaction.type !== "expense") throw new Error("Unknown transaction type.");
  const { mySharePence, friendSharePence } = resolveSplit(transaction);
  return transaction.paidBy === "me" ? friendSharePence : -mySharePence;
}

export function balanceFor(transactions, friendId) {
  return transactions.filter((transaction) => transaction.friendId === friendId).reduce((balance, transaction) => balance + transactionImpact(transaction), 0);
}

export function sortedTransactions(transactions) {
  return [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export function runningBalances(transactions, friendId) {
  let balance = 0;
  return sortedTransactions(transactions.filter((transaction) => transaction.friendId === friendId)).map((transaction) => {
    balance += transactionImpact(transaction);
    return { transaction, balancePence: balance };
  });
}

export function parseMoneyToPence(value) {
  const input = String(value).trim().replace(/^£\s?/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  const pence = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(pence) ? pence : null;
}

export function formatMoney(pence) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

export function balanceText(friendName, balancePence) {
  if (balancePence === 0) return "You’re square";
  return balancePence > 0 ? `${friendName} owes you ${formatMoney(balancePence)}` : `You owe ${friendName} ${formatMoney(-balancePence)}`;
}
