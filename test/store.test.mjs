import test from "node:test";
import assert from "node:assert/strict";
import { emptyStore, parseStore } from "../api/_lib/store.js";
import { HttpError } from "../api/_lib/http-error.js";

const friend = {
  id: "ben",
  name: "Ben",
  email: "ben@example.com",
  createdAt: "2026-08-25T10:00:00.000Z",
};

const expense = {
  id: "tx-1",
  friendId: "ben",
  type: "expense",
  amountPence: 10000,
  paidBy: "me",
  description: "Dinner",
  date: "2026-08-25",
  createdAt: "2026-08-25T10:01:00.000Z",
  myShareAdjustmentPence: 0,
};

test("empty store is the current document shape", () => {
  assert.deepEqual(emptyStore(), { version: 1, friends: [], transactions: [] });
});

test("a valid store is normalised", () => {
  const parsed = parseStore({
    version: 1,
    friends: [{ ...friend, name: "  Ben  ", extra: "drop" }],
    transactions: [{ ...expense, description: " Dinner " }],
  });
  assert.equal(parsed.friends[0].name, "Ben");
  assert.equal(parsed.friends[0].email, "ben@example.com");
  assert.equal(parsed.transactions[0].description, "Dinner");
  assert.equal(parsed.transactions[0].myShareAdjustmentPence, 0);
  assert.equal("extra" in parsed.friends[0], false);
});

test("unsupported versions are rejected", () => {
  assert.throws(() => parseStore({ version: 2, friends: [], transactions: [] }), HttpError);
});

test("missing collections are rejected", () => {
  assert.throws(() => parseStore({ version: 1, friends: [] }), HttpError);
});

test("duplicate friend ids are rejected", () => {
  assert.throws(() => parseStore({ version: 1, friends: [friend, { ...friend, name: "Benny" }], transactions: [] }), HttpError);
});

test("orphan transactions are rejected", () => {
  assert.throws(() => parseStore({ version: 1, friends: [], transactions: [expense] }), HttpError);
});

test("invalid money and dates are rejected", () => {
  assert.throws(() => parseStore({ version: 1, friends: [friend], transactions: [{ ...expense, amountPence: 10.5 }] }), HttpError);
  assert.throws(() => parseStore({ version: 1, friends: [friend], transactions: [{ ...expense, date: "25/08/2026" }] }), HttpError);
});

test("expense adjustments must keep both shares at zero or more", () => {
  assert.throws(
    () => parseStore({ version: 1, friends: [friend], transactions: [{ ...expense, myShareAdjustmentPence: 10000 }] }),
    HttpError,
  );
  const parsed = parseStore({
    version: 1,
    friends: [friend],
    transactions: [{ ...expense, myShareAdjustmentPence: -200 }],
  });
  assert.equal(parsed.transactions[0].myShareAdjustmentPence, -200);
});

test("repayments do not keep a share adjustment", () => {
  const parsed = parseStore({
    version: 1,
    friends: [friend],
    transactions: [{ ...expense, id: "tx-2", type: "repayment", myShareAdjustmentPence: 50 }],
  });
  assert.equal("myShareAdjustmentPence" in parsed.transactions[0], false);
});
