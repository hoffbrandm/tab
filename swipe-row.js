/** iPhone-style swipe-left to reveal delete. Pointer events cover iPhone, iPad, and mouse. */

export const SWIPE_DELETE_WIDTH = 88;

export function swipeOffset(opened, dx, width = SWIPE_DELETE_WIDTH) {
  const base = opened ? -width : 0;
  return Math.min(0, Math.max(-width, base + dx));
}

export function swipeShouldOpen(offset, width = SWIPE_DELETE_WIDTH) {
  return offset <= -(width / 2);
}

export function swipeAxis(dx, dy, slop = 10) {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return "";
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}
