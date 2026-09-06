import test from "node:test";
import assert from "node:assert/strict";
import { balanceFor, balanceText, parseMoneyToPence, resolveSplit, splitByPeople, splitExact, splitExpense, transactionImpact } from "../calculations.js";

const expense = (amountPence, paidBy, extra = {}) => ({ id: crypto.randomUUID(), friendId: "ben", type: "expense", amountPence, paidBy, date: "2026-08-25", createdAt: crypto.randomUUID(), ...extra });
const repayment = (amountPence, paidBy) => ({ id: crypto.randomUUID(), friendId: "ben", type: "repayment", amountPence, paidBy, date: "2026-08-25", createdAt: crypto.randomUUID() });

test("£100 paid by me means the friend owes £50", () => assert.equal(transactionImpact(expense(10000, "me")), 5000));
test("£100 paid by the friend means I owe £50", () => assert.equal(transactionImpact(expense(10000, "friend")), -5000));
test("multiple expenses produce the net balance", () => {
  assert.equal(balanceFor([expense(10000, "me"), expense(4000, "friend"), expense(6000, "me")], "ben"), 6000);
});
test("repayments reduce a balance", () => assert.equal(balanceFor([expense(12000, "me"), repayment(3000, "friend")], "ben"), 3000));
test("a repayment can take the balance through zero", () => assert.equal(balanceFor([expense(4000, "me"), repayment(3000, "friend")], "ben"), -1000));
test("exactly zero is square", () => assert.equal(balanceText("Ben", 0), "You’re square"));
test("£10.01 splits in integer pence without a floating point residue", () => {
  assert.deepEqual(splitExpense(parseMoneyToPence("10.01")), { mySharePence: 500, friendSharePence: 501 });
  assert.equal(transactionImpact(expense(1001, "me")), 501);
});
test("editing or deleting a transaction recalculates from source transactions", () => {
  const first = expense(10000, "me");
  const second = expense(4000, "friend");
  assert.equal(balanceFor([first, second], "ben"), 3000);
  assert.equal(balanceFor([{ ...first, amountPence: 6000 }, second], "ben"), 1000);
  assert.equal(balanceFor([{ ...first, amountPence: 6000 }], "ben"), 3000);
});

test("an exact split names a flat amount instead of nudging off half", () => {
  assert.deepEqual(splitExact(6000, 4000), { mySharePence: 4000, friendSharePence: 2000 });
  assert.throws(() => splitExact(6000, 7000), /between zero and the total/);
  assert.throws(() => splitExact(6000, -1), /between zero and the total/);
});

test("a flat amount transaction reads straight from mySharePence, not the total", () => {
  // "You owe me 40": the friend paid, and my share is a flat £40 regardless of the £60 total.
  const owed = expense(6000, "friend", { splitMode: "exact", mySharePence: 4000 });
  assert.equal(transactionImpact(owed), -4000);
});

test("a split by headcount divides proportionally and gives the remainder to the total", () => {
  assert.deepEqual(splitByPeople(6000, 3, 1), { mySharePence: 4500, friendSharePence: 1500 });
  assert.deepEqual(splitByPeople(1000, 1, 2), { mySharePence: 333, friendSharePence: 667 });
  assert.throws(() => splitByPeople(6000, 0, 0), /how many people/);
  assert.throws(() => splitByPeople(6000, 1.5, 1), /how many people/);
});

test("resolveSplit picks the right mode from the transaction", () => {
  assert.deepEqual(resolveSplit(expense(6000, "me")), { mySharePence: 3000, friendSharePence: 3000 });
  assert.deepEqual(resolveSplit(expense(6000, "me", { splitMode: "exact", mySharePence: 1000 })), { mySharePence: 1000, friendSharePence: 5000 });
  assert.deepEqual(resolveSplit(expense(6000, "me", { splitMode: "shares", myShareUnits: 3, friendShareUnits: 1 })), { mySharePence: 4500, friendSharePence: 1500 });
});
