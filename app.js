import { balanceFor, balanceText, formatMoney, parseMoneyToPence, runningBalances, splitExpense } from "./calculations.js";
import { createGistStore, GistError } from "./gist-store.js";
import {
  addMonths,
  addPendingRow,
  aniFromHousehold,
  assertWeeklyRuleAmount,
  clearPendingsForMonth,
  ANI_LIMIT_PENCE,
  cardsForMonth,
  coerceMonthKey,
  cashflowForMonth,
  currentUkTaxYear,
  defaultCategoriesForNewPayslip,
  donationGrossPence,
  keepPayslipFormRows,
  emptyHousehold,
  exceptionsForMonth,
  exceptionsOutsideMonth,
  giftAidGrossPence,
  isCurrentMonth,
  jumpToCurrentMonthLabel,
  monthKey,
  monthLabel,
  monthlyDueLabel,
  monthliesOf,
  normalizeDueRoll,
  dueDayOf,
  normalizeWeeklyCadence,
  oneOffsForMonth,
  oneOffsOutsideMonth,
  plannedMonthTotals,
  payslipAmountForCategory,
  masterPayslipCategories,
  payslipIsConfirmed,
  payslipNetPence,
  payslipNetCheck,
  payslipNetHints,
  payslipGrossPaidPence,
  payslipDeductionsPence,
  payslipNetReadings,
  payslipRecordLabels,
  pendingListTotalPence,
  pendingsForMonth,
  potHistorySeries,
  potsNeedCurrentMonthLog,
  rememberPayslipCategories,
  unusedMasterPayslipCategories,
  upsertMonthSnapshot,
  PENSION_STATUSES,
  taxYearOptionsFor,
  toggleWeeklySlotTick,
  ukTaxYearFromDate,
  WEEKDAYS,
  WEEKLY_CADENCE_OPTIONS,
  weeklyCadenceLabel,
  weeklyRulesOf,
  weeklySlotsForMonth,
} from "./household.js";
import { readHomeSectionState, writeHomeSectionOpen } from "./home-sections.js";
import { createPersistQueue } from "./persist-queue.js";
import { createSession } from "./session.js";
import { emptyStore, parseStore } from "./store.js";
import { SWIPE_DELETE_WIDTH, swipeAxis, swipeOffset, swipeShouldOpen } from "./swipe-row.js";

const LOCAL_KEY = "tab.personal.v1";
const SCREENS = ["home", "weeklies", "monthlies", "planned", "annual", "pots", "payslips", "ani", "giving", "more", "tabs"];
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const sessionStore = createSession({ storage: window.sessionStorage });

let session = null;
let gist = null;
let store = emptyStore();
let gistId = null;
let screen = parseHash();
let modal = null;
let boot = { name: "loading" };
let sync = { name: "saved" };
let storeGeneration = 0;
let localImportOffered = false;
let localSession = false;
let viewMonth = monthKey();
let aniPersonId = null;
let aniTaxYear = null;
let payslipTaxYear = null;
let lastDeleted = null;
let swipeState = null;
let suppressClick = false;

const persistQueue = createPersistQueue({
  persist: () => persist(),
  debounceMs: 400,
});

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  const match = hash.match(/^friend\/([\w-]+)$/);
  if (match) return { name: "friend", friendId: match[1] };
  return SCREENS.includes(hash) ? { name: hash } : { name: "home" };
}

function hashFor(next) {
  return next.name === "friend" ? `#/friend/${next.friendId}` : `#/${next.name}`;
}

function setScreen(next, replace = false) {
  screen = next;
  const hash = hashFor(next);
  if (location.hash === hash) {
    render();
    return;
  }
  if (replace) history.replaceState(null, "", hash);
  else history.pushState(null, "", hash);
  render();
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function household() {
  if (!store.household) store.household = emptyHousehold();
  return store.household;
}

function personById(id) {
  return household().people.find((person) => person.id === id);
}

function byId(id) { return store.friends.find((friend) => friend.id === id); }

function esc(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function dateLabel(value) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function signedBalanceClass(pence) { return pence > 0 ? "positive" : pence < 0 ? "negative" : "neutral"; }

function moneyFieldValue(pence) {
  if (!pence) return "";
  return (pence / 100).toFixed(2).replace(/\.00$/, "");
}

function formatExtraPercent(result) {
  const ratio = Number(result?.extraSacrificeOfRemaining) || 0;
  if (ratio <= 0) return "";
  return ` (${(ratio * 100).toFixed(1)}% of remaining pay)`;
}

function parseMoneyAllowZero(value) {
  const input = String(value || "").trim();
  if (!input) return 0;
  return parseMoneyToPence(input);
}

function readLocalStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY));
    if (saved?.version === 1 && Array.isArray(saved.friends) && Array.isArray(saved.transactions)) return saved;
  } catch { /* Ignore a leftover browser copy. */ }
  return null;
}

function clearLocalStore() {
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* Private mode can refuse this. */ }
}

function openWithToken(token, login = "") {
  gist = createGistStore({ token });
  session = { login, token };
}

async function bootApp() {
  boot = { name: "loading" };
  render();
  const saved = sessionStore.read();
  if (!saved) {
    boot = { name: "signed-out" };
    render();
    return;
  }
  try {
    openWithToken(saved.token, saved.login);
    const identity = await gist.identify();
    session.login = identity.login;
    sessionStore.write({ token: saved.token, login: identity.login });
    const payload = await gist.read();
    store = payload.store;
    gistId = payload.gistId;
    boot = { name: "ready" };
    maybeOfferLocalImport();
    render();
    if (payload.oneOffsRewritten) persist().catch(() => {});
  } catch (error) {
    if (error instanceof GistError && error.status === 401) {
      sessionStore.clear();
      session = null;
      gist = null;
      boot = { name: "signed-out", reason: "token" };
      render();
      return;
    }
    boot = { name: "error", message: error.message };
    render();
  }
}

function maybeOfferLocalImport() {
  if (localImportOffered) return;
  const leftover = readLocalStore();
  if (!leftover || leftover.friends.length + leftover.transactions.length === 0) {
    if (leftover) clearLocalStore();
    return;
  }
  localImportOffered = true;
  if (store.friends.length || store.transactions.length) return;
  modal = { kind: "import-local", leftover };
}

async function persist() {
  sync = { name: "saving" };
  updateSyncChip();
  const generation = storeGeneration;
  try {
    const payload = await gist.write(store, gistId);
    gistId = payload.gistId;
    if (storeGeneration === generation) store = payload.store;
    sync = { name: "saved" };
    updateSyncChip();
  } catch (error) {
    sync = { name: "error", message: error.message };
    updateSyncChip();
    throw error;
  }
}

/**
 * Modal saves flip in memory, close, and write to the gist in the background —
 * the same path ticks and table edits already take. Holding the form open on a
 * round trip made every add and edit feel slow. A write that fails shows on the
 * sync chip with a retry, and the queue keeps the change until it lands.
 */
async function withStoreUpdate(mutator) {
  const previous = structuredClone(store);
  try {
    mutator();
  } catch {
    store = previous;
    return false;
  }
  storeGeneration += 1;
  persistQueue.schedule();
  return true;
}

function applyLocal(mutator, { render: shouldRender = true } = {}) {
  persistQueue.applyLocal(() => {
    mutator();
    storeGeneration += 1;
  }, { render: shouldRender ? render : undefined });
}

function render() {
  if (boot.name === "loading") app.innerHTML = `<section class="busy"><p>Opening your household…</p></section>`;
  else if (boot.name === "error") app.innerHTML = errorScreen(boot.message, "Try again", "reload");
  else if (boot.name === "signed-out") app.innerHTML = signInScreen();
  else app.innerHTML = readyScreen();
  renderModal();
}

function readyScreen() {
  if (screen.name === "friend") return friendScreen(byId(screen.friendId));
  if (screen.name === "weeklies") return weekliesScreen();
  if (screen.name === "monthlies") return monthliesScreen();
  if (screen.name === "planned") return plannedScreen();
  if (screen.name === "annual") return annualScreen();
  if (screen.name === "pots") return potsScreen();
  if (screen.name === "payslips") return payslipsScreen();
  if (screen.name === "ani") return aniScreen();
  if (screen.name === "giving") return givingScreen();
  if (screen.name === "more") return moreScreen();
  if (screen.name === "tabs") return tabsScreen();
  return cashflowScreen();
}

function updateSyncChip() {
  const chip = document.querySelector("[data-sync-chip]");
  if (chip) chip.outerHTML = syncChip();
}

function isLocalHost() {
  return location.hostname === "127.0.0.1" || location.hostname === "localhost";
}

function syncChip() {
  if (localSession) return `<span class="status-chip" data-sync-chip>This session only — not a gist</span>`;
  if (sync.name === "saving") return `<span class="status-chip saving" data-sync-chip>Saving…</span>`;
  if (sync.name === "error") {
    return `<button class="status-chip error" data-sync-chip data-action="retry-sync" type="button">${esc(sync.message || "Could not save")}</button>`;
  }
  return `<span class="status-chip" data-sync-chip>Saved to a private gist</span>`;
}

function errorScreen(message, actionLabel, action) {
  return `<section class="shell gate">
    <header class="topbar"><span class="wordmark">TAB</span></header>
    <div class="intro"><p class="eyebrow">Tab</p><h1>Couldn’t open the household.</h1><p class="lede">${esc(message)}</p></div>
    <button class="primary wide" data-action="${action}">${esc(actionLabel)}</button>
  </section>`;
}

function signInScreen() {
  const reason = boot.reason === "token"
    ? "That GitHub token was rejected. Create a new gist-only token and try again."
    : "";
  return `<section class="shell gate">
    <header class="topbar"><span class="wordmark">TAB</span></header>
    <div class="intro"><p class="eyebrow">Private household</p><h1>One workbook. A private gist.</h1>
      <p class="lede">Cashflow, pots, payslips, the £100k childcare helper, giving, and friend tabs. This site is only the app. After a reset, paste the same token and the same household comes back.</p>
    </div>
    <div class="gate-card">
      ${reason ? `<p class="form-error">${esc(reason)}</p>` : ""}
      <form id="login-form">
        <label class="visually-hidden" for="github-user">GitHub user</label>
        <input id="github-user" name="username" value="tab" autocomplete="username" class="visually-hidden" />
        <label>GitHub token
          <input type="password" name="token" required autocomplete="current-password" spellcheck="false" />
        </label>
        <p class="helper">Use a fine-grained token with <strong>Gists: Read and write</strong> only. A password manager can remember it on your phone.</p>
        <p class="form-error" id="form-error"></p>
        <button class="primary wide" type="submit">Sign in</button>
      </form>
      <a class="text-button token-link" href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">Create a token on GitHub</a>
      ${isLocalHost() ? `<button class="secondary wide" type="button" form="" data-action="local-workbook">Open a local workbook</button><p class="helper">This machine only. Nothing is written to a gist or to localStorage. Close the tab and it is gone.</p>` : ""}
    </div>
  </section>`;
}

function shell({ eyebrow, title, lede, extra = "", body, month = false, back = "" }) {
  return `<section class="shell app-shell">
    <header class="topbar">
      ${back ? `<button class="back" data-action="go" data-screen="${back}" aria-label="Back">‹</button>` : `<a class="wordmark" href="#/home" data-action="go" data-screen="home">TAB</a>`}
      ${back ? `<a class="wordmark" href="#/home" data-action="go" data-screen="home">TAB</a>` : `<span></span>`}
      <span></span>
    </header>
    <div class="sync-row">${syncChip()}</div>
    ${month ? monthSwitcher() : ""}
    ${title ? `<div class="intro compact">
      <p class="eyebrow">${esc(eyebrow)}</p>
      <h1>${esc(title)}</h1>
      ${lede ? `<p class="lede">${lede}</p>` : ""}
    </div>` : ""}
    ${extra}
    ${body}
    ${dock()}
  </section>`;
}

function monthSwitcher() {
  const now = new Date();
  const jump = jumpToCurrentMonthLabel(viewMonth, now);
  return `<div class="month-switch">
    <button type="button" class="month-nav" data-action="month-prev" aria-label="Previous month">‹</button>
    <div><strong>${esc(monthLabel(viewMonth))}</strong>${jump ? `<button type="button" class="text-button" data-action="month-now">${esc(jump)}</button>` : ""}</div>
    <button type="button" class="month-nav" data-action="month-next" aria-label="Next month">›</button>
  </div>`;
}

function dock() {
  const item = (name, label, active) =>
    `<a class="dock-item${active ? " active" : ""}" href="#/${name}" data-action="go" data-screen="${name}">${label}</a>`;
  return `<nav class="dock" aria-label="App">
    ${item("home", "Home", screen.name === "home")}
    ${item("weeklies", "Weeklies", screen.name === "weeklies")}
    ${item("monthlies", "Monthlies", screen.name === "monthlies")}
    ${item("planned", "Planned", screen.name === "planned")}
    ${item("annual", "Annual", screen.name === "annual")}
    ${item("pots", "Pots", screen.name === "pots")}
    ${item("payslips", "Payslips", screen.name === "payslips")}
    ${item("ani", "£100k", screen.name === "ani")}
    ${item("giving", "Giving", screen.name === "giving")}
    ${item("tabs", "Tabs", screen.name === "tabs" || screen.name === "friend")}
    ${item("more", "Account", screen.name === "more")}
  </nav>`;
}

function sectionHead(title, action, addLabel) {
  return `<div class="section-heading"><h2>${esc(title)}</h2>${action ? `<button class="text-button" type="button" data-action="${action}">${esc(addLabel)}</button>` : ""}</div>`;
}

function homeSectionState() {
  return readHomeSectionState(window.sessionStorage);
}

function homeAccordion(id, title, inner) {
  const open = homeSectionState()[id] === true;
  return `<details class="home-section" data-home-section="${esc(id)}" ${open ? "open" : ""}>
    <summary>${esc(title)}</summary>
    ${inner}
  </details>`;
}

function moneyControl({ id = "", name = "", pence = 0, value, extra = "", required = false, placeholder = "0.00" } = {}) {
  const shown = value != null ? value : moneyFieldValue(pence);
  return `<div class="money-input"><span class="money-prefix" aria-hidden="true">£</span><input${id ? ` id="${esc(id)}"` : ""}${name ? ` name="${esc(name)}"` : ""}${required ? " required" : ""} inputmode="decimal" value="${esc(shown)}" placeholder="${esc(placeholder)}" autocomplete="off"${extra ? ` ${extra}` : ""} /></div>`;
}

