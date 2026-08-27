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

test("standing monthlies have no tick control", () => {
  const monthlies = app.match(/function monthliesScreen\(\) \{[\s\S]*?\nfunction plannedForViewedMonth/)?.[0] || "";
  assert.match(monthlies, /they are not ticked/);
  assert.doesNotMatch(monthlies, /tickAction/);
  assert.doesNotMatch(app, /tick-monthly|toggle-monthly|tick-bill|tick-card-sub/);
  assert.doesNotMatch(app, /data-action="tick-monthly"/);
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
  assert.match(app, /formatMoney\(flow\.savingsPence\)/);
  assert.match(app, /Left \/ savings/);
  assert.doesNotMatch(app, /Allowed/);
  assert.doesNotMatch(app, /flow\.leftPence/);
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
  assert.match(app, /if \(payload\.oneOffsRewritten\) persist\(\)/);
});

test("regularly cleared lists swipe left to delete; setup entities do not", () => {
  assert.match(app, /removeAction: "remove-oneoff"/);
  assert.match(app, /removeAction: "remove-monthly"/);
  assert.match(app, /removeAction: "remove-reserve"/);
  assert.match(app, /removeAction: "remove-weekly-extra"/);
  assert.match(app, /removeAction: "remove-weekly-rule"/);
  assert.match(app, /removeAction: "remove-annual"/);
  assert.match(app, /removeAction: "remove-donation"/);
  assert.match(app, /data-action="remove-pending-row"/);
  assert.match(app, /class="swipe-row" data-swipe/);
  assert.match(app, /class="swipe-delete"/);
  assert.doesNotMatch(app, /class="row-remove"/);
  assert.doesNotMatch(app, /Remove pending row">×/);
  assert.match(app, /action === "undo-delete"/);
  assert.match(app, /action === "remove-weekly-rule"/);
  assert.match(app, /action === "remove-weekly-extra"/);
  assert.match(app, /action === "remove-reserve"/);
  assert.match(app, /action === "remove-annual"/);
  assert.match(app, /action === "remove-donation"/);
  assert.match(app, /removeListedItem\("pendings"/);
  assert.match(app, /action\.startsWith\("remove-"\)/);
  assert.match(app, /addEventListener\("pointerdown"/);
  assert.match(app, /if \(event\.target\.closest\("\.swipe-delete"\)\) return;/);
  assert.match(app, /\.tick, \.swipe-delete/);
  assert.match(app, /data-action="clear-pending"/);
  assert.match(css, /\.swipe-delete/);
  assert.match(css, /background:\s*var\(--red\)/);
  assert.match(rule(".swipe-row"), /overflow:\s*hidden/);
  assert.match(rule(".swipe-row-front"), /touch-action:\s*pan-y/);
  assert.match(rule(".swipe-row.open .swipe-row-front"), /translateX\(-88px\)/);
  assert.match(css, /\.pending-head,\s*\.pending-row\s*\{[^}]*128px 1fr/);
  assert.doesNotMatch(css, /\.row-remove/);

  const homeCards = app.match(/function homeCardRow\([\s\S]*?\n\}/)?.[0] || "";
  const pots = app.match(/function potsScreen\(\) \{[\s\S]*?\nfunction pensionLabel/)?.[0] || "";
  const payslips = app.match(/function payslipsScreen\(\) \{[\s\S]*?\nfunction aniScreen/)?.[0] || "";
  const more = app.match(/function moreScreen\(\) \{[\s\S]*?\nfunction payslipKindLabel/)?.[0] || "";
  const tabs = app.match(/function tabsScreen\(\) \{[\s\S]*?\nfunction emptyHome/)?.[0] || "";
  const income = app.match(/homeAccordion\("income",[\s\S]*?`\)}/)?.[0] || "";
  assert.doesNotMatch(homeCards, /data-swipe|removeAction/);
  assert.doesNotMatch(pots, /removeAction/);
  assert.doesNotMatch(payslips, /removeAction/);
  assert.doesNotMatch(more, /removeAction/);
  assert.doesNotMatch(tabs, /data-swipe|removeAction/);
  assert.doesNotMatch(income, /removeAction/);
});
