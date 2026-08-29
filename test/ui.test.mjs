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

test("the per diem is one figure of its own, not a line in a list", () => {
  // It was a "cash in reserve" row among others, which made the month's
  // spending money look like config to be filed rather than a number to change.
  assert.match(app, /sectionHead\("Per diem", "edit-per-diem"/);
  assert.match(app, /if \(action === "edit-per-diem"\) openItem\("per-diem"\)/);
  assert.match(app, /"per-diem": perDiemForm/);
  assert.match(app, /"per-diem-form": savePerDiem/);
  assert.match(app, /household\(\)\.perDiem = \{ amountPence \}/);
  // And the list it used to live in is gone entirely, form and all.
  assert.doesNotMatch(app, /reserveForm|saveReserve|add-reserve|edit-reserve/);
  assert.doesNotMatch(app, /hh\.reserves/);
});

test("the bar carries the rooms the month runs through, and More carries the rest", () => {
  // Eleven items wrapped to three rows and took a third of a phone screen. Of
  // the five that replaced them, Weeklies and Monthlies are config that barely
  // changes once it is right — so the bar is Home, what is coming, who owes
  // what, and More.
  assert.match(app, /const DOCK = \[/);
  assert.match(app, /const MORE_ROOMS = \[/);
  const dock = app.slice(app.indexOf("const DOCK = ["), app.indexOf("function moneyControl("));
  assert.match(dock, /DOCK\.map/);
  assert.match(dock, /item\("more", "More", dockIsMore\(screen\.name\)\)/);
  const inBar = [...app.slice(app.indexOf("const DOCK = ["), app.indexOf("/** The rooms More lists")).matchAll(/\["([a-z]+)",/g)].map((m) => m[1]);
  assert.deepEqual(inBar, ["home", "planned", "tabs"]);
  const underMore = [...app.slice(app.indexOf("const MORE_ROOMS = ["), app.indexOf("function dockIsMore")).matchAll(/\["([a-z£0-9]+)",/g)].map((m) => m[1]);
  assert.deepEqual(underMore, ["weeklies", "monthlies", "annual", "pots", "payslips", "ani", "giving"]);
  // A friend's tab is a Tabs screen, so the bar says so rather than going blank.
  assert.match(dock, /name === "tabs" && screen\.name === "friend"/);
  // More lists them as rows, and a row navigates by its id.
  assert.match(app, /edit: "go-room"/);
  assert.match(app, /if \(action === "go-room" && MORE_ROOMS\.some/);
  assert.match(css, /grid-template-columns: repeat\(4, 1fr\)/);
  assert.match(rule(".app-shell"), /padding-bottom: calc\(96px/);
});

test("a room opens with one title and folds its documentation away", () => {
  // Every room led with an eyebrow, a title that mostly repeated it, and a
  // paragraph read once and then re-read on every visit for ever.
  assert.doesNotMatch(app, /eyebrow:/);
  const roomShell = app.slice(app.indexOf("function shell({"), app.indexOf("function monthSwitcher("));
  assert.doesNotMatch(roomShell, /class="eyebrow"/);
  assert.match(app, /function shell\(\{ title, lede, help = "", extra = "", body, month = false, back = "" \}\)/);
  assert.match(app, /<details class="room-help"><summary>How this works<\/summary>/);
  assert.match(css, /\.room-help > summary/);
  // And the title matches the room's own tab, so the header and the bar agree.
  for (const title of ['title: "Weeklies."', 'title: "Monthlies."', 'title: "Planned."', 'title: "Annual."', 'title: "Pots."', 'title: "Payslips."', 'title: "£100k."', 'title: "Giving."', 'title: "More."']) {
    assert.ok(app.includes(title), `${title} should name the room the way the bar does`);
  }
});

test("a weekly says which day of the month allows it", () => {
  assert.match(app, /function dueDaysLabel/);
  assert.match(app, /function ordinalDay/);
  assert.match(app, /\$\{weeklyCadenceLabel\(rule\)\} · \$\{dueDaysLabel\(rule\)\}/);
  assert.match(app, /Due the \$\{ordinalDay\(slot\.dueDay\)\}/);
  assert.match(app, /not yet allowed/);
});

test("a sheet opens with one title, and its rules fold away like a room's", () => {
  // Every modal led with an eyebrow saying what the title said underneath —
  // "NEW MONTHLY" over "Add a monthly" — and stacked its explanation above the
  // submit button, where it is re-read every time the sheet opens.
  assert.match(app, /function modalHead\(title\) \{/);
  assert.doesNotMatch(app, /modalHead\([^)]*,[^)]*\)/);
  assert.match(app, /function formHelp\(html\)/);
  assert.match(app, /details class="room-help form-help"/);
  assert.match(css, /\.form-help/);
  // The eyebrow survives only on the front door, where it is the product's name
  // rather than a repeat of the heading below it.
  assert.equal((app.match(/class="eyebrow"/g) || []).length, 1);
});

test("an optional field is one line, and an empty amount looks empty", () => {
  // label was a grid, so its inline "optional" marker became a row of its own:
  // every optional field stood 23px taller and the marker read as a field.
  assert.match(rule("label, fieldset"), /display:\s*block/);
  assert.doesNotMatch(rule("label, fieldset"), /display:\s*grid/);
  assert.match(css, /label > \.money-input,/);
  assert.match(css, /\.check-row > input \{ display: inline-block/);
  // Two controls lay themselves out and must not be given a box: a checkbox
  // sits beside its words, and a segmented control is a row of choices.
  assert.match(css, /fieldset > \.segmented \{ margin-top: 7px; \}/);
  assert.match(css, /\n\.segmented \{[^}]*grid-template-columns:\s*1fr 1fr/);
  // And a placeholder 0.00 was set in the same bold as a typed figure.
  assert.match(rule("input::placeholder"), /font-weight:\s*500/);
});

test("sync status sits in the top bar and only speaks when it has something to say", () => {
  // "Saved to a private gist" took a row of its own on every screen to report
  // that nothing had happened.
  assert.doesNotMatch(app, /class="sync-row"/);
  assert.doesNotMatch(css, /\.sync-row/);
  assert.match(app, /class="status-chip quiet" data-sync-chip/);
  assert.match(app, /class="topbar-end"/);
  assert.match(css, /\.topbar-end/);
  // The chip is still one element, so the in-place refresh still finds it.
  assert.match(app, /document\.querySelector\("\[data-sync-chip\]"\)/);
});

test("an empty household is asked for what a month needs, not shown a table of dashes", () => {
  assert.match(app, /if \(!householdHasData\(hh\)\) \{/);
  const start = app.slice(app.indexOf("if (!householdHasData(hh))"), app.indexOf('extra: statementSection(flow)'));
  assert.match(start, /sectionHead\("Start here"\)/);
  for (const action of ["add-payslip", "add-monthly", "edit-per-diem"]) {
    assert.match(start, new RegExp(`edit: "${action}"`), `${action} should be offered on a fresh household`);
  }
});

test("a friend's running balance is a total, not the row's own sentence again", () => {
  // "Ben owes you £42.00" sat beside "Ben owes £42.00" — the same fact twice.
  assert.match(app, /function runningBalanceLabel/);
  assert.match(app, /runs to \$\{formatMoney\(Math\.abs\(balancePence\)\)\}/);
  const row = app.slice(app.indexOf("function transactionRow"), app.indexOf("function renderModal"));
  assert.doesNotMatch(row, /balanceText\(friend\.name, balancePence\)/);
});

test("money can be drawn in from savings, and the exceptions come with it", () => {
  assert.match(app, /homeAccordion\("fromsavings"/);
  assert.match(app, /if \(action === "add-fromsavings"\) openItem\("fromsavings"\)/);
  assert.match(app, /fromsavings: fromSavingsForm/);
  assert.match(app, /"fromsavings-form": saveFromSavings/);
  assert.match(app, /list: "fromSavings"/);
  // Money moved in from savings is not money earned, so a total leaning on one
  // says so rather than reading as a month that simply went well.
  assert.match(app, /of the total came in from savings/);
  // It sits between the exceptions it carries and the money held back, which is
  // the order the statement puts them in.
  const home = app.slice(app.indexOf('homeAccordion("exceptions"'), app.indexOf('homeAccordion("weeklies"'));
  assert.ok(home.indexOf('homeAccordion("fromsavings"') < home.indexOf('homeAccordion("setasides"'));
});

test("a payslip opens on the month the money lands and can borrow last month's", () => {
  // The months come from the person's own last slip rather than a fixed rule,
  // and the lands month leads because that is the month you are adding it in.
  assert.match(app, /payslipMonthsForNewSlip\(household\(\), personId, viewMonth\)/);
  const form = app.slice(app.indexOf("function payslipForm()"), app.indexOf("function payslipNetBlock"));
  assert.ok(form.indexOf("Month the money lands") < form.indexOf("Pay period"), "the lands month leads");
  // One deliberate tap borrows last month's figures, and says so before it does.
  assert.match(form, /data-action="fill-payslip-from-last"/);
  assert.match(form, /Only empty boxes are filled/);
  // It is a button, so its handler has to be on click — on change it never ran.
  const clicks = app.slice(app.indexOf('document.addEventListener("click"'), app.indexOf('document.addEventListener("change"', app.indexOf('document.addEventListener("click"')));
  assert.match(clicks, /if \(action === "fill-payslip-from-last"\)/);
  assert.match(clicks, /payslipFillFromPrevious\(current, last, merged\)/);
  assert.match(clicks, /payslipWithFills\(current, fills\)/);
  // A slip with only a net says so where its gross would be, and one that says
  // nothing at all names what would fix it — £0 on Home reads exactly like a
  // slip that failed to save.
  assert.match(app, /net only, no detail yet/);
  assert.match(app, /nothing to work a net out from — add the net it prints/);
  assert.match(app, /payslipSaysNothing\(slip\)/);
  // And the working is not shown against a net there is nothing to check.
  assert.match(app, /if \(payslipIsNetOnly\(live\)\) \{/);
  assert.match(app, /Taken from the slip/);
  assert.match(app, /only a net typed, so/);
  // And the form snapshot keeps the typed net, or a re-render threw it away.
  const snapshot = app.slice(app.indexOf("function snapshotPayslipForm"), app.indexOf("function updatePerDiemRate"));
  assert.match(snapshot, /statedNetPence: readMoney\("statedNet"\)/);
});

test("a planned expense can be cash, and a card one can name its day", () => {
  const form = app.slice(app.indexOf("function oneOffForm()"), app.indexOf("function exceptionForm()"));
  assert.match(form, /data-action="oneoff-paid-from"/);
  assert.match(form, /Cash — straight out of the bank/);
  // A due day has nowhere to be used on a cash line, so it is not offered.
  assert.match(form, /data-oneoff-field="dueDay"/);
  assert.match(app, /\[data-oneoff-field=dueDay\]"\)\?\.classList\.toggle\("hidden", event\.target\.value !== "card"\)/);
  // Switching to cash drops any day, rather than leaving one nothing reads.
  assert.match(app, /dueDay: data\.get\("paidFrom"\) === "cash" \? undefined : oneOffDueDay\(data\.get\("dueDay"\)\)/);
  // Both lists say which side each one comes out of, and when.
  const row = app.slice(app.indexOf("function oneOffRow"), app.indexOf("function renderModal"));
  assert.match(row, /oneOffPaidFrom\(item\) === "cash" \? "Cash"/);
  assert.match(app, /oneOffDueLabel\(item\)\.replace\("Planned", "Card"\)/);
});

test("regularly cleared lists swipe left to delete; setup entities do not", () => {
  assert.match(app, /removeAction: "remove-oneoff"/);
  assert.match(app, /removeAction: "remove-monthly"/);
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
  assert.match(app, /`\$\{item\.count\} × \$\{formatMoney\(item\.eachPence\)\}`/);
  assert.match(app, /`\$\{formatMoney\(item\.dailyPence\)\} a day`/);
  assert.match(css, /\.breakdown-half/);
});

test("Home shows the month as the household's own Main Table lays it out", () => {
  // A rearrangement of the same figures was harder to trust than the layout
  // they have been read in for years, so Home shows that layout.
  assert.match(app, /monthStatementRows\(household\(\), viewMonth, new Date\(\)\)/);
  assert.match(app, /function statementRow/);
  assert.match(app, /class="statement-table" data-statement-table/);
  // Three columns, and the first of them adds up: every row is signed, the
  // over/underspend is a term in it rather than a note beside it, and the last
  // line is what the month ends up with.
  assert.match(app, />The month</);
  assert.match(app, />Allowed</);
  assert.match(app, />On cards</);
  assert.match(app, />The plan saves</);
  assert.match(app, />Ends up saving</);
  assert.match(app, /"Overspend" : .*"Underspend" : "On budget"/);
  const check = app.slice(app.indexOf("const check = table.cardCheckKnown"), app.indexOf("return `<section class=\"statement\""));
  assert.match(check, /statement-cell \$\{trackClass\(table\.overUnderPence\)\}">\$\{formatMoney\(table\.overUnderPence\)\}/);
  // Exceptions are shown but stepped over by the savings total, as the sheet
  // does, and the row says so rather than leaving it to be worked out.
  assert.match(app, /row\.note \? `<small>\$\{esc\(row\.note\)\}<\/small>` : ""/);
  // What the cards actually say is a different kind of fact from the rows
  // above, so it is captioned rather than mixed in with them.
  assert.match(app, /What the cards actually say/);
  assert.match(app, /table\.actualRows\.map\(statementRow\)/);
  assert.match(css, /\.statement-line\.caption/);
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
  // Where today stands is a chip, so it is the first thing seen rather than a
  // clause three sentences in — and "on track" is not claimed over a month
  // that is above what the plan allows, however healthy the saving looks.
  assert.match(app, /function positionChip/);
  assert.match(app, /over plan`, tone: "negative"/);
  assert.match(app, /under plan`, tone: "positive"/);
  assert.match(app, /if \(flow\.cardCheckKnown && flow\.overUnderPence < 0\) return `\$\{label\} is set to save`/);
  assert.match(app, /data-statement-chips/);
  assert.match(css, /\.statement-chips \.chip\.negative/);
  // The summary says what the chip cannot: what is left to come, and where the
  // month lands if it is held.
  const summary = app.slice(app.indexOf("function positionSummary"), app.indexOf("function nothingLeftToCome"));
  assert.match(summary, /has not started/);
  assert.match(summary, /lands on/);
  assert.match(summary, /stillToComeSentence\(flow\)/);
  // And it no longer repeats the same over/under figure the chip carries.
  assert.doesNotMatch(summary, /less than planned|more than planned/);
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
  assert.match(app, /moneyLabel\("Net pay", "statedNet"/);
  assert.match(app, /data-payslip-net-block/);
  assert.match(app, /payslipNetHints\(live\)/);
  // The net is the one figure a slip can carry on its own, so it is asked for
  // before the figures it would otherwise be worked out from.
  const form = app.slice(app.indexOf("function payslipForm()"), app.indexOf("function payslipNetBlock"));
  assert.ok(form.indexOf('"Net pay", "statedNet"') < form.indexOf('"Salary", "salary"'));
  assert.ok(form.indexOf('"Net pay", "statedNet"') < form.indexOf("payslip-cats"));
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
  assert.match(app, /Every month ahead/);
  assert.match(app, /data-action="go-month"/);
  assert.match(css, /\.planned-month-bar/);
  // The room listed December's items in "Other months" and totalled them again
  // in the table right above, so the same £600 appeared twice on one screen.
  const plannedRoom = app.match(/function plannedScreen\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(plannedRoom, /Other months/);
  assert.doesNotMatch(app, /oneOffsOutsideMonth\(hh, viewMonth\)\]/);
});