function lineRow({ edit, id, title, detail, amount, tickAction, ticked, tickLabel, tickId, removeAction, removeLabel = "Delete" }) {
  const inner = `${tickAction ? `<button class="tick${ticked ? " on" : ""}" type="button" data-action="${tickAction}" data-id="${esc(tickId || id)}" aria-pressed="${ticked ? "true" : "false"}" aria-label="${esc(tickLabel || (ticked ? "Done" : "Not done"))}"><span class="tick-box" aria-hidden="true">${ticked ? "✓" : ""}</span></button>` : ""}
    <button class="line-main" type="button" data-action="${edit}" data-id="${esc(id)}">
      <span class="line-copy"><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}</span>
      <span class="line-amount">${amount}</span>
    </button>`;
  if (!removeAction) return `<article class="line">${inner}</article>`;
  return `<div class="swipe-row" data-swipe>
    <div class="swipe-row-actions">
      <button class="swipe-delete" type="button" data-action="${removeAction}" data-id="${esc(id)}">${esc(removeLabel)}</button>
    </div>
    <article class="line swipe-row-front">${inner}</article>
  </div>`;
}

function emptyLines(text, action, label) {
  return `<div class="empty-lines"><p>${esc(text)}</p>${action ? `<button class="text-button" type="button" data-action="${action}">${esc(label)}</button>` : ""}</div>`;
}


function moneyClass(pence) {
  return pence < 0 ? "negative" : "neutral";
}

function overUnderLabel(flow) {
  if (!flow.cardCheckKnown) return "Under / overspend";
  if (flow.overUnderPence < 0) return "Overspend";
  if (flow.overUnderPence > 0) return "Underspend";
  return "On budget";
}

function overUnderAmount(flow) {
  if (!flow.cardCheckKnown) return "—";
  return formatMoney(Math.abs(flow.overUnderPence));
}

/**
 * The check is two numbers and people need to see both to trust it: what the
 * card is allowed to carry by today, against what it really carries.
 */
function statementNote(flow) {
  if (!flow.cardCheckKnown) {
    const names = flow.cardsMissingSnapshot.map((card) => card.name).join(", ");
    return `No balance for ${monthLabel(flow.month)} on ${names}. Total savings is In − Out until one is in.`;
  }
  const parts = [`Allowed so far ${formatMoney(flow.allowanceSoFarPence)}`];
  if (flow.reserveSpentPence) {
    parts.push(`incl. ${formatMoney(flow.reserveSpentPence)} of the ${formatMoney(flow.reserveTotalPence)} reserve, ${flow.dayOfMonth}/${flow.daysInMonth} of the way through`);
  }
  if (flow.exceptionsPence) parts.push(`incl. ${formatMoney(flow.exceptionsPence)} of exceptions`);
  return parts.join(" · ");
}

function statementSection(flow) {
  return `<section class="statement" aria-label="Month statement" data-statement>
        <div class="statement-row in">
          <span>In</span>
          <strong data-statement-in>${formatMoney(flow.incomePence)}</strong>
        </div>
        <div class="statement-row out">
          <span>Out</span>
          <strong data-statement-out>${formatMoney(flow.outPence)}</strong>
        </div>
        <div class="statement-split">
          <p><span>Cash out</span><strong data-statement-cash-out>${formatMoney(flow.cashOutPence)}</strong></p>
          <p><span>On to the card</span><strong data-statement-card-out>${formatMoney(flow.cardPlanPence)}</strong></p>
          <p><span>Card balance now</span><strong data-statement-card-balance>${formatMoney(flow.actualOnCardsPence)}</strong></p>
        </div>
        <div class="statement-row savings">
          <span>Savings</span>
          <strong class="${moneyClass(flow.savingsPence)}" data-statement-savings>${formatMoney(flow.savingsPence)}</strong>
        </div>
        <div class="statement-row check">
          <span data-statement-check-label>${overUnderLabel(flow)}</span>
          <strong class="${moneyClass(flow.overUnderPence)}" data-statement-check>${overUnderAmount(flow)}</strong>
        </div>
        <p class="statement-note" data-statement-note>${esc(statementNote(flow))}</p>
        <div class="statement-row left">
          <span>Total savings</span>
          <strong class="${moneyClass(flow.totalSavingsPence)}" data-statement-total>${formatMoney(flow.totalSavingsPence)}</strong>
        </div>
      </section>`;
}

/**
 * Card balances, pending rows, and exception amounts are typed into inputs that
 * stay on screen. A full render would take the caret with it, so the statement
 * is patched in place on every keystroke instead of waiting for a refresh.
 */
function refreshStatement() {
  const section = document.querySelector("[data-statement]");
  if (!section) return;
  const flow = cashflowForMonth(household(), viewMonth, new Date());
  const set = (selector, text, pence) => {
    const node = section.querySelector(selector);
    if (!node) return;
    node.textContent = text;
    if (pence != null) node.className = moneyClass(pence);
  };
  set("[data-statement-in]", formatMoney(flow.incomePence));
  set("[data-statement-out]", formatMoney(flow.outPence));
  set("[data-statement-cash-out]", formatMoney(flow.cashOutPence));
  set("[data-statement-card-out]", formatMoney(flow.cardPlanPence));
  set("[data-statement-card-balance]", formatMoney(flow.actualOnCardsPence));
  set("[data-statement-savings]", formatMoney(flow.savingsPence), flow.savingsPence);
  set("[data-statement-check-label]", overUnderLabel(flow));
  set("[data-statement-check]", overUnderAmount(flow), flow.overUnderPence);
  set("[data-statement-note]", statementNote(flow));
  set("[data-statement-total]", formatMoney(flow.totalSavingsPence), flow.totalSavingsPence);
}

function cashflowScreen() {
  const hh = household();
  const now = new Date();
  const flow = cashflowForMonth(hh, viewMonth, now);
  const period = monthLabel(viewMonth);
  const weeklySlots = flow.weeklySlots || weeklySlotsForMonth(hh, viewMonth);
  const cards = cardsForMonth(hh, viewMonth, now);
  const pendingRows = flow.pendingRows || pendingsForMonth(hh, viewMonth, now);
  const planned = plannedForViewedMonth(hh);
  const exceptions = exceptionsForMonth(hh, viewMonth);
  const otherExceptionCount = exceptionsOutsideMonth(hh, viewMonth).length;
  const otherPlannedCount = oneOffsOutsideMonth(hh, viewMonth).length;
  const incomeLines = flow.incomeLines || [];

  return shell({
    eyebrow: "",
    title: "",
    month: true,
    extra: statementSection(flow),
    body: `
      ${homeAccordion("income", "Income", `
        ${incomeLines.length ? incomeLines.map((line) => lineRow({
          edit: "edit-payslip",
          id: line.id,
          title: line.personName || "Payslip",
          detail: line.forecast ? "Forecast" : "Lands this month",
          amount: formatMoney(line.amountPence),
        })).join("") : `<p class="helper">Payslips that land in ${esc(period)} make In.</p>`}
        <button class="primary home-add-payslip" type="button" data-action="add-payslip">Add payslip</button>
      `)}
      ${homeAccordion("cards", "Cards", `
        ${cards.length ? cards.map(homeCardRow).join("") : `<p class="helper">Add each card and keep the balance here.</p>`}
        <form class="home-add-card" id="home-card-form">
          <label class="visually-hidden" for="home-card-name">Card name</label>
          <input id="home-card-name" name="home-card-name" maxlength="80" placeholder="Card name" autocomplete="off" />
          <label class="visually-hidden" for="home-card-balance">Balance</label>
          ${moneyControl({ id: "home-card-balance", name: "home-card-balance" })}
          <button class="text-button" type="submit">Add card</button>
        </form>
      `)}
      ${homeAccordion("pending", "Pending", `
        <p class="helper">Amounts from the statement. Total <strong data-pending-total>${formatMoney(pendingListTotalPence(pendingRows))}</strong>.${flow.cardPendingPence ? ` A further <strong>${formatMoney(flow.cardPendingPence)}</strong> is typed as pending on the cards themselves, and both count. Keep each amount in one place only.` : ""}</p>
        <div class="pending-table" role="table" aria-label="Pending amounts">
          <div class="pending-head" role="row">
            <span role="columnheader">Amount</span>
            <span role="columnheader">Note</span>
          </div>
          ${pendingRows.map(pendingTableRow).join("")}
        </div>
        <div class="home-section-actions">
          <button class="text-button" type="button" data-action="add-pending-row">Add a row</button>
          <button class="text-button" type="button" data-action="clear-pending">Clear all</button>
        </div>
      `)}
      ${homeAccordion("exceptions", `Exceptions · ${period}`, `
        <p class="helper">Spending that came from another pot. The card is allowed to be this much higher, and it does not change Savings.</p>
        ${exceptions.length ? exceptions.map((item) => lineRow({
          edit: "edit-exception",
          id: item.id,
          title: item.name,
          detail: `Not from the normal amount`,
          amount: formatMoney(item.amountPence),
          removeAction: "remove-exception",
          removeLabel: "Delete",
        })).join("") : `<p class="helper">Nothing set aside in ${esc(period)}.</p>`}
        ${otherExceptionCount ? `<p class="helper">${otherExceptionCount} exception${otherExceptionCount === 1 ? "" : "s"} in other months.</p>` : ""}
        <button class="text-button" type="button" data-action="add-exception">Add an exception</button>
      `)}
      ${homeAccordion("weeklies", "Weeklies", `
        ${weeklySlots.length ? weeklySlots.map((slot) => lineRow({
          edit: slot.adHoc ? "edit-weekly-extra" : "edit-weekly-rule",
          id: slot.adHoc ? slot.extraId : slot.ruleId,
          title: slot.name,
          detail: slot.adHoc ? `Extra in ${period}` : (slot.date ? dateLabel(slot.date) : weeklyCadenceLabel(weeklyRulesOf(hh).find((rule) => rule.id === slot.ruleId) || {})),
          amount: formatMoney(slot.amountPence),
          tickAction: "tick-weekly-slot",
          tickId: slot.id,
          ticked: slot.ticked,
          tickLabel: slot.ticked ? `Happened in ${period}` : `Not yet in ${period}`,
          ...(slot.adHoc ? { removeAction: "remove-weekly-extra", removeLabel: "Delete" } : {}),
        })).join("") : emptyLines(`Rules live under Weeklies. ${period} gets one slot per weekday in that month.`, "go-weeklies", "Open Weeklies")}
        <div class="home-section-actions">
          <button class="text-button" type="button" data-action="go-weeklies">Rules</button>
          <button class="text-button" type="button" data-action="add-weekly-extra">Add extra this month</button>
        </div>
      `)}
      ${homeAccordion("planned", `Planned · ${period}`, `
        ${planned.length ? planned.map((item) => lineRow({
          edit: "edit-oneoff",
          id: item.id,
          title: item.name,
          detail: item.purchased ? "Purchased" : "Planned",
          amount: formatMoney(item.estimatePence),
          tickAction: "toggle-oneoff",
          ticked: item.purchased,
          tickLabel: item.purchased ? "Purchased" : "Not purchased",
          removeAction: "remove-oneoff",
          removeLabel: "Delete",
        })).join("") : homePlannedEmpty(period, otherPlannedCount)}
        <button class="text-button" type="button" data-action="add-oneoff">Add</button>
      `)}
    `,
  });
}

function homeCardRow(item) {
  const period = monthLabel(viewMonth);
  return `<article class="card-balance-row">
    <button class="line-main" type="button" data-action="edit-card" data-id="${esc(item.id)}">
      <span class="line-copy"><strong>${esc(item.name)}</strong>
        <small>${item.missingSnapshot ? `No snapshot for ${period}` : `Balance · ${period}`}</small>
      </span>
    </button>
    <label class="visually-hidden" for="card-balance-${esc(item.id)}">Balance for ${esc(item.name)}</label>
    ${moneyControl({ id: `card-balance-${item.id}`, pence: item.balancePence, extra: `data-action="card-balance" data-id="${esc(item.id)}"` })}
  </article>`;
}

function pendingTableRow(item) {
  return `<div class="swipe-row" data-swipe>
    <div class="swipe-row-actions">
      <button class="swipe-delete" type="button" data-action="remove-pending-row" data-id="${esc(item.id)}">Delete</button>
    </div>
    <div class="pending-row swipe-row-front" role="row" data-pending-id="${esc(item.id)}">
      ${moneyControl({ pence: item.amountPence, value: signedFieldValue(item.amountPence), extra: `data-action="pending-amount" data-id="${esc(item.id)}"`, placeholder: "0.00 or -0.00" })}
      <input data-action="pending-note" data-id="${esc(item.id)}" maxlength="80" value="${esc(item.note || "")}" placeholder="Note" autocomplete="off" />
    </div>
  </div>`;
}

function sumTicked(slots) {
  return slots.filter((slot) => slot.ticked).reduce((total, slot) => total + slot.amountPence, 0);
}

function sumAll(slots) {
  return slots.reduce((total, slot) => total + slot.amountPence, 0);
}

function weekliesScreen() {
  const hh = household();
  const period = monthLabel(viewMonth);
  const slots = weeklySlotsForMonth(hh, viewMonth);
  return shell({
    eyebrow: "Weeklies",
    title: "Weekly rules.",
    lede: "The rules that make the slots. Enter a food shop once — every week on a chosen weekday, so four Tuesdays in the month on screen means four slots. The slots themselves are ticked on Home.",
    month: true,
    body: `
      <section class="block">
        ${sectionHead("Rules", "add-weekly-rule", "Add")}
        ${weeklyRulesOf(hh).length ? weeklyRulesOf(hh).map((rule) => lineRow({
          edit: "edit-weekly-rule",
          id: rule.id,
          title: rule.name,
          detail: weeklyCadenceLabel(rule),
          amount: formatMoney(rule.amountPence),
          removeAction: "remove-weekly-rule",
          removeLabel: "Delete",
        })).join("") : emptyLines("Food shop every week on Tuesday. Amazon every week on Friday. Cat litter once a month.", "add-weekly-rule", "Add a weekly rule")}
      </section>
      <section class="block">
        ${sectionHead(`${period}`, "go-home", "Tick on Home")}
        <p class="helper">${slots.length
          ? `${slots.filter((slot) => slot.ticked).length} of ${slots.length} slots ticked, ${formatMoney(sumTicked(slots))} of ${formatMoney(sumAll(slots))}. Ticking happens on Home, so it is in one place only.`
          : `No slots in ${esc(period)} yet. Add a rule above.`}</p>
      </section>
    `,
  });
}

