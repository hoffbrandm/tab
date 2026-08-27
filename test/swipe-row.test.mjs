import test from "node:test";
import assert from "node:assert/strict";
import { SWIPE_DELETE_WIDTH, swipeAxis, swipeOffset, swipeShouldOpen } from "../swipe-row.js";

test("a left swipe reveals delete at half the action width", () => {
  assert.equal(SWIPE_DELETE_WIDTH, 88);
  assert.equal(swipeOffset(false, -20), -20);
  assert.equal(swipeOffset(false, -200), -88);
  assert.equal(swipeOffset(false, 30), 0);
  assert.equal(swipeShouldOpen(-20), false);
  assert.equal(swipeShouldOpen(-44), true);
  assert.equal(swipeShouldOpen(-88, 88), true);
  assert.equal(swipeOffset(true, 40), -48);
});

test("vertical movement does not start a swipe", () => {
  assert.equal(swipeAxis(2, 2), "");
  assert.equal(swipeAxis(-30, 4), "x");
  assert.equal(swipeAxis(4, -30), "y");
});
