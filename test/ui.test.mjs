import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(root, "../styles.css"), "utf8");
const app = readFileSync(join(root, "../app.js"), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  return match ? match[1] : "";
}

test("money input prefix is in-flow and never overlaid on the digits", () => {
  const box = rule(".money-input");
  const prefix = rule(".money-input .money-prefix");
  const input = rule(".money-input input");
  assert.match(box, /display:\s*flex/);
  assert.doesNotMatch(prefix, /position:\s*absolute/);
  assert.match(prefix, /flex:\s*none/);
  assert.match(input, /width:\s*auto/);
  assert.match(input, /border:\s*0/);
  assert.match(prefix, /padding:\s*0 6px 0 13px/);
  assert.match(app, /class="money-prefix"/);
  assert.doesNotMatch(app, /<div class="money-input"><span>£<\/span>/);
  assert.match(css, /\.home-add-card > input/);
  assert.match(css, /\.pending-row > input/);
  assert.match(css, /home-add-card \.money-input input/);
  assert.match(css, /pending-row \.money-input input/);
});

test("weekly rule form drops Once a month and requires typical amount", () => {
  assert.doesNotMatch(app, /<option value="once"/);
  assert.match(app, /moneyLabel\("Typical amount", "amount", item\.amountPence, \{ required: true \}\)/);
  assert.match(app, /Every week on a chosen weekday/);
  assert.doesNotMatch(app, /Every weekday</);
});

test("Home has income, pending clear-all, and planned accordion hooks", () => {
  assert.match(app, /homeAccordion\("income"/);
  assert.match(app, /homeAccordion\("cards"/);
  assert.match(app, /homeAccordion\("pending"/);
  assert.match(app, /homeAccordion\("weeklies"/);
  assert.match(app, /homeAccordion\("planned"/);
  assert.match(app, /data-home-section="\$\{esc\(id\)}"/);
  assert.match(app, /data-action="clear-pending"/);
  assert.match(app, /data-action="add-payslip"/);
  assert.match(app, /class="primary home-add-payslip"/);
});

test("Home Planned and the Planned room keep one add control", () => {
  assert.match(app, /emptyLines\(`Nothing planned for \$\{period\}\.`\)/);
  assert.match(app, /emptyLines\(`Nothing planned for \$\{monthLabel\(viewMonth\)\}\.`\)/);
  assert.match(app, /\$\{otherCount\} planned in other months/);
  assert.match(app, /data-action="go-planned"/);
  assert.match(app, /function plannedForViewedMonth/);
  const homePlanned = app.match(/homeAccordion\("planned",[\s\S]*?`\)}/)?.[0] || "";
  assert.match(homePlanned, /data-action="add-oneoff">Add</);
  assert.equal((homePlanned.match(/data-action="add-oneoff"/g) || []).length, 1);
  const plannedRoom = app.match(/function plannedScreen\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(plannedRoom, /sectionHead\(monthLabel\(viewMonth\), "add-oneoff", "Add"\)/);
  assert.doesNotMatch(plannedRoom, /emptyLines\([^)]*"add-oneoff"/);
});