function monthliesScreen() {
  const hh = household();
  const items = monthliesOf(hh);
  const reserves = hh.reserves || [];
  return shell({
    eyebrow: "Monthlies",
    title: "Standing outs.",
    lede: "Name, amount, and due day, on the calendar day or rolled to the next working day. These are config — they are not ticked. Cash lines, card lines, and reserve lines count in Out for the whole month on screen. Cash lines do not move the card allowance. Card lines do, on the due date, with no tick.",
    month: true,
    body: `
      <section class="block">
        ${sectionHead("Monthlies", "add-monthly", "Add")}
        ${items.length ? items.map((item) => lineRow({
          edit: "edit-monthly",
          id: item.id,
          title: item.name,
          detail: `${item.paidFrom === "cash" ? "Cash" : "Card"} · ${monthlyDueLabel(item, viewMonth)}`,
          amount: formatMoney(item.amountPence),
          removeAction: "remove-monthly",
          removeLabel: "Delete",
        })).join("") : emptyLines("Phone on the 21st. Mortgage on the 1st. Due date only — no ticks.", "add-monthly", "Add a monthly")}
      </section>
      <section class="block">
        ${sectionHead("Cash in reserve", "add-reserve", "Add")}
        <p class="helper">Daily envelope / monthly thousand — one standing line, not two features. Type the amount. Cleaner and nails can sit beside it.</p>
        ${reserves.length ? reserves.map((item) => lineRow({
          edit: "edit-reserve",
          id: item.id,
          title: item.name,
          detail: reserveLineDetail(item),
          amount: formatMoney(item.amountPence),
          removeAction: "remove-reserve",
          removeLabel: "Delete",
        })).join("") : emptyLines("Add the daily envelope here. The monthly amount lives in your household, not in this app.", "add-reserve", "Add the daily envelope")}
      </section>
    `,
  });
}

function plannedForViewedMonth(hh = household()) {
  return [...oneOffsForMonth(hh, viewMonth)].sort((a, b) => a.name.localeCompare(b.name));
}

function homePlannedEmpty(period, otherCount) {
  const empty = emptyLines(`Nothing planned for ${period}.`);
  if (!otherCount) return empty;
  return `${empty}<p class="helper"><button class="text-button" type="button" data-action="go-planned">${otherCount} planned in other months</button></p>`;
}

function plannedScreen() {
  const hh = household();
  const thisMonth = plannedForViewedMonth(hh);
  const later = [...oneOffsOutsideMonth(hh, viewMonth)]
    .sort((a, b) => String(a.month).localeCompare(String(b.month)) || a.name.localeCompare(b.name));
  return shell({
    eyebrow: "Planned",
    title: "Planned.",
    lede: `${monthLabel(viewMonth)} items show on Home.`,
    month: true,
    body: `
      <section class="block">
        ${sectionHead(monthLabel(viewMonth), "add-oneoff", "Add")}
        ${thisMonth.length ? thisMonth.map(oneOffRow).join("") : emptyLines(`Nothing planned for ${monthLabel(viewMonth)}.`)}
      </section>
      ${plannedByMonthTable(hh)}
      ${later.length ? `<section class="block">${sectionHead("Other months", "", "")}${later.map(oneOffRow).join("")}</section>` : ""}
    `,
  });
}

/**
 * What each month ahead is carrying, so a month quietly filling up with plans
 * is visible before it arrives rather than when it lands in Out.
 */
function plannedByMonthTable(hh) {
  const rows = plannedMonthTotals(hh, monthKey());
  if (!rows.length) return "";
  const most = Math.max(...rows.map((row) => row.totalPence));
  return `<section class="block">
    ${sectionHead("Planned per month", "", "")}
    <div class="planned-months">
      ${rows.map((row) => `<div class="planned-month${row.month === viewMonth ? " on" : ""}">
        <button class="planned-month-main" type="button" data-action="go-month" data-month="${esc(row.month)}">
          <span class="planned-month-name">${esc(monthLabel(row.month))}</span>
          <span class="planned-month-count">${row.count} item${row.count === 1 ? "" : "s"}</span>
        </button>
        <span class="planned-month-bar" aria-hidden="true"><i style="width:${most > 0 ? Math.round((row.totalPence / most) * 100) : 0}%"></i></span>
        <strong class="planned-month-total">${formatMoney(row.totalPence)}</strong>
      </div>`).join("")}
    </div>
    <p class="helper">This month and every month ahead that has something planned. Tap a month to open it.</p>
  </section>`;
}

function oneOffRow(item) {
  return lineRow({
    edit: "edit-oneoff",
    id: item.id,
    title: item.name,
    detail: `${monthLabel(item.month)}${item.purchased ? " · purchased" : ""}`,
    amount: formatMoney(item.estimatePence),
    tickAction: "toggle-oneoff",
    ticked: item.purchased,
    tickLabel: item.purchased ? "Purchased" : "Not purchased",
    removeAction: "remove-oneoff",
    removeLabel: "Delete",
  });
}

function annualScreen() {
  const items = household().annualBills;
  const reserve = items.length ? Math.round(items.reduce((sum, item) => sum + item.amountPence, 0) / 12) : 0;
  const monthName = (month) => new Intl.DateTimeFormat("en-GB", { month: "long" }).format(new Date(2026, month - 1, 1));
  return shell({
    eyebrow: "Annual",
    title: "Sinking fund.",
    lede: "Renewals and once-a-year bills. Cashflow sets aside the total divided by 12. Edit a line here and Home updates.",
    back: "",
    extra: items.length ? `<div class="dash single"><div class="stat"><span>Monthly reserve</span><strong>${formatMoney(reserve)}</strong></div></div>` : "",
    body: `
      <section class="block">
        ${sectionHead("Annual bills", "add-annual", "Add")}
        ${items.length ? items.map((item) => lineRow({
          edit: "edit-annual",
          id: item.id,
          title: item.name,
          detail: item.month ? `Usually ${monthName(item.month)}` : "Any month",
          amount: formatMoney(item.amountPence),
          removeAction: "remove-annual",
          removeLabel: "Delete",
        })).join("") : emptyLines("Insurance, MOT, memberships — add each line.", "add-annual", "Add an annual bill")}
      </section>
    `,
  });
}

function potsScreen() {
  const hh = household();
  const total = hh.pots.reduce((sum, pot) => sum + pot.amountPence, 0);
  const reminder = potsNeedCurrentMonthLog(hh.pots)
    ? `<p class="helper pot-reminder">Log this month’s figures when you have them.</p>`
    : "";
  return shell({
    eyebrow: "Where’s the money",
    title: "Pots.",
    lede: "Named pots and today’s figure. Pensions are names and status only — no policy or NI numbers.",
    back: "",
    extra: hh.pots.length ? `<div class="dash single"><div class="stat"><span>Pots total</span><strong>${formatMoney(total)}</strong></div></div>${potHistoryGraphic(hh.pots)}${reminder}` : "",
    body: `
      <section class="block">
        ${sectionHead("Pots", "add-pot", "Add")}
        ${hh.pots.length ? hh.pots.map((item) => lineRow({
          edit: "edit-pot",
          id: item.id,
          title: item.name,
          detail: item.updatedOn ? `Updated ${dateLabel(item.updatedOn)}` : "Update today’s figure",
          amount: formatMoney(item.amountPence),
        })).join("") : emptyLines("Emergency, bills, holiday — whatever you actually hold.", "add-pot", "Add a pot")}
      </section>
      <section class="block">
        ${sectionHead("Pensions", "add-pension", "Add")}
        ${hh.pensions.length ? hh.pensions.map((item) => lineRow({
          edit: "edit-pension",
          id: item.id,
          title: item.name,
          detail: `${pensionLabel(item.status)}${item.note ? ` · ${item.note}` : ""}`,
          amount: "",
        })).join("") : emptyLines("Optional. Name and status only.", "add-pension", "Add a pension name")}
      </section>
    `,
  });
}

function pensionLabel(status) {
  return { active: "Active", deferred: "Deferred", drawing: "Drawing", other: "Other" }[status] || status;
}

