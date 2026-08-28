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
  assert.match(app, /homeAccordion\("exceptions"/);
  assert.match(app, /homeAccordion\("weeklies"/);
  assert.match(app, /homeAccordion\("planned"/);
  assert.match(app, /data-home-section="\$\{esc\(id\)}"/);
  assert.match(app, /data-action="clear-pending"/);
  assert.match(app, /data-action="add-payslip"/);
  assert.match(app, /class="primary home-add-payslip"/);
  assert.match(app, /formatMoney\(flow\.savingsPence\)/);
  assert.match(app, /forecastAmount\(flow\)/);
  // The allowance is a row now, named for what it is rather than left as a bare
  // "Allowed" that said nothing about what it was allowed by, or by when.
  assert.doesNotMatch(app, /<span>Allowed<\/span>/);
  assert.match(app, /allowedLabel\(flow\)/);
  assert.match(app, /"Plan allows by today"/);
  assert.match(app, /data-statement-note/);
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

test("Home can be walked back to the lines that make each total", () => {
  assert.match(app, /homeAccordion\("breakdown", "How this adds up"/);
  assert.match(app, /function breakdownSection/);
  assert.match(app, /function breakdownHalf/);
  assert.match(app, /outBreakdownForMonth\(hh, viewMonth, now\)/);
  assert.match(app, /breakdownHalf\("Out of the bank"/);
  assert.match(app, /breakdownHalf\("On to the cards"/);
  // A weekly rule shows its working rather than four identical rows.
  assert.match(app, /item\.count \? `\$\{item\.count\} × \$\{formatMoney\(item\.eachPence\)\}`/);
  assert.match(css, /\.breakdown-half/);
});

test("Home shows the month as the household's own Main Table lays it out", () => {
  // A rearrangement of the same figures was harder to trust than the layout
  // they have been read in for years, so Home shows that layout.
  assert.match(app, /monthStatementRows\(household\(\), viewMonth, new Date\(\)\)/);
  assert.match(app, /function statementRow/);
  assert.match(app, /class="statement-table" data-statement-table/);
  // The sheet's three columns, and its two totals.
  assert.match(app, />In and out</);
  assert.match(app, />Allowed</);
  assert.match(app, />On cards</);
  assert.match(app, />Savings</);
  assert.match(app, />Total savings</);
  assert.match(app, /"Overspend" : .*"Underspend" : "On budget"/);
  // Exceptions are shown but stepped over by the savings total, as the sheet
  // does, and the row says so rather than leaving it to be worked out.
  assert.match(app, /row\.outsideSavings \? "<small>not in savings<\/small>" : ""/);
  // The statement holds no inputs, so it re-renders whole rather than being
  // patched cell by cell — no hook can go stale against the markup.
  const refresh = app.slice(app.indexOf("function refreshStatement"), app.indexOf("function cashflowScreen"));
  assert.match(refresh, /section\.outerHTML = statementSection\(flow\)/);
  for (const stale of ["data-statement-cash-out", "data-statement-committed", "data-statement-today-head"]) {
    assert.doesNotMatch(app, new RegExp(stale), `${stale} should be gone with the old layout`);
  }
  assert.match(css, /\.statement-line/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
});

test("Home leads with what the month ends up saving, not with a bare total", () => {
  assert.match(app, /data-statement-eyebrow/);
  assert.match(app, /data-statement-forecast/);
  assert.match(app, /data-statement-summary/);
  assert.match(app, /function positionSummary/);
  assert.match(app, /is on track to save/);
  assert.match(app, /is heading for a shortfall of/);
  // The summary has to name the three things the month is asking: where today
  // stands, what is left to spend, and where the month lands.
  const summary = app.slice(app.indexOf("function positionSummary"), app.indexOf("function statementNote"));
  assert.match(summary, /above what the plan allows by today/);
  assert.match(summary, /below what the plan allows by today/);
  assert.match(summary, /a day/);
  assert.match(summary, /has not started/);
  assert.match(summary, /finished .*over plan/);
  // "Keep the rest under £X" counted committed bills as spending room.
  assert.doesNotMatch(app, /Keep the rest under/);
});

test("typing a card balance or a pending amount repaints the statement without a refresh", () => {
  assert.match(app, /function refreshStatement\(\)/);
  const cardBalance = app.slice(app.indexOf("function updateCardBalance"), app.indexOf("function updateLiveSplit"));
  assert.match(cardBalance, /refreshStatement\(\);/);
  const pending = app.slice(app.indexOf("function updatePendingField"), app.indexOf("function updateCardBalance"));
  assert.match(pending, /refreshStatement\(\);/);
});

test("Home has an Exceptions section that can add, edit, and delete", () => {
  assert.match(app, /homeAccordion\("exceptions"/);
  assert.match(app, /data-action="add-exception"/);
  assert.match(app, /edit: "edit-exception"/);
  assert.match(app, /removeAction: "remove-exception"/);
  assert.match(app, /"exception-form": saveException/);
});

test("modal saves flip in memory and write in the background", () => {
  const update = app.slice(app.indexOf("async function withStoreUpdate"), app.indexOf("function applyLocal"));
  assert.doesNotMatch(update, /await persist\(\)/);
  assert.doesNotMatch(update, /await persistQueue\.flush\(\)/);
  assert.match(update, /persistQueue\.schedule\(\)/);
  assert.doesNotMatch(app, /let isSaving/);
});

test("the £100k helper takes grossed-up Gift Aid off, and never adds it on", () => {
  assert.match(app, /giftAidReliefPence/);
  assert.doesNotMatch(app, /giftAidAddBackPence/);
  assert.match(app, /Grossed-up Gift Aid taken off/);
});

test("each payslip category says what it does to net", () => {
  // "Benefit in kind" and "Cash allowance" are indistinguishable to anyone who
  // does not already know payroll terms, and the form showed a bare name.
  assert.match(app, /payslip-cat-name">\$\{esc\(category\.label\)\}<small>\$\{esc\(payslipKindLabel\(category\.kind\)\)\}<\/small>/);
  assert.match(app, /benefits: "Taxed; paid or not is read off your net"/);
  // The payslip's net settles the readings, so the picker is the fallback and
  // the form applies what it worked out rather than waiting to be tapped.
  assert.match(app, /if \(resolvedPayslipReading\(live\)\) return "";/);
  assert.match(app, /form\.elements\.benefitsPaid\.value = resolved\.benefitsPaid \? "on" : "";/);
  assert.match(app, /Read as: \$\{esc\(payslipReadingSummary\(resolved\)\)\}/);
  assert.match(css, /\.payslip-cat-name small/);
});

test("the payslip form says what Gross means and checks it against the slip", () => {
  assert.match(app, /Gross is the Payments total on the slip/);
  assert.match(app, /name="grossBeforeSacrifice"/);
  assert.match(app, /name="grossExcludesBonus"/);
  assert.match(app, /Which of these is the net on your payslip\?/);
  assert.match(app, /data-action="payslip-reading"/);
  assert.match(app, /moneyLabel\("Net on the payslip", "statedNet"/);
  assert.match(app, /data-payslip-net-block/);
  assert.match(app, /payslipNetHints\(live\)/);
});

test("the payslips list shows the live net, never a stale cached one", () => {
  assert.doesNotMatch(app, /formatMoney\(slip\.netPence\)/);
  // And read the way the payslip's own net says to read it, not from flags
  // that may have been saved before the net settled them.
  // Net is the figure the month is built on, so it takes the amount column and
  // gross moves into the detail line — it was the other way round.
  assert.match(app, /amount: formatMoney\(payslipNetAsReadPence\(slip\)\)/);
  assert.match(app, /gross \$\{formatMoney\(slip\.grossPence \|\| slip\.salaryPence\)\}/);
});

test("a month input is sized to a month, and an accordion looks like one", () => {
  assert.match(css, /input\[type="month"\]/);
  assert.match(rule('input[type="number"]'), /width:\s*auto/);
  const section = rule(".home-section");
  assert.match(section, /border:\s*1px solid var\(--line\)/);
  assert.match(section, /border-radius/);
});

test("pending takes a credit, and the monthly form drops the duplicate due rule", () => {
  assert.match(app, /requireSignedMoney\(data\.get\("amount"\), "amount"\)/);
  assert.match(app, /parseSignedMoney\(input\.value\)/);
  assert.match(app, /signedFieldValue/);
  assert.doesNotMatch(app, /First working day of the month<\/option>/);
  assert.doesNotMatch(app, /monthly-due-roll/);
});

test("the weeklies room is rules; ticking lives on Home only", () => {
  const room = app.slice(app.indexOf("function weekliesScreen"), app.indexOf("function monthliesScreen"));
  assert.doesNotMatch(room, /tickAction: "tick-weekly-slot"/);
  assert.match(room, /Tick on Home/);
  const home = app.slice(app.indexOf("function cashflowScreen"), app.indexOf("function homeCardRow"));
  assert.match(home, /tickAction: "tick-weekly-slot"/);
});

test("Planned shows what each month ahead is carrying", () => {
  assert.match(app, /function plannedByMonthTable/);
  assert.match(app, /Planned per month/);
  assert.match(app, /data-action="go-month"/);
  assert.match(css, /\.planned-month-bar/);
});