function potHistoryGraphic(pots) {
  const series = potHistorySeries(pots);
  const months = series[0]?.points.map((point) => point.month) || [];
  if (months.length < 2) {
    return `<p class="helper">A line appears here once a pot has more than one month logged.</p>`;
  }
  const values = series.flatMap((item) => item.points.map((point) => point.amountPence).filter((value) => value != null));
  const max = Math.max(1, ...values);
  const width = 320;
  const height = 120;
  const pad = { left: 8, right: 8, top: 10, bottom: 22 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const xFor = (index) => pad.left + (months.length === 1 ? innerW / 2 : (index / (months.length - 1)) * innerW);
  const yFor = (value) => pad.top + innerH - ((value || 0) / max) * innerH;
  const colors = ["#16715c", "#ad4e42", "#3d4f8c", "#8a5a1f", "#5b4b8a", "#2f6f7a"];
  const polylines = series.map((item, seriesIndex) => {
    const points = item.points
      .map((point, index) => `${xFor(index).toFixed(1)},${yFor(point.amountPence).toFixed(1)}`)
      .join(" ");
    return `<polyline fill="none" stroke="${colors[seriesIndex % colors.length]}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" points="${points}"></polyline>`;
  }).join("");
  const first = months[0];
  const last = months[months.length - 1];
  return `<figure class="pot-chart">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Pot values over time">${polylines}
      <text x="${pad.left}" y="${height - 6}" class="pot-chart-label">${esc(monthLabel(first))}</text>
      <text x="${width - pad.right}" y="${height - 6}" text-anchor="end" class="pot-chart-label">${esc(monthLabel(last))}</text>
    </svg>
    <figcaption class="helper">Increase and decrease across logged months.</figcaption>
  </figure>`;
}

function payslipsScreen() {
  const hh = household();
  const year = payslipTaxYear || currentUkTaxYear();
  const rows = hh.payslips
    .filter((slip) => slip.taxYear === year)
    .sort((a, b) => b.periodMonth.localeCompare(a.periodMonth) || a.personId.localeCompare(b.personId));
  return shell({
    eyebrow: "Pay",
    title: "Payslips.",
    lede: "Per person, per pay period. The month on the slip stays the month on the slip. Net pay that lands in a cashflow month is the income on Home.",
    back: "",
    extra: `<label class="inline-label">Tax year
      <select data-action="payslip-year">${taxYearOptionsFor(year).map((item) => `<option value="${item}" ${item === year ? "selected" : ""}>${item}</option>`).join("")}</select>
    </label>`,
    body: `
      <section class="block">
        ${sectionHead(year, "add-payslip", "Add")}
        ${rows.length ? rows.map((slip) => {
          const confirmed = payslipIsConfirmed(slip);
          const labels = payslipRecordLabels(slip);
          return lineRow({
            edit: "edit-payslip",
            id: slip.id,
            title: `${personById(slip.personId)?.name || "Person"} · ${labels.period}`,
            detail: `${confirmed ? "Confirmed" : "Forecast"} · ${labels.taxYear} · lands ${labels.lands} · net ${formatMoney(payslipNetPence(slip))}${payslipNetCheck(slip)?.matches === false ? " · does not match the slip" : ""}`,
            amount: formatMoney(slip.grossPence || slip.salaryPence),
          });
        }).join("") : emptyLines("Add a month when you have a slip — or a forecast row you do not treat as fact.", "add-payslip", "Add a payslip")}
      </section>
    `,
  });
}

function aniScreen() {
  const hh = household();
  const personId = aniPersonId || hh.people[0]?.id;
  const year = aniTaxYear || currentUkTaxYear();
  const result = aniFromHousehold(hh, {
    personId,
    taxYear: year,
    today: new Date(),
  });
  return shell({
    eyebrow: "Childcare cliff",
    title: "£100k ANI.",
    lede: "Stay at or under £100,000 adjusted net income. YTD and the projection come from payslips. Grossed-up Gift Aid from giving in this tax year comes off automatically.",
    back: "",
    extra: `
      <div class="ani-controls">
        <label>Person
          <select data-action="ani-person">${hh.people.map((item) => `<option value="${item.id}" ${item.id === personId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>
        </label>
        <label>Tax year
          <select data-action="ani-year">${taxYearOptionsFor(year).map((item) => `<option value="${item}" ${item === year ? "selected" : ""}>${item}</option>`).join("")}</select>
        </label>
      </div>
      <p class="helper">Giving and payslips feed this helper. There is nothing to re-type.</p>
    `,
    body: `
      <div class="dash">
        <div class="stat"><span>YTD</span><strong>${formatMoney(result.ytdPence)}</strong></div>
        <div class="stat"><span>Projected</span><strong class="${result.overLimit ? "negative" : "positive"}">${formatMoney(result.projectedPence)}</strong></div>
        <div class="stat"><span>Limit</span><strong>${formatMoney(ANI_LIMIT_PENCE)}</strong></div>
      </div>
      <section class="verdict ${result.overLimit ? "negative" : "positive"}">
        ${result.confirmedCount === 0
          ? "<p>Add a confirmed payslip to project the rest of the tax year.</p>"
          : result.overLimit
            ? `<p>Sacrifice another ${formatMoney(result.extraSacrificePence)} this tax year${formatExtraPercent(result)} to stay at £100k.${result.remainingMonths ? ` That’s ${formatMoney(result.extraPerRemainingMonthPence)} in each of the ${result.remainingMonths} remaining months.` : ""}</p>`
            : `<p>On this projection you’re ${formatMoney(result.underByPence)} under the £100k cliff.</p>`}
        <p class="helper">${result.confirmedCount} confirmed month${result.confirmedCount === 1 ? "" : "s"}, ${result.remainingMonths} remaining at ${formatMoney(result.lastMonthlyPence)} each. Forecast rows are not counted. Grossed-up Gift Aid taken off: ${formatMoney(result.giftAidReliefPence)}.</p>
      </section>
    `,
  });
}

function givingScreen() {
  const items = [...household().donations].sort((a, b) => b.date.localeCompare(a.date));
  const year = currentUkTaxYear();
  const thisYear = items.filter((item) => ukTaxYearFromDate(item.date) === year);
  const gross = thisYear.reduce((sum, item) => sum + donationGrossPence(item), 0);
  return shell({
    eyebrow: "Giving",
    title: "Charity.",
    lede: "Who, charity, date, amount, Gift Aid. Gross is 25% extra when Gift Aid is on. Tax year follows 6 April. Gift Aid in a tax year feeds the £100k helper.",
    back: "",
    extra: thisYear.length ? `<div class="dash single"><div class="stat"><span>Gross ${year}</span><strong>${formatMoney(gross)}</strong></div></div>` : "",
    body: `
      <section class="block">
        ${sectionHead("Donations", "add-donation", "Add")}
        ${items.length ? items.map((item) => lineRow({
          edit: "edit-donation",
          id: item.id,
          title: item.charity,
          detail: `${item.who} · ${dateLabel(item.date)} · ${ukTaxYearFromDate(item.date)}${item.giftAid ? " · Gift Aid" : ""}`,
          amount: formatMoney(item.giftAid ? giftAidGrossPence(item.amountPence, true) : item.amountPence),
          removeAction: "remove-donation",
          removeLabel: "Delete",
        })).join("") : emptyLines("Add a donation when you give.", "add-donation", "Add a donation")}
      </section>
    `,
  });
}

function moreScreen() {
  const categories = masterPayslipCategories(household());
  return shell({
    eyebrow: "Account",
    title: "Account.",
    lede: "Sign-in, gist, and payslip category names. Destinations stay in the bar.",
    body: `
      <section class="account-card">
        <div>
          <strong>${localSession ? "Local workbook" : `Signed in as ${esc(session.login)}`}</strong>
          <p class="helper account-copy">${localSession
            ? "This session only. Nothing is written to a gist."
            : `Private gist${gistId && gistId !== "local" ? ` · ${esc(gistId)}` : ""}. Household is not in this browser.`}</p>
        </div>
        <button class="secondary wide" data-action="sign-out">Sign out</button>
      </section>
      <section class="block">
        ${sectionHead("Payslip categories", "add-payslip-category-master", "Add")}
        <p class="helper">The slip’s column set. Pick these and type the amount. Net is gross through the usual deductions. Parental pay sits on the slip and stays outside that sum.</p>
        ${categories.length ? categories.map((item) => lineRow({
          edit: "edit-payslip-category",
          id: item.id,
          title: item.label,
          detail: payslipKindLabel(item.kind),
          amount: "",
        })).join("") : emptyLines("The usual slip columns live here. Add another if a new one appears.", "add-payslip-category-master", "Add a category")}
      </section>
      <section class="block">
        ${sectionHead("People", "add-person", "Add")}
        ${household().people.map((person) => lineRow({
          edit: "edit-person",
          id: person.id,
          title: person.name,
          detail: "Rename this person",
          amount: "",
        })).join("")}
      </section>
    `,
  });
}

function payslipKindLabel(kind) {
  return {
    bonus: "Extra",
    benefits: "Extra",
    extra: "Extra",
    sacrifice: "Deduction",
    tax: "Deduction",
    ni: "Deduction",
    deduction: "Deduction",
    parental: "On the slip · not in net",
  }[kind] || "Deduction";
}

function tabsScreen() {
  const friends = [...store.friends].sort((a, b) => a.name.localeCompare(b.name));
  return `<section class="shell app-shell">
    <header class="topbar"><a class="wordmark" href="#/home" data-action="go" data-screen="home">TAB</a><button class="text-button" data-action="add-friend">Add friend</button></header>
    <div class="sync-row">${syncChip()}</div>
    <div class="intro"><p class="eyebrow">Friend tabs</p><h1>Keep it simple.</h1><p>Shared costs, without the maths.</p></div>
    <div class="friend-list">${friends.length ? friends.map(friendCard).join("") : emptyHome()}</div>
    ${friends.length ? `<button class="primary floating" data-action="add-expense">Add expense</button>` : ""}
    ${dock()}
  </section>`;
}

function emptyHome() {
  return `<div class="empty-state"><div class="empty-mark">+</div><h2>Your first tab starts here.</h2><p>Add a friend to keep track of the little things you share.</p><button class="primary" data-action="add-friend">Add a friend</button></div>`;
}

function friendCard(friend) {
  const balance = balanceFor(store.transactions, friend.id);
  return `<button class="friend-card" data-action="open-friend" data-id="${friend.id}">
    <span class="avatar">${esc(friend.name.slice(0, 1).toUpperCase())}</span>
    <span class="friend-main"><strong>${esc(friend.name)}</strong><small class="${signedBalanceClass(balance)}">${esc(balanceText(friend.name, balance))}</small></span>
    <span class="chevron">›</span>
  </button>`;
}

function friendScreen(friend) {
  if (!friend) {
    queueMicrotask(() => setScreen({ name: "tabs" }, true));
    return tabsScreen();
  }
  const entries = runningBalances(store.transactions, friend.id);
  const balance = balanceFor(store.transactions, friend.id);
  return `<section class="shell app-shell detail">
    <header class="topbar">
      <button class="back" data-action="go" data-screen="tabs" aria-label="Back to your tabs">‹</button>
      <a class="wordmark" href="#/home" data-action="go" data-screen="home">TAB</a>
      <button class="text-button" data-action="edit-friend" data-id="${friend.id}">Edit</button>
    </header>
    <div class="sync-row">${syncChip()}</div>
    <section class="friend-hero">
      <p class="eyebrow">${friend.email ? esc(friend.email) : "Shared tab"}</p>
      <h1>${esc(friend.name)}</h1>
      <p class="balance-label">Current balance</p>
      <p class="balance-value ${signedBalanceClass(balance)}">${esc(balanceText(friend.name, balance))}</p>
    </section>
    <div class="quick-actions">
      <button class="secondary" data-action="add-expense" data-id="${friend.id}">Add expense</button>
      <button class="secondary" data-action="add-repayment" data-id="${friend.id}">Record transfer</button>
    </div>
    <section class="history">
      <div class="section-heading"><h2>History</h2><span>${entries.length} ${entries.length === 1 ? "entry" : "entries"}</span></div>
      ${entries.length ? entries.map((entry) => transactionRow(entry, friend)).join("") : `<div class="empty-history"><p>No expenses yet.</p><button class="text-button" data-action="add-expense" data-id="${friend.id}">Add the first one</button></div>`}
    </section>
    ${dock()}
  </section>`;
}

function transactionRow({ transaction, balancePence }, friend) {
  const isExpense = transaction.type === "expense";
  const headline = transaction.description || (isExpense ? "Expense" : "Transfer");
  let detail;
  if (isExpense) {
    const split = splitExpense(transaction.amountPence, transaction.myShareAdjustmentPence || 0);
    detail = transaction.paidBy === "me"
      ? `You paid ${formatMoney(transaction.amountPence)} · ${friend.name} owes ${formatMoney(split.friendSharePence)}`
      : `${friend.name} paid ${formatMoney(transaction.amountPence)} · You owe ${formatMoney(split.mySharePence)}`;
  } else {
    detail = transaction.paidBy === "me"
      ? `You paid ${friend.name} ${formatMoney(transaction.amountPence)}`
      : `${friend.name} paid you ${formatMoney(transaction.amountPence)}`;
  }
  return `<article class="transaction"><button class="transaction-button" data-action="edit-transaction" data-id="${transaction.id}">
    <div><p class="transaction-title">${esc(headline)}</p><p class="transaction-detail">${esc(detail)}</p><p class="transaction-date">${dateLabel(transaction.date)}</p></div>
    <div class="transaction-side"><strong>${formatMoney(transaction.amountPence)}</strong><small class="${signedBalanceClass(balancePence)}">${esc(balanceText(friend.name, balancePence))}</small></div>
  </button></article>`;
}

function renderModal() {
  document.querySelector(".modal-layer")?.remove();
  if (!modal) return;
  const layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.innerHTML = `<div class="scrim" data-action="close-modal"></div><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${modalMarkup()}</section>`;
  document.body.append(layer);
  const focus = layer.querySelector("input:not(.visually-hidden):not([type=hidden]):not([type=checkbox]):not([type=radio]), select, button");
  requestAnimationFrame(() => focus?.focus());
}

function modalMarkup() {
  const kinds = {
    friend: friendForm,
    transaction: transactionForm,
    delete: deleteForm,
    "import-local": importForm,
    person: personForm,
    bill: billForm,
    monthly: monthlyForm,
    envelope: envelopeForm,
    "weekly-rule": weeklyRuleForm,
    "weekly-extra": weeklyExtraForm,
    card: cardForm,
    sub: subForm,
    pending: pendingForm,
    reserve: reserveForm,
    "payslip-category": payslipCategoryForm,
    oneoff: oneOffForm,
    exception: exceptionForm,
    annual: annualForm,
    pot: potForm,
    pension: pensionForm,
    payslip: payslipForm,
    donation: donationForm,
  };
  return kinds[modal.kind] ? kinds[modal.kind]() : "";
}

function modalHead(eyebrow, title) {
  return `<div class="modal-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h2 id="modal-title">${esc(title)}</h2></div><button type="button" class="close" data-action="close-modal" aria-label="Close">×</button></div>`;
}

function moneyLabel(label, name, pence, { required = false, placeholder = "0.00" } = {}) {
  return `<label>${esc(label)}${required ? "" : ' <span class="optional">optional</span>'}${moneyControl({ name, pence, required, placeholder })}</label>`;
}

function friendForm() {
  const friend = modal.friend || {};
  return `<form id="friend-form">${modalHead(friend.id ? "Friend details" : "New friend", friend.id ? "Edit friend" : "Add a friend")}
    <label>Name<input required maxlength="60" name="name" value="${esc(friend.name)}" placeholder="e.g. Ben" autocomplete="name" /></label>
    <label>Email <span class="optional">optional</span><input type="email" maxlength="120" name="email" value="${esc(friend.email)}" placeholder="ben@example.com" autocomplete="email" /></label>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${friend.id ? "Save changes" : "Add friend"}</button>
    ${friend.id ? '<button class="danger-link" type="button" data-action="confirm-delete-friend">Delete friend and history</button>' : ""}
  </form>`;
}

function transactionForm() {
  const transaction = modal.transaction || {};
  const friendId = transaction.friendId || modal.friendId || store.friends[0]?.id;
  const isExpense = (transaction.type || modal.type) === "expense";
  const friend = byId(friendId);
  const amount = transaction.amountPence ? (transaction.amountPence / 100).toFixed(2).replace(/\.00$/, "") : "";
  const adjustment = transaction.myShareAdjustmentPence ? (transaction.myShareAdjustmentPence / 100).toFixed(2).replace(/\.00$/, "") : "";
  return `<form id="transaction-form">${modalHead(transaction.id ? "Edit entry" : isExpense ? "New expense" : "Direct transfer", isExpense ? "Add expense" : "Record transfer")}
    <label>With<select name="friendId" required ${modal.friendId ? "disabled" : ""}>${store.friends.map((item) => `<option value="${item.id}" ${item.id === friendId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
    <label>Amount${moneyControl({ name: "amount", value: amount, required: true })}</label>
    <fieldset><legend>Who paid?</legend><div class="segmented">
      <label><input type="radio" name="paidBy" value="me" ${(!transaction.paidBy || transaction.paidBy === "me") ? "checked" : ""}/><span>I paid</span></label>
      <label><input type="radio" name="paidBy" value="friend" ${transaction.paidBy === "friend" ? "checked" : ""}/><span>${esc(friend?.name || "Friend")} paid</span></label>
    </div></fieldset>
    ${isExpense ? `<details class="adjustment" ${adjustment ? "open" : ""}><summary>Adjust my share <span>optional</span></summary><p>Keep it at zero for the usual 50/50 split. Use a positive number to add to your share, or a minus number to take it off.</p><label>Change to my share${moneyControl({ name: "adjustment", value: adjustment, placeholder: "0" })}</label></details>` : ""}
    <label>${isExpense ? "What was it for" : "Note"} <span class="optional">optional</span><input maxlength="100" name="description" value="${esc(transaction.description)}" placeholder="${isExpense ? "Dinner" : "Transfer"}" /></label>
    <label>Date<input required type="date" name="date" value="${transaction.date || today()}" /></label>
    <div class="live-split" id="live-split"></div>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${transaction.id ? "Save changes" : isExpense ? "Add expense" : "Record transfer"}</button>
    ${transaction.id ? '<button class="danger-link" type="button" data-action="confirm-delete-transaction">Delete entry</button>' : ""}
  </form>`;
}

function deleteForm() {
  const clearingPending = modal.target === "pending-all";
  return `<div class="delete-confirm">${modalHead("Please check", `${clearingPending ? "Clear" : "Delete"} ${modal.label || (modal.target === "friend" ? "friend and history" : "this entry")}?`)}
    <p>${esc(modal.copy || (modal.target === "friend" ? "This will permanently remove this friend and every transaction in their tab." : "This cannot be undone."))}</p>
    <div class="confirm-actions"><button class="secondary" data-action="close-modal">Keep it</button><button class="danger" data-action="delete-confirmed">${clearingPending ? "Clear" : "Delete"}</button></div></div>`;
}

function importForm() {
  return `<div class="delete-confirm">${modalHead("This browser", "Import the old local tab?")}
    <p>This browser still has friends and expenses from before Tab saved to a private gist. Import them once, then they leave this device.</p>
    <div class="confirm-actions">
      <button class="secondary" data-action="discard-local">Leave them</button>
      <button class="primary" data-action="import-local">Import</button>
    </div></div>`;
}

function personForm() {
  const person = modal.person || {};
  return `<form id="person-form">${modalHead(person.id ? "Household" : "New person", person.id ? "Edit name" : "Add a person")}
    <label>Name<input required maxlength="80" name="name" value="${esc(person.name)}" placeholder="e.g. Alex" /></label>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${person.id ? "Save name" : "Add person"}</button>
    ${person.id ? '<button class="danger-link" type="button" data-action="confirm-delete-person">Remove person</button>' : ""}
  </form>`;
}

function billForm() {
  return monthlyForm();
}

function monthlyForm() {
  const item = modal.item || {};
  const dueRoll = normalizeDueRoll(item.dueRoll);
  return `<form id="monthly-form">${modalHead(item.id ? "Monthly" : "New monthly", item.id ? "Edit monthly" : "Add a monthly")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Phone, mortgage…" /></label>
    ${moneyLabel("Expected amount", "amount", item.amountPence)}
    <label>Due<select name="dueRoll">
      <option value="calendar" ${dueRoll === "calendar" ? "selected" : ""}>On this calendar day</option>
      <option value="nextWorking" ${dueRoll === "nextWorking" ? "selected" : ""}>This day, or the next working day if it is a weekend</option>
    </select></label>
    <label data-due-day>Day of month<input type="number" name="dueDay" min="1" max="31" value="${dueDayOf(item) || 1}" /></label>
    <p class="helper">For the first working day of the month, pick day 1 with the next-working-day rule — that is the same thing.</p>
    <label>Paid from<select name="paidFrom">
      <option value="card" ${item.paidFrom !== "cash" ? "selected" : ""}>Card — due date only, not ticked</option>
      <option value="cash" ${item.paidFrom === "cash" ? "selected" : ""}>Cash — standing out for the whole month</option>
    </select></label>
    <p class="helper">UK weekdays are Monday to Friday. Cash and card lines count in Out for the whole viewed month. There is nothing to tick.</p>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save monthly" : "Add monthly"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-monthly">Delete monthly</button>' : ""}
  </form>`;
}

function envelopeForm() {
  return weeklyRuleForm();
}

function weeklyRuleForm() {
  const item = modal.item || {};
  const cadence = normalizeWeeklyCadence(item);
  return `<form id="weekly-rule-form">${modalHead(item.id ? "Weekly rule" : "New weekly rule", item.id ? "Edit rule" : "Add a rule")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Food shop, Amazon, cat litter…" /></label>
    ${moneyLabel("Typical amount", "amount", item.amountPence, { required: true })}
    <label>Cadence<select name="cadence" data-action="weekly-cadence">
      ${WEEKLY_CADENCE_OPTIONS.map((option) => `<option value="${option.value}" ${cadence.cadence === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
    </select></label>
    <label data-weekly-field="weekday" class="${cadence.cadence === "weekday" ? "" : "hidden"}">Weekday<select name="weekday">${WEEKDAYS.map((day) => `<option value="${day.value}" ${Number(item.weekday || 2) === day.value ? "selected" : ""}>${day.label}</option>`).join("")}</select></label>
    <label data-weekly-field="times" class="${cadence.cadence === "times" ? "" : "hidden"}">Times a month<input type="number" name="timesPerMonth" min="1" max="12" value="${cadence.timesPerMonth || 1}" /></label>
    <p class="helper">N times a month with N=1 is once a month. Every week on a chosen weekday makes one slot for each of that day in the month on screen. Ticks stay on that month. A new month starts unticked.</p>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save rule" : "Add rule"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-weekly-rule">Delete rule</button>' : ""}
  </form>`;
}

function weeklyExtraForm() {
  const item = modal.item || {};
  return `<form id="weekly-extra-form">${modalHead(item.id ? "Extra weekly" : "Extra this month", item.id ? "Edit extra" : "Add an extra")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Extra food shop…" /></label>
    ${moneyLabel("Amount", "amount", item.amountPence)}
    <p class="helper">This is only for ${monthLabel(item.month || viewMonth)}. It does not change the rule.</p>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save extra" : "Add extra"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-weekly-extra">Delete extra</button>' : ""}
  </form>`;
}

function cardForm() {
  const item = modal.item || {};
  return `<form id="card-form">${modalHead(item.id ? "Card" : "New card", item.id ? "Update card" : "Add a card")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name || "Card one")}" placeholder="Card one" /></label>
    ${moneyLabel("Balance", "amount", item.balancePence)}
    ${moneyLabel("Pending", "pending", item.pendingPence)}
    <p class="helper">Saves the card picture for ${monthLabel(viewMonth)}.</p>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Update figure" : "Add card"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-card">Delete card</button>' : ""}
  </form>`;
}

function subForm() {
  const item = modal.item || {};
  return `<form id="sub-form">${modalHead(item.id ? "Card subscription" : "New subscription", item.id ? "Edit subscription" : "Add a subscription")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Phone, streaming…" /></label>
    ${moneyLabel("Amount", "amount", item.amountPence)}
    <label>Due day<input required type="number" name="dueDay" min="1" max="31" value="${item.dueDay || 1}" /></label>
    ${household().cards.length ? `<label>Card <span class="optional">optional</span><select name="cardId"><option value="">Any card</option>${household().cards.map((card) => `<option value="${card.id}" ${card.id === item.cardId ? "selected" : ""}>${esc(card.name)}</option>`).join("")}</select></label>` : ""}
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save subscription" : "Add subscription"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-sub">Delete subscription</button>' : ""}
  </form>`;
}

function pendingForm() {
  const item = modal.item || {};
  return `<form id="pending-form">${modalHead(item.id ? "Pending" : "New pending", item.id ? "Edit pending" : "Add pending")}
    <label>Amount${moneyControl({ name: "amount", value: signedFieldValue(item.amountPence), placeholder: "0.00 or -0.00" })}</label>
    <p class="helper">A refund or a credit on the statement goes in as a minus, so it comes off the card side.</p>
    <label>Note <span class="optional">optional</span><input maxlength="80" name="note" value="${esc(item.note || item.name || "")}" placeholder="Optional" /></label>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save pending" : "Add pending"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-pending">Delete pending</button>' : ""}
  </form>`;
}

function reserveLineDetail(item) {
  const name = String(item?.name || "").toLowerCase();
  if (/\ba day\b|daily|thousand|envelope|float/.test(name)) {
    return "Daily envelope / monthly thousand · no tick";
  }
  return "Standing monthly out · no tick";
}

function reserveForm() {
  const item = modal.item || {};
  const adding = !item.id;
  return `<form id="reserve-form">${modalHead(adding ? "Cash in reserve" : "Reserve", adding ? "Daily envelope / monthly thousand" : "Edit reserve")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="£30 a day" /></label>
    ${moneyLabel("Monthly amount", "amount", item.amountPence)}
    <p class="helper">This is the daily envelope and the monthly thousand — the same line. Type the amount; it is not stored in the app. Cleaner and nails are siblings. Insurance saving stays on Annual as year ÷ 12.</p>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save reserve" : "Add reserve"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-reserve">Delete reserve</button>' : ""}
  </form>`;
}

function payslipCategoryForm() {
  const item = modal.item || {};
  const kind = item.kind || "deduction";
  return `<form id="payslip-category-form">${modalHead(item.id ? "Category" : "New category", item.id ? "Edit category" : "Add a category")}
    <label>Name<input required maxlength="80" name="label" value="${esc(item.label)}" placeholder="Bonus, tax, gym…" /></label>
    <label>On the slip<select name="kind">
      <option value="extra" ${kind === "extra" || kind === "bonus" || kind === "benefits" ? "selected" : ""}>Extra — adds to net</option>
      <option value="deduction" ${kind === "deduction" || kind === "sacrifice" || kind === "tax" || kind === "ni" ? "selected" : ""}>Deduction — leaves net</option>
      <option value="parental" ${kind === "parental" ? "selected" : ""}>On the slip — not in net</option>
    </select></label>
    <p class="helper">Net is gross through jury-service-class deductions. Parental pay is on the slip and outside that sum.</p>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save category" : "Add category"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-payslip-category">Delete category</button>' : ""}
  </form>`;
}

function oneOffForm() {
  const item = modal.item || {};
  return `<form id="oneoff-form">${modalHead(item.id ? "One-off" : "New one-off", item.id ? "Edit one-off" : "Add a one-off")}
    <label>Item<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="MOT, sofa, flight…" /></label>
    <label>Month<input required type="month" name="month" value="${item.month || viewMonth}" /></label>
    ${moneyLabel("Estimate", "amount", item.estimatePence)}
    <label class="check-row"><input type="checkbox" name="purchased" ${item.purchased ? "checked" : ""} /><span>Purchased</span></label>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save one-off" : "Add one-off"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-oneoff">Delete one-off</button>' : ""}
  </form>`;
}

function exceptionForm() {
  const item = modal.item || {};
  return `<form id="exception-form">${modalHead(item.id ? "Exception" : "New exception", item.id ? "Edit exception" : "Add an exception")}
    <label>What<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Travel insurance, school trip…" /></label>
    <label>Month<input required type="month" name="month" value="${item.month || viewMonth}" /></label>
    ${moneyLabel("Amount", "amount", item.amountPence, { required: true })}
    <p class="helper">This came from another pot, so the card is allowed to be this much higher without it reading as overspend.</p>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save exception" : "Add exception"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-exception">Delete exception</button>' : ""}
  </form>`;
}

function annualForm() {
  const item = modal.item || {};
  return `<form id="annual-form">${modalHead(item.id ? "Annual bill" : "New annual bill", item.id ? "Edit annual bill" : "Add an annual bill")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Car insurance, MOT…" /></label>
    ${moneyLabel("Yearly amount", "amount", item.amountPence)}
    <label>Usual month <span class="optional">optional</span>
      <select name="month"><option value="">Any month</option>${Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        const label = new Intl.DateTimeFormat("en-GB", { month: "long" }).format(new Date(2026, index, 1));
        return `<option value="${month}" ${item.month === month ? "selected" : ""}>${label}</option>`;
      }).join("")}</select>
    </label>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save bill" : "Add bill"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-annual">Delete bill</button>' : ""}
  </form>`;
}

function potForm() {
  const item = modal.item || {};
  return `<form id="pot-form">${modalHead(item.id ? "Pot" : "New pot", item.id ? "Update pot" : "Add a pot")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Emergency, bills…" /></label>
    ${moneyLabel("Amount", "amount", item.amountPence)}
    <p class="helper">Saving sets the snapshot date to today.</p>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Update today’s figure" : "Add pot"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-pot">Delete pot</button>' : ""}
  </form>`;
}

function pensionForm() {
  const item = modal.item || {};
  return `<form id="pension-form">${modalHead(item.id ? "Pension" : "Pension name", item.id ? "Edit pension" : "Add a pension name")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Workplace pension" /></label>
    <label>Status<select name="status">${PENSION_STATUSES.map((status) => `<option value="${status}" ${status === (item.status || "active") ? "selected" : ""}>${pensionLabel(status)}</option>`).join("")}</select></label>
    <label>Note <span class="optional">optional</span><input maxlength="120" name="note" value="${esc(item.note)}" placeholder="Active membership, nothing else" /></label>
    <p class="helper">Names and status only. Do not store NI or policy numbers here.</p>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save" : "Add pension"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-pension">Delete pension</button>' : ""}
  </form>`;
}

function payslipForm() {
  const item = modal.payslip || {};
  const personId = item.personId || household().people[0]?.id;
  const categories = payslipFormCategories(item, personId);
  const available = unusedMasterPayslipCategories(categories, masterPayslipCategories(household()));
  const live = livePayslipFromForm(item, categories);
  return `<form id="payslip-form">${modalHead(item.id ? "Payslip" : "New payslip", item.id ? "Edit payslip" : "Add a payslip")}
    <label>Person<select name="personId" required data-action="payslip-person">${household().people.map((person) => `<option value="${person.id}" ${person.id === personId ? "selected" : ""}>${esc(person.name)}</option>`).join("")}</select></label>
    <label>Tax year<select name="taxYear">${taxYearOptionsFor(item.taxYear).map((year) => `<option value="${year}" ${year === (item.taxYear || currentUkTaxYear()) ? "selected" : ""}>${year}</option>`).join("")}</select></label>
    <label>Pay period<input required type="month" name="periodMonth" value="${item.periodMonth || viewMonth}" /></label>
    <label>Month the money lands<input required type="month" name="moneyLandsMonth" value="${item.moneyLandsMonth || item.periodMonth || viewMonth}" /></label>
    ${moneyLabel("Salary", "salary", item.salaryPence)}
    ${moneyLabel("Gross", "gross", item.grossPence)}
    <p class="helper">Gross is the Payments total on the slip — basic, bonus, and any parental pay — after any salary sacrifice has come off. Tax and NI go in Categories below. If your slip writes it another way, say so under Net.</p>
    <input type="hidden" name="grossBeforeSacrifice" value="${item.grossBeforeSacrifice ? "on" : ""}" />
    <input type="hidden" name="grossExcludesBonus" value="${item.grossExcludesBonus ? "on" : ""}" />
    <section class="payslip-cats">
      <h3>Categories</h3>
      <p class="helper">Pick a category and enter the amount. Names live in Account. Net is calculated.</p>
      ${categories.length ? categories.map((category) => payslipCategoryField(category, item)).join("") : `<p class="helper">No categories on this slip yet.</p>`}
      ${available.length ? `<label>Add a category
        <select data-action="add-payslip-category">
          <option value="">Choose…</option>
          ${available.map((category) => `<option value="${esc(category.id)}">${esc(category.label)}</option>`).join("")}
        </select>
      </label>` : `<p class="helper">Every category from Account is already on this slip.</p>`}
    </section>
    ${payslipNetBlock(live)}
    ${moneyLabel("Net on the payslip", "statedNet", item.statedNetPence)}
    <p class="helper">Optional. Type what the slip says and the figures above get checked against it.</p>
    <label>Tax code <span class="optional">optional</span><input maxlength="20" name="taxCode" value="${esc(item.taxCode || "")}" autocomplete="off" /></label>
    <label>Note <span class="optional">optional</span><input maxlength="200" name="note" value="${esc(item.note || "")}" /></label>
    <label class="check-row"><input type="checkbox" name="forecast" ${item.forecast ? "checked" : ""} /><span>This is a forecast — do not treat it as confirmed</span></label>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save payslip" : "Add payslip"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-payslip">Delete payslip</button>' : ""}
  </form>`;
}

/**
 * Net with its working shown, and — when the slip's own net is typed in — the
 * check against it. Seeing gross, deductions, and the gap is what makes a
 * mistyped figure obvious.
 */
function payslipNetBlock(live) {
  const check = payslipNetCheck(live);
  const hints = payslipNetHints(live);
  return `<div class="payslip-net" data-payslip-net-block>
    <p class="payslip-net-line"><span>Gross paid</span><strong>${formatMoney(payslipGrossPaidPence(live))}</strong></p>
    <p class="payslip-net-line"><span>Deductions</span><strong>−${formatMoney(payslipDeductionsPence(live))}</strong></p>
    <p class="payslip-net-line total"><span>Net</span><strong data-payslip-net>${formatMoney(payslipNetPence(live))}</strong></p>
    ${check
      ? (check.matches
        ? `<p class="payslip-net-check ok">Matches the net on the slip.</p>`
        : `<p class="payslip-net-check off">${esc(`${formatMoney(Math.abs(check.differencePence))} ${check.differencePence > 0 ? "more" : "less"} than the ${formatMoney(check.statedPence)} on the slip.`)}</p>
           ${hints.map((hint) => `<p class="payslip-net-hint">${esc(hint)}</p>`).join("")}`)
      : ""}
    ${payslipReadings(live)}
  </div>`;
}

/**
 * Which net these figures mean depends on how the slip writes Gross, and that
 * is a fact about the payslip. Show every reading with its number so the one
 * that matches the payslip can be picked by eye, with no convention to learn.
 */
function payslipReadings(live) {
  const readings = payslipNetReadings(live);
  if (readings.length < 2) return "";
  return `<div class="payslip-readings">
    <p class="payslip-readings-head">Which of these is the net on your payslip?</p>
    ${readings.map((reading) => `<button type="button" class="payslip-reading${reading.current ? " on" : ""}${reading.matchesStated ? " match" : ""}"
      data-action="payslip-reading" data-before-sacrifice="${reading.grossBeforeSacrifice ? "1" : "0"}" data-excludes-bonus="${reading.grossExcludesBonus ? "1" : "0"}">
      <span class="payslip-reading-net">${formatMoney(reading.netPence)}</span>
      <span class="payslip-reading-label">${esc(reading.label)}</span>
    </button>`).join("")}
    <p class="helper">Picking one just says how to read Gross. It never changes the figures you typed.</p>
  </div>`;
}

function payslipFormCategories(slip, personId) {
  if (modal.slipCategories) return keepPayslipFormRows(modal.slipCategories);
  if (slip?.id) {
    const master = masterPayslipCategories(household());
    const used = master.filter((category) => (payslipAmountForCategory(slip, category) || 0) > 0);
    modal.slipCategories = keepPayslipFormRows(used);
    return modal.slipCategories;
  }
  modal.slipCategories = keepPayslipFormRows(
    defaultCategoriesForNewPayslip(household(), personId || household().people[0]?.id),
  );
  return modal.slipCategories;
}

function payslipCategoryField(category, slip) {
  const amount = payslipAmountForCategory(slip, category);
  return `<div class="payslip-cat-row" data-payslip-category="${esc(category.id)}">
    <span class="payslip-cat-name">${esc(category.label)}</span>
    ${moneyControl({ pence: amount, extra: `data-cat-amount="${esc(category.id)}"` })}
    <button type="button" class="danger-link" data-action="remove-payslip-category" data-id="${esc(category.id)}">Remove</button>
  </div>`;
}

function livePayslipFromForm(slip, categories) {
  const form = document.querySelector("#payslip-form");
  const base = { ...(slip || {}) };
  if (!form) return applyPayslipCategoryAmounts(base, categories || []);
  const data = new FormData(form);
  const readMoney = (name) => {
    const value = parseMoneyAllowZero(data.get(name));
    return value == null ? 0 : value;
  };
  return applyPayslipCategoryAmounts({
    ...base,
    grossPence: readMoney("gross"),
    salaryPence: readMoney("salary"),
    statedNetPence: readMoney("statedNet"),
    grossBeforeSacrifice: data.get("grossBeforeSacrifice") === "on",
    grossExcludesBonus: data.get("grossExcludesBonus") === "on",
  }, modal.slipCategories || categories || [], form);
}

function applyPayslipCategoryAmounts(slip, categories, form = document.querySelector("#payslip-form")) {
  const next = {
    ...slip,
    bonusPence: 0,
    benefitsPence: 0,
    salarySacrificePensionPence: 0,
    reliefAtSourcePensionPence: 0,
    grossBeforeSacrifice: Boolean(slip?.grossBeforeSacrifice),
    grossExcludesBonus: Boolean(slip?.grossExcludesBonus),
    taxPence: 0,
    niPence: 0,
    otherDeductions: [],
  };
  for (const category of categories || []) {
    const raw = form?.querySelector(`[data-cat-amount="${category.id}"]`)?.value;
    const amount = raw == null ? payslipAmountForCategory(slip, category) : (parseMoneyAllowZero(raw) || 0);
    if (category.kind === "bonus") next.bonusPence = amount;
    else if (category.kind === "benefits") next.benefitsPence = amount;
    else if (category.kind === "sacrifice") next.salarySacrificePensionPence = amount;
    else if (category.kind === "pension") next.reliefAtSourcePensionPence = amount;
    else if (category.kind === "tax") next.taxPence = amount;
    else if (category.kind === "ni") next.niPence = amount;
    else {
      next.otherDeductions.push({
        id: category.id,
        label: category.label,
        amountPence: amount || 0,
        ...(category.kind === "extra" ? { extra: true } : {}),
        ...(category.kind === "parental" ? { inNet: false } : {}),
      });
    }
  }
  next.netPence = payslipNetPence(next);
  return next;
}

function donationForm() {
  const item = modal.item || {};
  return `<form id="donation-form">${modalHead(item.id ? "Donation" : "New donation", item.id ? "Edit donation" : "Add a donation")}
    <label>Who<input required maxlength="80" name="who" value="${esc(item.who || household().people[0]?.name || "")}" /></label>
    <label>Charity<input required maxlength="80" name="charity" value="${esc(item.charity)}" /></label>
    <label>Date<input required type="date" name="date" value="${item.date || today()}" /></label>
    ${moneyLabel("Amount", "amount", item.amountPence)}
    <label class="check-row"><input type="checkbox" name="giftAid" ${item.giftAid ? "checked" : ""} /><span>Gift Aid (25%)</span></label>
    <p class="helper">Tax year is taken from the date (6 April). Gross with Gift Aid is the amount plus 25%.</p>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save donation" : "Add donation"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-donation">Delete donation</button>' : ""}
  </form>`;
}

function showToast(message, { action, actionLabel } = {}) {
  toast.replaceChildren(document.createTextNode(message));
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-undo";
    button.dataset.action = action;
    button.textContent = actionLabel || "Undo";
    toast.append(" ", button);
  }
  toast.classList.toggle("has-action", Boolean(action));
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => {
    toast.classList.remove("show");
    toast.classList.remove("has-action");
  }, action ? 4200 : 2600);
}

function closeSwipeRows(except) {
  document.querySelectorAll(".swipe-row.open").forEach((row) => {
    if (row !== except) {
      row.classList.remove("open");
      const front = row.querySelector(".swipe-row-front");
      if (front) front.style.transform = "";
    }
  });
}

function finishSwipe(open) {
  if (!swipeState?.row) {
    swipeState = null;
    return;
  }
  const { row } = swipeState;
  const front = row.querySelector(".swipe-row-front");
  row.classList.toggle("open", open);
  if (front) front.style.transform = "";
  swipeState = null;
}

function removeListedItem(list, id, label) {
  const item = findIn(list, id);
  if (!item) return;
  lastDeleted = { list, item: structuredClone(item) };
  applyLocal(() => {
    household()[list] = (household()[list] || []).filter((row) => row.id !== id);
  });
  showToast(`Deleted ${label}`, { action: "undo-delete", actionLabel: "Undo" });
}

function showFormError(message) {
  const element = document.querySelector("#form-error");
  if (element) element.textContent = message;
}

function setBusy(form, busy) {
  const button = form?.querySelector("button[type=submit]");
  if (button) {
    button.disabled = busy;
    if (busy) button.dataset.label = button.dataset.label || button.textContent;
    button.textContent = busy ? "Saving…" : (button.dataset.label || button.textContent);
  }
}

function openTransaction(type, friendId, transaction) {
  if (!store.friends.length) return openFriendForm();
  modal = { kind: "transaction", type, friendId, transaction };
  renderModal();
  updateLiveSplit();
}

function openFriendForm(friend) { modal = { kind: "friend", friend }; renderModal(); }
function closeModal() { modal = null; render(); }

function findIn(list, id) {
  return (household()[list] || []).find((item) => item.id === id);
}

function openItem(kind, list, id) {
  modal = { kind, item: id ? findIn(list, id) : (kind === "weekly-extra" ? { month: viewMonth } : {}) };
  if (kind === "payslip") {
    const payslip = id ? findIn("payslips", id) : {};
    modal = { kind, payslip, slipCategories: undefined };
  }
  if (kind === "person") modal = { kind, person: id ? personById(id) : {} };
  if (kind === "payslip-category") {
    modal = {
      kind,
      item: id ? masterPayslipCategories(household()).find((item) => item.id === id) : {},
    };
  }
  renderModal();
}

function askDelete(target, id, label, copy) {
  modal = { kind: "delete", target, id, label, copy };
  renderModal();
}

function openLocalWorkbook() {
  localSession = true;
  session = { login: "local", token: "" };
  gist = {
    identify: async () => ({ login: "local" }),
    read: async () => ({ store: emptyStore(), gistId: "local" }),
    write: async (next) => ({ store: parseStore(next), gistId: "local" }),
  };
  store = emptyStore();
  gistId = "local";
  boot = { name: "ready" };
  sync = { name: "local" };
  history.replaceState(null, "", `${location.pathname}#/home`);
  render();
}

function signOut() {
  sessionStore.clear();
  session = null;
  gist = null;
  store = emptyStore();
  gistId = null;
  localSession = false;
  boot = { name: "signed-out" };
  modal = null;
  history.replaceState(null, "", `${location.pathname}#/home`);
  render();
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  const swipeRow = event.target.closest("[data-swipe]");
  if (!event.target.closest(".swipe-delete")) closeSwipeRows(swipeRow);
  if (!target) return;
  const { action, id, screen: nextScreen, extra } = target.dataset;
  if (swipeRow?.classList.contains("open")) {
    const keep = action.startsWith("remove-") || action === "toggle-oneoff" || action.startsWith("tick-");
    if (!keep) {
      event.preventDefault();
      closeSwipeRows();
      return;
    }
  }

  if (action === "go") {
    event.preventDefault();
    closeModal();
    if (nextScreen === "planned") setScreen({ name: "planned" });
    else setScreen({ name: nextScreen || "home" });
  }
  if (action === "go-home") setScreen({ name: "home" });
  if (action === "go-month") { viewMonth = event.target.closest("[data-month]").dataset.month; render(); }
  if (action === "go-planned") setScreen({ name: "planned" });
  if (action === "go-weeklies") setScreen({ name: "weeklies" });
  if (action === "go-monthlies") setScreen({ name: "monthlies" });
  if (action === "go-annual") setScreen({ name: "annual" });
  if (action === "home") { event.preventDefault(); setScreen({ name: "home" }); closeModal(); }
  if (action === "open-friend") setScreen({ name: "friend", friendId: id });
  if (action === "month-prev") { viewMonth = addMonths(viewMonth, -1); render(); }
  if (action === "month-next") { viewMonth = addMonths(viewMonth, 1); render(); }
  if (action === "month-now") { viewMonth = monthKey(); render(); }

  if (action === "add-friend") openFriendForm();
  if (action === "edit-friend") openFriendForm(byId(id));
  if (action === "add-expense") openTransaction("expense", id);
  if (action === "add-repayment") openTransaction("repayment", id);
  if (action === "edit-transaction") {
    const transaction = store.transactions.find((item) => item.id === id);
    if (transaction) openTransaction(transaction.type, transaction.friendId, transaction);
  }
  if (action === "add-person") openItem("person");
  if (action === "edit-person") openItem("person", "people", id);
  if (action === "add-bill") openItem("monthly");
  if (action === "edit-bill") openItem("monthly", "monthlies", id);
  if (action === "add-monthly") openItem("monthly");
  if (action === "edit-monthly") openItem("monthly", "monthlies", id);
  if (action === "add-envelope") openItem("weekly-rule");
  if (action === "edit-envelope") openItem("weekly-rule", "weeklyRules", id);
  if (action === "add-weekly-rule") openItem("weekly-rule");
  if (action === "edit-weekly-rule") openItem("weekly-rule", "weeklyRules", id);
  if (action === "add-weekly-extra") openItem("weekly-extra");
  if (action === "edit-weekly-extra") openItem("weekly-extra", "weeklyExtras", id);
  if (action === "add-card") openItem("card");
  if (action === "edit-card") openItem("card", "cards", id);
  if (action === "add-pending") openItem("pending");
  if (action === "edit-pending") openItem("pending", "pendings", id);
  if (action === "add-reserve") openItem("reserve");
  if (action === "edit-reserve") openItem("reserve", "reserves", id);
  if (action === "add-payslip-category-master") openItem("payslip-category");
  if (action === "edit-payslip-category") openItem("payslip-category", "payslipCategories", id);
  if (action === "add-sub") openItem("sub");
  if (action === "edit-sub") openItem("sub", "cardSubs", id);
  if (action === "add-oneoff") openItem("oneoff");
  if (action === "edit-oneoff") openItem("oneoff", "oneOffs", id);
  if (action === "payslip-reading") {
    event.preventDefault();
    const form = document.querySelector("#payslip-form");
    if (form) {
      form.elements.grossBeforeSacrifice.value = event.target.closest("[data-before-sacrifice]").dataset.beforeSacrifice === "1" ? "on" : "";
      form.elements.grossExcludesBonus.value = event.target.closest("[data-excludes-bonus]").dataset.excludesBonus === "1" ? "on" : "";
      updatePayslipNet();
    }
  }
  if (action === "add-exception") openItem("exception");
  if (action === "edit-exception") openItem("exception", "exceptions", id);
  if (action === "add-annual") openItem("annual");
  if (action === "edit-annual") openItem("annual", "annualBills", id);
  if (action === "add-pot") openItem("pot");
  if (action === "edit-pot") openItem("pot", "pots", id);
  if (action === "add-pension") openItem("pension");
  if (action === "edit-pension") openItem("pension", "pensions", id);
  if (action === "add-payslip") openItem("payslip");
  if (action === "edit-payslip") openItem("payslip", "payslips", id);
  if (action === "add-donation") openItem("donation");
  if (action === "edit-donation") openItem("donation", "donations", id);

  if (action === "toggle-oneoff") {
    event.preventDefault();
    applyLocal(() => {
      const item = findIn("oneOffs", id);
      if (item) item.purchased = !item.purchased;
    });
  }
  if (action === "remove-oneoff") {
    event.preventDefault();
    event.stopPropagation();
    removeListedItem("oneOffs", id, "one-off");
  }
  if (action === "remove-exception") {
    event.preventDefault();
    event.stopPropagation();
    removeListedItem("exceptions", id, "exception");
  }
  if (action === "remove-monthly") {
    event.preventDefault();
    event.stopPropagation();
    removeListedItem("monthlies", id, "monthly");
  }
  if (action === "remove-weekly-rule") {
    event.preventDefault();
    event.stopPropagation();
    removeListedItem("weeklyRules", id, "weekly");
  }
  if (action === "remove-weekly-extra") {
    event.preventDefault();
    event.stopPropagation();
    removeListedItem("weeklyExtras", id, "weekly extra");
  }
  if (action === "remove-reserve") {
    event.preventDefault();
    event.stopPropagation();
    removeListedItem("reserves", id, "reserve");
  }
  if (action === "remove-annual") {
    event.preventDefault();
    event.stopPropagation();
    removeListedItem("annualBills", id, "annual bill");
  }
  if (action === "remove-donation") {
    event.preventDefault();
    event.stopPropagation();
    removeListedItem("donations", id, "donation");
  }
  if (action === "undo-delete") {
    event.preventDefault();
    if (!lastDeleted) return;
    const restored = lastDeleted;
    lastDeleted = null;
    applyLocal(() => {
      const list = household()[restored.list] || [];
      if (!list.some((row) => row.id === restored.item.id)) list.push(restored.item);
      household()[restored.list] = list;
    });
    showToast("Restored");
  }
  if (action === "tick-envelope" || action === "tick-weekly-slot") {
    event.preventDefault();
    applyLocal(() => {
      if (!household().weeklyRules) household().weeklyRules = [];
      if (!household().weeklyExtras) household().weeklyExtras = [];
      toggleWeeklySlotTick(household(), id, viewMonth);
    });
  }
  if (action === "add-pending-row") {
    event.preventDefault();
    applyLocal(() => {
      addPendingRow(household(), { id: uid(), amountPence: 0, note: "", month: viewMonth });
    });
  }
  if (action === "clear-pending") {
    event.preventDefault();
    askDelete("pending-all", "", "the pending table", "Amounts go. Card balances stay.");
  }
  if (action === "remove-pending-row") {
    event.preventDefault();
    event.stopPropagation();
    removeListedItem("pendings", id, "pending row");
  }
  if (action === "remove-payslip-category") {
    event.preventDefault();
    event.stopPropagation();
    snapshotPayslipForm();
    modal.slipCategories = keepPayslipFormRows((modal.slipCategories || []).filter((item) => item.id !== id));
    renderModal();
  }
  if (action === "show-extra") {
    document.querySelector(`[data-extra-field="${extra}"]`)?.classList.remove("hidden");
    target.remove();
  }

  if (action === "close-modal") closeModal();
  if (action === "confirm-delete-transaction") askDelete("transaction", modal.transaction.id, "this entry");
  if (action === "confirm-delete-friend") askDelete("friend", modal.friend.id, "friend and history");
  if (action === "confirm-delete-person") askDelete("person", modal.person.id, "this person", "Their income and payslip rows will be removed. Donations keep the typed name.");
  if (action === "confirm-delete-bill") askDelete("monthly", modal.item.id, "this monthly");
  if (action === "confirm-delete-monthly") askDelete("monthly", modal.item.id, "this monthly");
  if (action === "confirm-delete-envelope") askDelete("weekly-rule", modal.item.id, "this weekly rule");
  if (action === "confirm-delete-weekly-rule") askDelete("weekly-rule", modal.item.id, "this weekly rule");
  if (action === "confirm-delete-weekly-extra") askDelete("weekly-extra", modal.item.id, "this extra");
  if (action === "confirm-delete-card") askDelete("card", modal.item.id, "this card");
  if (action === "confirm-delete-pending") askDelete("pending", modal.item.id, "this pending amount");
  if (action === "confirm-delete-reserve") askDelete("reserve", modal.item.id, "this reserve line");
  if (action === "confirm-delete-payslip-category") askDelete("payslip-category", modal.item.id, "this category");
  if (action === "confirm-delete-sub") askDelete("sub", modal.item.id, "this subscription");
  if (action === "confirm-delete-oneoff") askDelete("oneoff", modal.item.id, "this one-off");
  if (action === "confirm-delete-exception") askDelete("exception", modal.item.id, "this exception");
  if (action === "confirm-delete-annual") askDelete("annual", modal.item.id, "this annual bill");
  if (action === "confirm-delete-pot") askDelete("pot", modal.item.id, "this pot");
  if (action === "confirm-delete-pension") askDelete("pension", modal.item.id, "this pension name");
  if (action === "confirm-delete-payslip") askDelete("payslip", modal.payslip.id, "this payslip");
  if (action === "confirm-delete-donation") askDelete("donation", modal.item.id, "this donation");

  if (action === "delete-confirmed") {
    const targetModal = modal;
    if (targetModal.target === "person" && household().people.length <= 1) {
      showToast("Keep at least one person.");
      return;
    }
    if (targetModal.target === "pending-all") {
      applyLocal(() => {
        clearPendingsForMonth(household(), viewMonth);
      });
      closeModal();
      showToast("Pending cleared");
      return;
    }
    const saved = await withStoreUpdate(() => {
      if (targetModal.target === "transaction") store.transactions = store.transactions.filter((transaction) => transaction.id !== targetModal.id);
      if (targetModal.target === "friend") {
        store.friends = store.friends.filter((friend) => friend.id !== targetModal.id);
        store.transactions = store.transactions.filter((transaction) => transaction.friendId !== targetModal.id);
        screen = { name: "tabs" };
      }
      const hh = household();
      if (targetModal.target === "person") {
        if (hh.people.length <= 1) {
          throw new Error("Keep at least one person.");
        }
        hh.people = hh.people.filter((person) => person.id !== targetModal.id);
        hh.incomes = hh.incomes.filter((item) => item.personId !== targetModal.id);
        hh.payslips = hh.payslips.filter((item) => item.personId !== targetModal.id);
      }
      if (targetModal.target === "bill") hh.bills = hh.bills.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "monthly") hh.monthlies = (hh.monthlies || []).filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "envelope") hh.envelopes = hh.envelopes.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "weekly-rule") hh.weeklyRules = (hh.weeklyRules || []).filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "weekly-extra") hh.weeklyExtras = (hh.weeklyExtras || []).filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "card") {
        hh.cards = hh.cards.filter((item) => item.id !== targetModal.id);
        hh.cardSubs = hh.cardSubs.map((item) => (item.cardId === targetModal.id ? { ...item, cardId: undefined } : item));
      }
      if (targetModal.target === "pending") hh.pendings = hh.pendings.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "reserve") hh.reserves = (hh.reserves || []).filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "payslip-category") {
        hh.payslipCategories = masterPayslipCategories(hh).filter((item) => item.id !== targetModal.id);
      }
      if (targetModal.target === "sub") hh.cardSubs = hh.cardSubs.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "oneoff") hh.oneOffs = hh.oneOffs.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "exception") hh.exceptions = (hh.exceptions || []).filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "annual") hh.annualBills = hh.annualBills.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "pot") hh.pots = hh.pots.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "pension") hh.pensions = hh.pensions.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "payslip") hh.payslips = hh.payslips.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "donation") hh.donations = hh.donations.filter((item) => item.id !== targetModal.id);
    });
    if (saved) { closeModal(); showToast("Deleted"); }
    else showToast(sync.message || "Could not delete");
  }
  if (action === "sign-out") signOut();
  if (action === "local-workbook") {
    event.preventDefault();
    event.stopPropagation();
    openLocalWorkbook();
  }
  if (action === "reload") bootApp();
  if (action === "retry-sync") persist().catch(() => {});
  if (action === "discard-local") { clearLocalStore(); closeModal(); }
  if (action === "import-local") {
    const leftover = modal.leftover;
    const saved = await withStoreUpdate(() => { store = parseStore({ ...leftover, household: leftover.household || emptyHousehold() }); });
    if (saved) { clearLocalStore(); closeModal(); showToast("Imported from this browser"); }
    else showToast(sync.message || "Could not import");
  }
});

document.addEventListener("change", async (event) => {
  const action = event.target.dataset.action;
  if (action === "payslip-year") { payslipTaxYear = event.target.value; render(); }
  if (action === "ani-person") { aniPersonId = event.target.value; render(); }
  if (action === "ani-year") { aniTaxYear = event.target.value; render(); }
  if (action === "weekly-cadence") {
    const cadence = event.target.value;
    document.querySelector("[data-weekly-field=weekday]")?.classList.toggle("hidden", cadence !== "weekday");
    document.querySelector("[data-weekly-field=times]")?.classList.toggle("hidden", cadence !== "times");
  }
  if (action === "add-payslip-category") {
    const value = event.target.value;
    if (!value) return;
    const category = masterPayslipCategories(household()).find((item) => item.id === value);
    if (!category) return;
    snapshotPayslipForm();
    modal.slipCategories = keepPayslipFormRows([...(modal.slipCategories || []), category]);
    event.target.value = "";
    renderModal();
  }
  if (action === "payslip-person") {
    if (modal?.kind !== "payslip" || modal.payslip?.id) return;
    snapshotPayslipForm();
    modal.payslip = { ...(modal.payslip || {}), personId: event.target.value };
    modal.slipCategories = defaultCategoriesForNewPayslip(household(), event.target.value);
    renderModal();
  }
});

document.addEventListener("submit", (event) => {
  const handlers = {
    "friend-form": saveFriend,
    "transaction-form": saveTransaction,
    "login-form": signIn,
    "person-form": savePerson,
    "bill-form": saveMonthly,
    "monthly-form": saveMonthly,
    "envelope-form": saveWeeklyRule,
    "weekly-rule-form": saveWeeklyRule,
    "weekly-extra-form": saveWeeklyExtra,
    "card-form": saveCard,
    "sub-form": saveSub,
    "pending-form": savePending,
    "reserve-form": saveReserve,
    "payslip-category-form": savePayslipCategory,
    "home-card-form": saveHomeCard,
    "oneoff-form": saveOneOff,
    "exception-form": saveException,
    "annual-form": saveAnnual,
    "pot-form": savePot,
    "pension-form": savePension,
    "payslip-form": savePayslip,
    "donation-form": saveDonation,
  };
  const handler = handlers[event.target.id];
  if (handler) handler(event);
});

document.addEventListener("input", (event) => {
  if (event.target.closest("#transaction-form")) updateLiveSplit();
  if (event.target.closest("#payslip-form")) updatePayslipNet();
  const field = event.target.dataset.action;
  if (field === "pending-amount" || field === "pending-note") updatePendingField(event.target);
  if (field === "card-balance") updateCardBalance(event.target);
});

document.addEventListener("toggle", (event) => {
  const section = event.target.closest("[data-home-section]");
  if (section && event.target === section) {
    writeHomeSectionOpen(window.sessionStorage, section.dataset.homeSection, section.open);
  }
}, true);

document.addEventListener("pointerdown", (event) => {
  const ignore = event.target.closest(".tick, .swipe-delete");
  const row = event.target.closest("[data-swipe]");
  if (ignore || !row) {
    if (!row) closeSwipeRows();
    return;
  }
  swipeState = {
    row,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offset: row.classList.contains("open") ? -SWIPE_DELETE_WIDTH : 0,
    opened: row.classList.contains("open"),
    axis: "",
  };
}, { passive: true });

document.addEventListener("pointermove", (event) => {
  if (!swipeState || event.pointerId !== swipeState.pointerId) return;
  const dx = event.clientX - swipeState.startX;
  const dy = event.clientY - swipeState.startY;
  if (!swipeState.axis) {
    swipeState.axis = swipeAxis(dx, dy);
    if (swipeState.axis !== "x") {
      if (swipeState.axis === "y") swipeState = null;
      return;
    }
    closeSwipeRows(swipeState.row);
    swipeState.row.setPointerCapture?.(event.pointerId);
  }
  const front = swipeState.row.querySelector(".swipe-row-front");
  swipeState.offset = swipeOffset(swipeState.opened, dx);
  if (front) front.style.transform = `translateX(${swipeState.offset}px)`;
}, { passive: true });

document.addEventListener("pointerup", (event) => {
  if (!swipeState || event.pointerId !== swipeState.pointerId) return;
  if (swipeState.axis !== "x") {
    swipeState = null;
    return;
  }
  suppressClick = true;
  finishSwipe(swipeShouldOpen(swipeState.offset));
}, { passive: true });

document.addEventListener("click", (event) => {
  if (!suppressClick) return;
  suppressClick = false;
  if (event.target.closest(".swipe-delete")) return;
  event.preventDefault();
  event.stopPropagation();
}, true);

document.addEventListener("pointercancel", () => {
  if (!swipeState) return;
  finishSwipe(swipeState.opened);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal) closeModal();
});

window.addEventListener("hashchange", () => {
  screen = parseHash();
  if (boot.name === "ready") render();
});

window.addEventListener("popstate", () => {
  screen = parseHash();
  if (boot.name === "ready") render();
});

async function signIn(event) {
  event.preventDefault();
  const token = new FormData(event.target).get("token").trim();
  if (!token) return showFormError("Paste a GitHub token that can use gists.");
  setBusy(event.target, true);
  try {
    const client = createGistStore({ token });
    const identity = await client.identify();
    sessionStore.write({ token, login: identity.login });
    await bootApp();
  } catch (error) {
    showFormError(error.message);
    setBusy(event.target, false);
  }
}

async function saveFriend(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  const name = data.get("name").trim();
  const email = data.get("email").trim();
  if (!name) return showFormError("Add a name so you can find this tab.");
  if (email && !event.target.elements.email.checkValidity()) return showFormError("Add a valid email address or leave it blank.");
  const editing = Boolean(modal.friend?.id);
  const friendId = modal.friend?.id;
  setBusy(event.target, true);
  const saved = await withStoreUpdate(() => {
    if (editing) Object.assign(byId(friendId), { name, email });
    else store.friends.push({ id: uid(), name, email, createdAt: new Date().toISOString() });
  });
  if (!saved) {
    showFormError(sync.message || "Could not save this friend.");
    setBusy(event.target, false);
    return;
  }
  closeModal();
  showToast(editing ? "Friend updated" : "Friend added");
}

/** Money for a field that may hold a credit, keeping the minus sign visible. */
function signedFieldValue(pence) {
  const amount = Number.isInteger(pence) ? pence : 0;
  return amount < 0 ? `-${moneyFieldValue(-amount)}` : moneyFieldValue(amount);
}

function requireSignedMoney(value, label) {
  const pence = parseSignedMoney(value);
  if (pence === null) throw new Error(`Enter a valid ${label}, such as 12.50 or -12.50.`);
  return pence;
}

function parseSignedMoney(value) {
  const input = String(value).trim();
  if (!input) return 0;
  const negative = input.startsWith("-");
  const pence = parseMoneyToPence(negative ? input.slice(1) : input.replace(/^\+/, ""));
  return pence === null ? null : negative ? -pence : pence;
}

async function saveTransaction(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  const amountPence = parseMoneyToPence(data.get("amount"));
  const type = modal.transaction?.type || modal.type;
  const adjustment = type === "expense" ? parseSignedMoney(data.get("adjustment")) : 0;
  if (!amountPence || amountPence <= 0) return showFormError("Enter an amount greater than zero.");
  if (adjustment === null) return showFormError("Use a valid adjustment, such as 5 or -5.");
  try { if (type === "expense") splitExpense(amountPence, adjustment); } catch (error) { return showFormError(error.message); }
  const friendId = modal.friendId || data.get("friendId");
  const payload = {
    friendId,
    type,
    amountPence,
    paidBy: data.get("paidBy"),
    description: data.get("description").trim(),
    date: data.get("date"),
    createdAt: modal.transaction?.createdAt || new Date().toISOString(),
  };
  if (type === "expense") payload.myShareAdjustmentPence = adjustment;
  const editing = Boolean(modal.transaction?.id);
  const transactionId = modal.transaction?.id;
  setBusy(event.target, true);
  const saved = await withStoreUpdate(() => {
    if (editing) Object.assign(store.transactions.find((item) => item.id === transactionId), payload);
    else store.transactions.push({ id: uid(), ...payload });
  });
  if (!saved) {
    showFormError(sync.message || "Could not save this entry.");
    setBusy(event.target, false);
    return;
  }
  closeModal();
  showToast(editing ? "Entry updated" : type === "expense" ? "Expense added" : "Transfer recorded");
}

async function saveNamedMoney(event, { list, build, toastAdd, toastEdit }) {
  event.preventDefault();
  const data = new FormData(event.target);
  let payload;
  try {
    payload = build(data, event.target);
  } catch (error) {
    return showFormError(error.message);
  }
  const existingId = modal.item?.id || modal.person?.id || modal.payslip?.id;
  const editing = Boolean(existingId);
  setBusy(event.target, true);
  const saved = await withStoreUpdate(() => {
    if (!household()[list]) household()[list] = [];
    const collection = household()[list];
    if (editing) {
      const current = collection.find((item) => item.id === existingId);
      if (!current) throw new Error("That line is gone.");
      Object.assign(current, payload);
    } else {
      collection.push({ id: uid(), ...payload });
    }
  });
  if (!saved) {
    showFormError(sync.message || "Could not save.");
    setBusy(event.target, false);
    return;
  }
  closeModal();
  showToast(editing ? toastEdit : toastAdd);
}

function requireMoney(value, label) {
  const pence = parseMoneyAllowZero(value);
  if (pence === null) throw new Error(`Enter a valid ${label}, such as 12.50.`);
  return pence;
}

function requireName(value, label) {
  const name = String(value || "").trim();
  if (!name) throw new Error(`Add a ${label}.`);
  return name;
}

function requireDueDay(value) {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("Due day must be between 1 and 31.");
  return day;
}

async function savePerson(event) {
  return saveNamedMoney(event, {
    list: "people",
    toastAdd: "Person added",
    toastEdit: "Name updated",
    build: (data) => ({ name: requireName(data.get("name"), "name") }),
  });
}

async function saveMonthly(event) {
  return saveNamedMoney(event, {
    list: "monthlies",
    toastAdd: "Monthly added",
    toastEdit: "Monthly updated",
    build: (data) => {
      const dueRoll = ["calendar", "nextWorking", "firstWorking"].includes(data.get("dueRoll"))
        ? data.get("dueRoll")
        : "calendar";
      return {
        name: requireName(data.get("name"), "name"),
        amountPence: requireMoney(data.get("amount"), "amount"),
        dueDay: dueRoll === "firstWorking" ? (Number(data.get("dueDay")) || 1) : requireDueDay(data.get("dueDay")),
        dueRoll,
        paidFrom: data.get("paidFrom") === "cash" ? "cash" : "card",
      };
    },
  });
}

async function saveWeeklyRule(event) {
  return saveNamedMoney(event, {
    list: "weeklyRules",
    toastAdd: "Weekly rule added",
    toastEdit: "Weekly rule updated",
    build: (data) => {
      const cadence = data.get("cadence") === "weekday" ? "weekday" : "times";
      const payload = {
        name: requireName(data.get("name"), "name"),
        amountPence: assertWeeklyRuleAmount(requireMoney(data.get("amount"), "typical amount")),
        cadence,
        tickedKeys: modal.item?.tickedKeys || [],
        paidFrom: modal.item?.paidFrom === "cash" ? "cash" : "card",
      };
      if (cadence === "times") {
        const times = Number(data.get("timesPerMonth"));
        if (!Number.isInteger(times) || times < 1 || times > 12) throw new Error("Times a month must be 1 to 12.");
        payload.timesPerMonth = times;
      }
      if (cadence === "weekday") {
        const weekday = Number(data.get("weekday"));
        if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error("Pick a weekday.");
        payload.weekday = weekday;
      }
      return payload;
    },
  });
}

async function saveWeeklyExtra(event) {
  return saveNamedMoney(event, {
    list: "weeklyExtras",
    toastAdd: "Extra added",
    toastEdit: "Extra updated",
    build: (data) => ({
      name: requireName(data.get("name"), "name"),
      amountPence: requireMoney(data.get("amount"), "amount"),
      month: modal.item?.month || viewMonth,
      happened: Boolean(modal.item?.happened),
      paidFrom: modal.item?.paidFrom === "cash" ? "cash" : "card",
    }),
  });
}

async function saveCard(event) {
  return saveNamedMoney(event, {
    list: "cards",
    toastAdd: "Card added",
    toastEdit: "Card updated",
    build: (data) => {
      const amountPence = requireMoney(data.get("amount"), "balance");
      const pendingPence = requireMoney(data.get("pending"), "pending");
      const existing = modal.item || {};
      const snapshots = upsertMonthSnapshot(existing.snapshots || [], {
        month: viewMonth,
        amountPence,
        pendingPence,
        updatedOn: today(),
      });
      if (!existing.id || viewMonth === monthKey()) {
        return {
          name: requireName(data.get("name"), "name"),
          balancePence: amountPence,
          pendingPence,
          updatedOn: today(),
          snapshots,
        };
      }
      return {
        name: requireName(data.get("name"), "name"),
        balancePence: existing.balancePence || 0,
        pendingPence: existing.pendingPence || 0,
        updatedOn: existing.updatedOn || today(),
        snapshots,
      };
    },
  });
}

async function savePending(event) {
  return saveNamedMoney(event, {
    list: "pendings",
    toastAdd: "Pending added",
    toastEdit: "Pending updated",
    build: (data) => ({
      note: String(data.get("note") || "").trim(),
      amountPence: requireSignedMoney(data.get("amount"), "amount"),
      month: modal.item?.month || viewMonth,
    }),
  });
}

async function saveReserve(event) {
  return saveNamedMoney(event, {
    list: "reserves",
    toastAdd: "Reserve added",
    toastEdit: "Reserve updated",
    build: (data) => ({
      name: requireName(data.get("name"), "name"),
      amountPence: requireMoney(data.get("amount"), "amount"),
    }),
  });
}

async function savePayslipCategory(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  let label;
  try {
    label = requireName(data.get("label"), "name");
  } catch (error) {
    return showFormError(error.message);
  }
  const existing = modal.item || {};
  const special = ["bonus", "benefits", "sacrifice", "tax", "ni"].includes(existing.kind);
  const kind = special ? existing.kind : (
    data.get("kind") === "extra" ? "extra" : data.get("kind") === "parental" ? "parental" : "deduction"
  );
  const payload = {
    id: existing.id || uid(),
    label,
    kind,
  };
  setBusy(event.target, true);
  const saved = await withStoreUpdate(() => {
    const hh = household();
    const current = masterPayslipCategories(hh);
    if (existing.id) {
      hh.payslipCategories = current.map((item) => (item.id === existing.id ? payload : item));
    } else {
      hh.payslipCategories = [...current, payload];
    }
  });
  if (!saved) {
    showFormError(sync.message || "Could not save.");
    setBusy(event.target, false);
    return;
  }
  closeModal();
  showToast(existing.id ? "Category updated" : "Category added");
}

function saveHomeCard(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  const name = String(data.get("home-card-name") || "").trim();
  if (!name) return;
  let amountPence;
  try {
    amountPence = requireMoney(data.get("home-card-balance"), "balance");
  } catch (error) {
    showToast(error.message);
    return;
  }
  applyLocal(() => {
    const snapshots = upsertMonthSnapshot([], {
      month: viewMonth,
      amountPence,
      pendingPence: 0,
      updatedOn: today(),
    });
    household().cards.push({
      id: uid(),
      name,
      balancePence: amountPence,
      pendingPence: 0,
      updatedOn: today(),
      snapshots,
    });
  });
}

async function saveSub(event) {
  return saveNamedMoney(event, {
    list: "cardSubs",
    toastAdd: "Subscription added",
    toastEdit: "Subscription updated",
    build: (data) => {
      const payload = {
        name: requireName(data.get("name"), "name"),
        amountPence: requireMoney(data.get("amount"), "amount"),
        dueDay: requireDueDay(data.get("dueDay")),
      };
      if (data.get("cardId")) payload.cardId = data.get("cardId");
      return payload;
    },
  });
}

async function saveOneOff(event) {
  return saveNamedMoney(event, {
    list: "oneOffs",
    toastAdd: "One-off added",
    toastEdit: "One-off updated",
    build: (data) => ({
      name: requireName(data.get("name"), "item"),
      month: coerceMonthKey(data.get("month")) || viewMonth,
      estimatePence: requireMoney(data.get("amount"), "estimate"),
      purchased: data.get("purchased") === "on",
    }),
  });
}

async function saveException(event) {
  return saveNamedMoney(event, {
    list: "exceptions",
    toastAdd: "Exception added",
    toastEdit: "Exception updated",
    build: (data) => ({
      name: requireName(data.get("name"), "exception"),
      month: coerceMonthKey(data.get("month")) || viewMonth,
      amountPence: requireMoney(data.get("amount"), "amount"),
    }),
  });
}

async function saveAnnual(event) {
  return saveNamedMoney(event, {
    list: "annualBills",
    toastAdd: "Annual bill added",
    toastEdit: "Annual bill updated",
    build: (data) => {
      const payload = {
        name: requireName(data.get("name"), "name"),
        amountPence: requireMoney(data.get("amount"), "amount"),
      };
      if (data.get("month")) payload.month = Number(data.get("month"));
      return payload;
    },
  });
}

async function savePot(event) {
  return saveNamedMoney(event, {
    list: "pots",
    toastAdd: "Pot added",
    toastEdit: "Pot updated",
    build: (data) => {
      const amountPence = requireMoney(data.get("amount"), "amount");
      const updatedOn = today();
      return {
        name: requireName(data.get("name"), "name"),
        amountPence,
        updatedOn,
        snapshots: upsertMonthSnapshot(modal.item?.snapshots || [], {
          month: monthKey(),
          amountPence,
          updatedOn,
        }),
      };
    },
  });
}

async function savePension(event) {
  return saveNamedMoney(event, {
    list: "pensions",
    toastAdd: "Pension added",
    toastEdit: "Pension updated",
    build: (data) => ({
      name: requireName(data.get("name"), "name"),
      status: data.get("status") || "active",
      note: String(data.get("note") || "").trim(),
    }),
  });
}

async function savePayslip(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  let salaryPence;
  let grossPence;
  try {
    salaryPence = requireMoney(data.get("salary"), "salary");
    grossPence = requireMoney(data.get("gross"), "gross");
  } catch (error) {
    return showFormError(error.message);
  }
  const statedNetPence = parseMoneyAllowZero(data.get("statedNet"));
  if (statedNetPence === null) return showFormError("Use a valid net, such as 2420.00.");
  const amounts = applyPayslipCategoryAmounts({
    ...(modal.payslip || {}),
    salaryPence,
    grossPence,
    grossBeforeSacrifice: data.get("grossBeforeSacrifice") === "on",
    grossExcludesBonus: data.get("grossExcludesBonus") === "on",
  }, modal.slipCategories || [], event.target);
  if ((amounts.otherDeductions || []).some((row) => row.amountPence == null)) {
    return showFormError("Use a valid amount, such as 12.50.");
  }
  const payload = {
    personId: data.get("personId"),
    taxYear: data.get("taxYear"),
    periodMonth: data.get("periodMonth"),
    salaryPence,
    grossPence,
    bonusPence: amounts.bonusPence,
    benefitsPence: amounts.benefitsPence,
    salarySacrificePensionPence: amounts.salarySacrificePensionPence,
    reliefAtSourcePensionPence: amounts.reliefAtSourcePensionPence,
    otherDeductions: amounts.otherDeductions,
    taxPence: amounts.taxPence,
    niPence: amounts.niPence,
    grossBeforeSacrifice: data.get("grossBeforeSacrifice") === "on",
    grossExcludesBonus: data.get("grossExcludesBonus") === "on",
    netPence: amounts.netPence,
    statedNetPence,
    note: String(data.get("note") || "").trim(),
    moneyLandsMonth: data.get("moneyLandsMonth") || data.get("periodMonth"),
    forecast: data.get("forecast") === "on",
    taxCode: String(data.get("taxCode") || "").trim(),
  };
  const editing = Boolean(modal.payslip?.id);
  const existingId = modal.payslip?.id;
  setBusy(event.target, true);
  const saved = await withStoreUpdate(() => {
    if (editing) Object.assign(household().payslips.find((item) => item.id === existingId), payload);
    else household().payslips.push({ id: uid(), ...payload });
    rememberPayslipCategories(household(), modal.slipCategories || []);
  });
  if (!saved) {
    showFormError(sync.message || "Could not save this payslip.");
    setBusy(event.target, false);
    return;
  }
  closeModal();
  showToast(editing ? "Payslip updated" : "Payslip added");
}

async function saveDonation(event) {
  return saveNamedMoney(event, {
    list: "donations",
    toastAdd: "Donation added",
    toastEdit: "Donation updated",
    build: (data) => ({
      who: requireName(data.get("who"), "who"),
      charity: requireName(data.get("charity"), "charity"),
      date: data.get("date"),
      amountPence: requireMoney(data.get("amount"), "amount"),
      giftAid: data.get("giftAid") === "on",
    }),
  });
}

function snapshotPayslipForm() {
  const form = document.querySelector("#payslip-form");
  if (!form || !modal || modal.kind !== "payslip") return;
  const data = new FormData(form);
  const readMoney = (name) => {
    const value = parseMoneyAllowZero(data.get(name));
    return value == null ? 0 : value;
  };
  const amounts = applyPayslipCategoryAmounts({
    ...(modal.payslip || {}),
    salaryPence: readMoney("salary"),
    grossPence: readMoney("gross"),
  }, modal.slipCategories || [], form);
  modal.payslip = {
    ...amounts,
    personId: data.get("personId"),
    taxYear: data.get("taxYear"),
    periodMonth: data.get("periodMonth"),
    moneyLandsMonth: data.get("moneyLandsMonth"),
    note: String(data.get("note") || "").trim(),
    taxCode: String(data.get("taxCode") || "").trim(),
    forecast: data.get("forecast") === "on",
  };
}

function updatePayslipNet() {
  const block = document.querySelector("[data-payslip-net-block]");
  if (!block) return;
  const live = livePayslipFromForm(modal?.payslip || {}, modal?.slipCategories || []);
  block.outerHTML = payslipNetBlock(live);
}

function updatePendingField(input) {
  const id = input.dataset.id;
  const item = (household().pendings || []).find((row) => row.id === id);
  if (!item) return;
  if (input.dataset.action === "pending-note") {
    item.note = String(input.value || "").trim();
  } else {
    // A refund or a credit is a negative row, so the sign has to survive.
    const amount = parseSignedMoney(input.value);
    if (amount === null) return;
    item.amountPence = amount;
  }
  if (!item.month) item.month = viewMonth;
  storeGeneration += 1;
  const total = document.querySelector("[data-pending-total]");
  if (total) {
    total.textContent = formatMoney(pendingListTotalPence(pendingsForMonth(household(), viewMonth)));
  }
  refreshStatement();
  persistQueue.schedule();
}

function updateCardBalance(input) {
  const card = (household().cards || []).find((item) => item.id === input.dataset.id);
  if (!card) return;
  const amount = parseMoneyAllowZero(input.value);
  if (amount === null) return;
  const snapshots = upsertMonthSnapshot(card.snapshots || [], {
    month: viewMonth,
    amountPence: amount,
    pendingPence: card.pendingPence || 0,
    updatedOn: today(),
  });
  card.snapshots = snapshots;
  if (viewMonth === monthKey()) {
    card.balancePence = amount;
    card.updatedOn = today();
  }
  storeGeneration += 1;
  refreshStatement();
  persistQueue.schedule();
}

function updateLiveSplit() {
  const form = document.querySelector("#transaction-form");
  const output = document.querySelector("#live-split");
  if (!form || !output) return;
  const isExpense = (modal.transaction?.type || modal.type) === "expense";
  const amountPence = parseMoneyToPence(form.elements.amount.value);
  const paidBy = form.elements.paidBy.value;
  const friend = byId(modal.friendId || form.elements.friendId.value);
  if (!amountPence) { output.textContent = ""; return; }
  if (!isExpense) {
    output.textContent = paidBy === "me"
      ? `You’re paying ${friend.name} ${formatMoney(amountPence)}.`
      : `${friend.name} is paying you ${formatMoney(amountPence)}.`;
    return;
  }
  const adjustment = parseSignedMoney(form.elements.adjustment?.value || "");
  try {
    const split = splitExpense(amountPence, adjustment ?? 0);
    output.innerHTML = paidBy === "me"
      ? `You paid <strong>${formatMoney(amountPence)}</strong><span>Your share ${formatMoney(split.mySharePence)}</span><span>${esc(friend.name)}’s share ${formatMoney(split.friendSharePence)}</span><b>${esc(friend.name)} owes you ${formatMoney(split.friendSharePence)}</b>`
      : `${esc(friend.name)} paid <strong>${formatMoney(amountPence)}</strong><span>Your share ${formatMoney(split.mySharePence)}</span><span>${esc(friend.name)}’s share ${formatMoney(split.friendSharePence)}</span><b>You owe ${esc(friend.name)} ${formatMoney(split.mySharePence)}</b>`;
  } catch {
    output.textContent = "Adjustment needs to keep both shares at zero or more.";
  }
}

bootApp();
