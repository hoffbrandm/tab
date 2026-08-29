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
  householdHasData,
  setAsidesForMonth,
  setAsidesOutsideMonth,
  fromSavingsForMonth,
  fromSavingsOutsideMonth,
  exceptionsTotalPence,
  giftAidGrossPence,
  isCurrentMonth,
  jumpToCurrentMonthLabel,
  monthKey,
  monthLabel,
  monthName,
  monthlyDueLabel,
  monthliesOf,
  normalizeDueRoll,
  dueDayOf,
  normalizeWeeklyCadence,
  oneOffsForMonth,
  oneOffsOutsideMonth,
  oneOffPaidFrom,
  oneOffDueLabel,
  resolvedPayslipReading,
  payslipReadingSummary,
  outBreakdownForMonth,
  monthStatementRows,
  daysInMonthKey,
  perDiemTotalPence,
  perDiemDailyPence,
  perDiemSoFarPence,
  proRateDay,
  plannedMonthTotals,
  payslipAmountForCategory,
  masterPayslipCategories,
  payslipIsConfirmed,
  payslipNetPence,
  payslipNetAsReadPence,
  payslipIsNetOnly,
  payslipSaysNothing,
  payslipNetCheck,
  payslipNetHints,
  payslipGrossPaidPence,
  payslipDeductionsPence,
  payslipNetReadings,
  payslipRecordLabels,
  payslipMonthsForNewSlip,
  previousPayslipForPerson,
  usedPayslipCategories,
  payslipFillFromPrevious,
  payslipWithFills,
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

/** The days of the month on screen a rule's slots fall due, as "1st, 8th…". */
function dueDaysLabel(rule) {
  const days = weeklySlotsForMonth({ weeklyRules: [rule] }, viewMonth).map((slot) => slot.dueDay);
  return days.length ? days.map(ordinalDay).join(", ") : "no slots this month";
}

function ordinalDay(day) {
  const rest = day % 100;
  if (rest >= 11 && rest <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] || "th"}`;
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

/**
 * Status, not reassurance. "Saved to a private gist" took a row of its own on
 * every screen to say that nothing had happened; at rest the chip is a quiet
 * word in the top bar, and it only grows when there is something to say.
 */
function syncChip() {
  if (sync.name === "saving") return `<span class="status-chip saving" data-sync-chip>Saving…</span>`;
  if (sync.name === "error") {
    return `<button class="status-chip error" data-sync-chip data-action="retry-sync" type="button">${esc(sync.message || "Could not save")}</button>`;
  }
  if (localSession) return `<span class="status-chip quiet" data-sync-chip title="This session only. Nothing is written to a gist.">Local</span>`;
  return `<span class="status-chip quiet" data-sync-chip title="Saved to your private gist.">Saved</span>`;
}

function errorScreen(message, actionLabel, action) {
  return `<section class="shell gate">
    <header class="topbar"><span class="wordmark">TAB</span></header>
    <div class="intro"><h1>Couldn’t open the household.</h1><p class="lede">${esc(message)}</p></div>
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

/**
 * Every room opened with an eyebrow, a title that mostly repeated it, and a
 * paragraph of documentation — read once, then noise on every visit after. One
 * title now, named the same as the room's tab so the header and the bar agree,
 * one short line, and the detail behind "How this works".
 */
function shell({ title, lede, help = "", extra = "", body, month = false, back = "" }) {
  return `<section class="shell app-shell">
    <header class="topbar">
      ${back ? `<button class="back" data-action="go" data-screen="${back}" aria-label="Back">‹</button>` : `<a class="wordmark" href="#/home" data-action="go" data-screen="home">TAB</a>`}
      ${back ? `<a class="wordmark" href="#/home" data-action="go" data-screen="home">TAB</a>` : `<span></span>`}
      ${syncChip()}
    </header>
    ${month ? monthSwitcher() : ""}
    ${title ? `<div class="intro compact">
      <h1>${esc(title)}</h1>
      ${lede ? `<p class="lede">${lede}</p>` : ""}
      ${help ? `<details class="room-help"><summary>How this works</summary><p>${help}</p></details>` : ""}
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

/**
 * Four destinations, one row. There were eleven across three rows, then five;
 * of those five, Weeklies and Monthlies are config that barely changes once it
 * is right, so they are places you visit now and then rather than places the
 * month runs through. Home, what is coming, and who owes what.
 */
const DOCK = [
  ["home", "Home"],
  ["planned", "Planned"],
  ["tabs", "Tabs"],
];

/** The rooms More lists, with a line each saying what they are for. */
const MORE_ROOMS = [
  ["weeklies", "Weeklies", "The rules that make the slots you tick on Home"],
  ["monthlies", "Monthlies", "Standing bills, and the month's per diem"],
  ["annual", "Annual", "Renewals and once-a-year bills, saved monthly"],
  ["pots", "Pots", "What you hold, and pension names"],
  ["payslips", "Payslips", "Net pay per person, per month"],
  ["ani", "£100k", "Adjusted net income against the childcare cliff"],
  ["giving", "Giving", "Donations and Gift Aid"],
];

function dockIsMore(name) {
  return MORE_ROOMS.some(([route]) => route === name) || name === "more";
}

function dock() {
  const item = (name, label, active) =>
    `<a class="dock-item${active ? " active" : ""}" href="#/${name}" data-action="go" data-screen="${name}">${label}</a>`;
  return `<nav class="dock" aria-label="App">
    ${DOCK.map(([name, label]) => item(name, label, screen.name === name || (name === "tabs" && screen.name === "friend"))).join("")}
    ${item("more", "More", dockIsMore(screen.name))}
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

/** Ahead is worth seeing as good news and behind as bad, so these two colour. */
function trackClass(pence, known = true) {
  if (!known) return "neutral";
  if (pence < 0) return "negative";
  if (pence > 0) return "positive";
  return "neutral";
}

/**
 * Ahead / behind, not underspend / overspend: the row sits under "Where you
 * are", and the question it answers is whether today is in front of the plan or
 * behind it, not whether a single spend was too big.
 */
function overUnderLabel(flow) {
  if (!flow.cardCheckKnown) return "Ahead / behind plan";
  if (flow.overUnderPence < 0) return "Behind plan";
  if (flow.overUnderPence > 0) return "Ahead of plan";
  return "Exactly on plan";
}

function overUnderAmount(flow) {
  if (!flow.cardCheckKnown) return "—";
  return formatMoney(Math.abs(flow.overUnderPence));
}

/**
 * What is still to come is two kinds of money, and one row called "left to
 * spend" made them look like one. Weeklies and monthlies are expected to be
 * paid, so counting them as spending room says the month has more slack in it
 * than it has; the per diem is the half that is actually chosen day by day.
 */
function committedLabel(flow) {
  if (flow.committedToComePence < 0) return "Paid beyond the plan";
  return flow.monthPhase === "past" ? "Never came out" : "Still to be paid";
}

function committedAmount(flow) {
  return formatMoney(Math.abs(flow.committedToComePence));
}

function reserveLeftLabel(flow) {
  return flow.reserveLeftPence < 0 ? "Per diem overspent" : "Per diem left";
}

function reserveLeftAmount(flow) {
  return formatMoney(Math.abs(flow.reserveLeftPence));
}

/** A household with no per diem set has no spending money to talk about. */
function hasDayMoney(flow) {
  return flow.reserveTotalPence > 0;
}

function todayHeading(flow) {
  if (flow.monthPhase === "past") return "How it went";
  return `Where you are · day ${flow.dayOfMonth} of ${flow.daysInMonth}`;
}

function allowedLabel(flow) {
  return flow.monthPhase === "past" ? "The plan allowed" : "Plan allows by today";
}

function cardsNowLabel(flow) {
  return flow.monthPhase === "past" ? "Ended up on the cards" : "On the cards now";
}

/**
 * The headline is the answer to the question the month is actually asking, so
 * it says which question in words rather than leaving a bare total to read.
 */
function forecastEyebrow(flow) {
  const label = monthName(flow.month);
  if (flow.forecastSavingPence < 0) {
    if (flow.monthPhase === "past") return `${label} came up short by`;
    return `${label} is heading for a shortfall of`;
  }
  if (flow.monthPhase === "past") return `${label} saved`;
  if (flow.monthPhase === "future") return `${label} plans to save`;
  // "On track" is a claim about the plan, not about the sign of the number. A
  // month £1,229 above what the plan allows is still saving, but it is not on
  // track, and saying so over a green figure read as everything being fine.
  if (flow.cardCheckKnown && flow.overUnderPence < 0) return `${label} is set to save`;
  return `${label} is on track to save`;
}

/**
 * Where today stands, as a chip rather than a clause. The position was buried
 * three sentences into a paragraph that then repeated the same figure twice,
 * so the one thing worth seeing first was the last thing read.
 */
function positionChip(flow) {
  if (flow.monthPhase === "future") return { label: "Not started", tone: "neutral" };
  if (!flow.cardCheckKnown) return { label: "No card balance yet", tone: "neutral" };
  const past = flow.monthPhase === "past";
  if (flow.overUnderPence < 0) {
    return { label: `${formatMoney(-flow.overUnderPence)} over plan`, tone: "negative" };
  }
  if (flow.overUnderPence > 0) {
    return { label: `${formatMoney(flow.overUnderPence)} under plan`, tone: "positive" };
  }
  return { label: past ? "Finished on plan" : "Exactly on plan", tone: "neutral" };
}

function forecastAmount(flow) {
  return formatMoney(Math.abs(flow.forecastSavingPence));
}

function daysLeftPhrase(flow) {
  if (flow.daysLeft <= 0) return "Last day";
  if (flow.daysLeft === 1) return "1 day left";
  return `${flow.daysLeft} days left`;
}

/**
 * The one sentence Home exists for: how today stands against the plan, how much
 * of the plan is still there to spend, and what the month ends up saving if the
 * rest of it goes to plan.
 */
function positionSummary(flow) {
  const label = monthName(flow.month);
  const forecast = formatMoney(flow.forecastSavingPence);
  const planned = formatMoney(flow.savingsPence);
  // A month that has not started has no balance yet by definition, so it is
  // answered as "not started" rather than as a card waiting to be filled in.
  // "Saves -£7,036.67" is not a sentence anyone reads twice. A plan that does
  // not balance is short, and says so.
  const onThePlan = flow.savingsPence < 0
    ? `is ${formatMoney(-flow.savingsPence)} short`
    : `saves ${planned}`;
  if (flow.monthPhase === "future") {
    return `${label} has not started. On the plan it ${onThePlan}.`;
  }
  if (!flow.cardCheckKnown) {
    const names = flow.cardsMissingSnapshot.map((card) => card.name).join(", ");
    return `No ${label} balance on ${names}, so there is nothing to measure today against yet. On the plan alone ${label} ${onThePlan}.`;
  }
  // How far over or under is on the chip now, so the sentence says the thing
  // the chip cannot: what is left to come, and what to do about it.
  if (flow.monthPhase === "past") {
    return `Against a plan that ${onThePlan}, ${label} came in at ${forecast}.`;
  }
  const lever = hasDayMoney(flow) && flow.reserveLeftPence > 0;
  const close = nothingLeftToCome(flow)
    ? `Nothing more is due, so ${label} lands on ${forecast}.`
    : lever
      ? `Hold that and ${label} lands on ${forecast}.`
      : `If that is all that lands, ${label} saves ${forecast}.`;
  return `${stillToComeSentence(flow)} ${close}`;
}

function nothingLeftToCome(flow) {
  return flow.committedToComePence <= 0 && (!hasDayMoney(flow) || flow.reserveLeftPence <= 0);
}

/**
 * The middle sentence, and the point of the whole screen: the weeklies and
 * monthlies still to come are going to be paid whatever happens, so the only
 * figure worth acting on is the day money left. Saying "keep the rest under
 * £496.77" put the two together and made a committed bill look like room.
 */
function stillToComeSentence(flow) {
  const committed = flow.committedToComePence > 0
    ? `${formatMoney(flow.committedToComePence)} of weeklies and monthlies is still expected to be paid`
    : "";
  if (!hasDayMoney(flow)) {
    return committed ? `${committed[0].toUpperCase()}${committed.slice(1)}.` : "Everything planned has been paid.";
  }
  const perDay = flow.daysLeft > 0 && flow.perDayReserveLeftPence > 0
    ? ` (about ${formatMoney(flow.perDayReserveLeftPence)} a day)`
    : "";
  const day = flow.reserveLeftPence > 0
    ? `the ${formatMoney(flow.reserveLeftPence)} of per diem left${perDay} is the part you choose`
    : flow.reserveLeftPence < 0
      ? `the per diem is ${formatMoney(-flow.reserveLeftPence)} overspent already`
      : `the day money for the month is gone`;
  if (!committed) return `Everything planned has been paid, and ${day}.`;
  return `${committed[0].toUpperCase()}${committed.slice(1)}; ${day}.`;
}

/**
 * What makes up "the plan allows by today", so both sides of the check can be
 * trusted, and where the cards land if the rest of the month goes to plan.
 */
function statementNote(flow) {
  if (!flow.cardCheckKnown) {
    const names = flow.cardsMissingSnapshot.map((card) => card.name).join(", ");
    return `Add a card balance for ${monthName(flow.month)} on ${names} to turn the check on.`;
  }
  const parts = [];
  if (flow.reserveSpentPence) {
    parts.push(`${formatMoney(flow.reserveSpentPence)} of the ${formatMoney(flow.reserveTotalPence)} per diem (${flow.dayOfMonth}/${flow.daysInMonth} of the way through)`);
  }
  if (flow.dueWeeklyPence) {
    parts.push(`${formatMoney(flow.dueWeeklyPence)} of weekly slots the month has reached`);
  }
  if (flow.exceptionsPence) parts.push(`${formatMoney(flow.exceptionsPence)} of exceptions`);
  const listed = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  // A set-aside is the one thing that comes off the allowance, so it is said
  // separately rather than buried in a list of what makes it up.
  const held = flow.setAsidePence
    ? `${formatMoney(flow.setAsidePence)} is held back and comes off it.`
    : "";
  const made = [parts.length ? `The allowance includes ${listed}.` : "", held].filter(Boolean).join(" ");
  if (flow.monthPhase !== "current" || flow.remainingPlanPence <= 0) return made;
  const lands = `Spend the rest of the plan and the cards finish ${monthName(flow.month)} at ${formatMoney(flow.forecastCardsPence)}.`;
  // Money moved in from savings is not money earned, so a total that leans on
  // one says so rather than reading as a month that simply went well.
  const drawn = flow.extraFromSavingsPence
    ? ` ${formatMoney(flow.extraFromSavingsPence)} of the total came in from savings.`
    : "";
  return `${made ? `${made} ` : ""}${lands}${drawn}`;
}

/**
 * The month in the shape the household is actually read in: the source
 * spreadsheet's Main Table, one row per category across its three columns.
 * A rearrangement of the same figures was harder to trust than the layout
 * they have been read in for years, so Home shows that layout instead.
 */
function statementRow(row) {
  return `<div class="statement-line${row.aside ? " aside" : ""}">
    <span class="statement-cell name">${esc(row.label)}${row.note ? `<small>${esc(row.note)}</small>` : ""}</span>
    ${statementCell(row.flowPence, row.flowPence < 0 ? " negative" : "")}
    ${statementCell(row.allowedPence, row.allowedPence < 0 ? " negative" : "")}
    ${statementCell(row.cardPence)}
  </div>`;
}

function statementCell(pence, extra = "") {
  return pence == null || pence === 0
    ? `<span class="statement-cell empty">—</span>`
    : `<span class="statement-cell${extra}">${formatMoney(pence)}</span>`;
}

function statementSection(flow) {
  const table = monthStatementRows(household(), viewMonth, new Date());
  // The check belongs in the month column, signed, because it is a term in the
  // sum rather than a note beside it: the column runs Income to Total savings
  // and adds up on the way down.
  const check = table.cardCheckKnown
    ? `<div class="statement-line check">
        <span class="statement-cell name">${esc(table.overUnderPence < 0 ? "Overspend" : table.overUnderPence > 0 ? "Underspend" : "On budget")}</span>
        <span class="statement-cell ${trackClass(table.overUnderPence)}">${formatMoney(table.overUnderPence)}</span>
        <span class="statement-cell empty">—</span>
        <span class="statement-cell empty">—</span>
      </div>`
    : "";
  return `<section class="statement" aria-label="Month statement" data-statement>
        <div class="statement-hero">
          <p class="statement-eyebrow" data-statement-eyebrow>${esc(forecastEyebrow(flow))}</p>
          <strong class="${trackClass(flow.forecastSavingPence)}" data-statement-forecast>${forecastAmount(flow)}</strong>
          <p class="statement-chips" data-statement-chips>
            <span class="chip ${positionChip(flow).tone}">${esc(positionChip(flow).label)}</span>
            ${flow.monthPhase === "current" ? `<span class="chip quiet">${esc(daysLeftPhrase(flow))}</span>` : ""}
          </p>
          <p class="statement-summary" data-statement-summary>${esc(positionSummary(flow))}</p>
        </div>
        <div class="statement-table" data-statement-table>
          <div class="statement-line head">
            <span class="statement-cell name">${esc(table.monthPhase === "future" ? "Not started" : `Day ${table.dayOfMonth} of ${table.daysInMonth}`)}</span>
            <span class="statement-cell">The month</span>
            <span class="statement-cell">Allowed</span>
            <span class="statement-cell">On cards</span>
          </div>
          ${table.rows.map(statementRow).join("")}
          <div class="statement-line total">
            <span class="statement-cell name">The plan saves</span>
            <span class="statement-cell ${moneyClass(table.savingsPence)}">${formatMoney(table.savingsPence)}</span>
            <span class="statement-cell">${formatMoney(table.allowedPence)}</span>
            <span class="statement-cell">${formatMoney(table.onCardsPence)}</span>
          </div>
          <div class="statement-line caption">
            <span class="statement-cell name">What the cards actually say</span>
          </div>
          ${table.actualRows.map(statementRow).join("")}
          ${check}
          <div class="statement-line grand">
            <span class="statement-cell name">Ends up saving</span>
            <span class="statement-cell ${trackClass(table.totalSavingsPence)}">${formatMoney(table.totalSavingsPence)}</span>
            <span class="statement-cell empty">—</span>
            <span class="statement-cell empty">—</span>
          </div>
        </div>
        <p class="statement-note" data-statement-note>${esc(statementNote(flow))}</p>
      </section>`;
}

/**
 * Card balances, pending rows and exception amounts are typed into inputs that
 * stay on screen, and a full render would take the caret with it. The statement
 * holds no inputs of its own, so it is re-rendered whole rather than patched
 * cell by cell — one source of truth for the markup, and no hook to go stale.
 */
function refreshStatement() {
  const section = document.querySelector("[data-statement]");
  if (!section) return;
  const flow = cashflowForMonth(household(), viewMonth, new Date());
  section.outerHTML = statementSection(flow);
}

/**
 * The statement's two Out halves, itemised. Every figure on Home should be
 * walkable back to the lines that make it, so a total that looks too good can
 * be checked against the rows rather than taken on trust.
 */
function breakdownRow(item) {
  const detail = item.count
    ? `${item.count} × ${formatMoney(item.eachPence)}`
    : item.dailyPence ? `${formatMoney(item.dailyPence)} a day` : item.detail;
  return `<p><span>${esc(item.name)}${detail ? ` <small>${esc(detail)}</small>` : ""}</span><strong>${formatMoney(item.amountPence)}</strong></p>`;
}

function breakdownHalf(title, rows, totalPence, note) {
  return `<div class="breakdown-half">
    <h3>${esc(title)}<strong>${formatMoney(totalPence)}</strong></h3>
    ${rows.length ? rows.map(breakdownRow).join("") : `<p class="helper">Nothing here yet.</p>`}
    ${note ? `<p class="helper">${esc(note)}</p>` : ""}
  </div>`;
}

function breakdownSection(flow, breakdown) {
  return `<div class="breakdown">
    <p class="helper">In ${formatMoney(flow.incomePence)} less everything below is the planned saving of ${formatMoney(flow.savingsPence)}. Every line the month expects to pay is here, once.</p>
    ${breakdownHalf("Out of the bank", breakdown.cash, breakdown.cashTotalPence, "Cash monthlies and the monthly share of the annual bills. None of this touches the cards.")}
    ${breakdownHalf("On to the cards", breakdown.card, breakdown.cardTotalPence, "Card monthlies on their due date, every weekly slot, this month's planned, and the per diem — all of it expected on a card by month end.")}
  </div>`;
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
  const setAsides = setAsidesForMonth(hh, viewMonth);
  const otherSetAsideCount = setAsidesOutsideMonth(hh, viewMonth).length;
  const fromSavings = fromSavingsForMonth(hh, viewMonth);
  const otherFromSavingsCount = fromSavingsOutsideMonth(hh, viewMonth).length;
  const otherPlannedCount = oneOffsOutsideMonth(hh, viewMonth).length;
  const incomeLines = flow.incomeLines || [];

  // A household with nothing in it produced a full statement of em-dashes under
  // "on track to save £0.00", which is a confident answer to a question nobody
  // has asked yet. Say what the month needs instead.
  if (!householdHasData(hh)) {
    return shell({
      title: "Home.",
      lede: "Nothing in the household yet.",
      month: true,
      body: `
        <section class="block">
          ${sectionHead("Start here")}
          <p class="helper">Three things make a month. Add them in any order and Home fills itself in.</p>
          ${lineRow({ edit: "add-payslip", id: "start-payslip", title: "A payslip", detail: "Net pay that lands this month is the month's income", amount: `<span class="line-chevron" aria-hidden="true">›</span>` })}
          ${lineRow({ edit: "add-monthly", id: "start-monthly", title: "Your standing bills", detail: "Mortgage, council tax, subscriptions — cash or card", amount: `<span class="line-chevron" aria-hidden="true">›</span>` })}
          ${lineRow({ edit: "edit-per-diem", id: "start-perdiem", title: "The per diem", detail: "The month's spending money, as one figure", amount: `<span class="line-chevron" aria-hidden="true">›</span>` })}
        </section>
      `,
    });
  }

  return shell({
    title: "",
    month: true,
    extra: statementSection(flow),
    body: `
      ${homeAccordion("breakdown", "How this adds up", breakdownSection(flow, outBreakdownForMonth(hh, viewMonth, now)))}
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
        })).join("") : `<p class="helper">No exceptions in ${esc(period)}.</p>`}
        ${otherExceptionCount ? `<p class="helper">${otherExceptionCount} exception${otherExceptionCount === 1 ? "" : "s"} in other months.</p>` : ""}
        <button class="text-button" type="button" data-action="add-exception">Add an exception</button>
      `)}
      ${homeAccordion("fromsavings", `From savings · ${period}`, `
        <p class="helper">Money drawn in from savings to cover the month. Every exception is already money out of another pot, so ${exceptions.length ? `the ${formatMoney(exceptionsTotalPence(hh, viewMonth))} of exceptions is` : "any exception is"} carried here on its own. Add to it when the month needs more than the pay covers.</p>
        ${fromSavings.length ? fromSavings.map((item) => lineRow({
          edit: "edit-fromsavings",
          id: item.id,
          title: item.name,
          detail: "Drawn in on top of the exceptions",
          amount: formatMoney(item.amountPence),
          removeAction: "remove-fromsavings",
          removeLabel: "Delete",
        })).join("") : `<p class="helper">Nothing extra drawn in for ${esc(period)}.</p>`}
        ${otherFromSavingsCount ? `<p class="helper">${otherFromSavingsCount} in other months.</p>` : ""}
        <button class="text-button" type="button" data-action="add-fromsavings">Draw in from savings</button>
      `)}
      ${homeAccordion("setasides", `Don't spend this · ${period}`, `
        <p class="helper">Money you have decided not to spend. The cards are allowed to carry this much less, so holding it is what turns it into a saving. It does not change the plan or what you are owed.</p>
        ${setAsides.length ? setAsides.map((item) => lineRow({
          edit: "edit-setaside",
          id: item.id,
          title: item.name,
          detail: "Kept off the cards",
          amount: formatMoney(item.amountPence),
          removeAction: "remove-setaside",
          removeLabel: "Delete",
        })).join("") : `<p class="helper">Nothing held back in ${esc(period)}.</p>`}
        ${otherSetAsideCount ? `<p class="helper">${otherSetAsideCount} in other months.</p>` : ""}
        <button class="text-button" type="button" data-action="add-setaside">Hold something back</button>
      `)}
      ${homeAccordion("weeklies", "Weeklies", `
        ${weeklySlots.length ? weeklySlots.map((slot) => lineRow({
          edit: slot.adHoc ? "edit-weekly-extra" : "edit-weekly-rule",
          id: slot.adHoc ? slot.extraId : slot.ruleId,
          title: slot.name,
          detail: slot.adHoc
            ? `Extra in ${period}`
            : `${slot.date ? dateLabel(slot.date) : `Due the ${ordinalDay(slot.dueDay)}`}${slot.dueDay <= flow.dayOfMonth ? "" : " · not yet allowed"}`,
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
          detail: `${oneOffPaidFrom(item) === "cash" ? "Cash" : oneOffDueLabel(item).replace("Planned", "Card")} · ${item.purchased ? "Bought" : "not bought yet"}`,
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
    title: "Weeklies.",
    lede: "The rules that make the slots. Tick the slots on Home.",
    help: "Enter a food shop once — every week on a chosen weekday, so four Tuesdays in the month on screen means four slots. Each slot falls due on its own date, and the cards are allowed to be carrying it from that day whether or not it has been ticked. A rule set to N times a month spreads its slots evenly across the month instead.",
    month: true,
    body: `
      <section class="block">
        ${sectionHead("Rules", "add-weekly-rule", "Add")}
        ${weeklyRulesOf(hh).length ? weeklyRulesOf(hh).map((rule) => lineRow({
          edit: "edit-weekly-rule",
          id: rule.id,
          title: rule.name,
          // The date is what allows a slot on the cards now, so a rule says
          // which days of the month on screen it lands on.
          detail: `${weeklyCadenceLabel(rule)} · ${dueDaysLabel(rule)}`,
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
  const perDiemPence = perDiemTotalPence(hh);
  const dailyPence = perDiemDailyPence(hh, viewMonth);
  return shell({
    title: "Monthlies.",
    lede: "Standing bills, and the month's spending money.",
    help: "Name, amount, and due day, on the calendar day or rolled to the next working day. These are config — they are not ticked. Cash lines and card lines both count in Out for the whole month on screen. Cash lines do not move the card allowance. Card lines do, on the due date.",
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
        ${sectionHead("Per diem", "edit-per-diem", perDiemPence ? "Change" : "Set")}
        <p class="helper">The month's spending money as one figure. It is divided by the ${daysInMonthKey(viewMonth)} days in ${esc(monthName(viewMonth))} to give a daily rate, and the days gone by decide how much of it the cards are allowed to carry so far.</p>
        ${perDiemPence ? lineRow({
          edit: "edit-per-diem",
          id: "per-diem",
          title: `${formatMoney(perDiemPence)} a month`,
          detail: `${formatMoney(dailyPence)} a day · ${formatMoney(perDiemSoFarPence(hh, viewMonth))} allowed by day ${proRateDay(viewMonth)}`,
          amount: formatMoney(perDiemPence),
        }) : emptyLines("No per diem set. Put the whole month's spending money in and the app spreads it over the days.", "edit-per-diem", "Set the per diem")}
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
  return shell({
    title: "Planned.",
    lede: `One-offs for ${monthLabel(viewMonth)} and the months ahead.`,
    help: "A planned one-off is planned for a month rather than for a day of it, so the whole month is when it may be bought: it is in Out, and allowed on the cards, from the first. Ticking it records that it has landed.",
    month: true,
    body: `
      <section class="block">
        ${sectionHead(monthLabel(viewMonth), "add-oneoff", "Add")}
        ${thisMonth.length ? thisMonth.map(oneOffRow).join("") : emptyLines(`Nothing planned for ${monthLabel(viewMonth)}.`)}
      </section>
      ${plannedByMonthTable(hh)}
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
    ${sectionHead("Every month ahead")}
    <p class="helper">Tap a month to open it. Its items are listed at the top.</p>
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
  </section>`;
}

function oneOffRow(item) {
  return lineRow({
    edit: "edit-oneoff",
    id: item.id,
    title: item.name,
    // The section heading is already the month, so the row says the things the
    // heading cannot: which side it comes out of, and whether it has landed.
    detail: `${oneOffPaidFrom(item) === "cash" ? "Cash" : oneOffDueLabel(item).replace("Planned", "Card")} · ${item.purchased ? "Bought" : "not bought yet"}`,
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
    title: "Annual.",
    lede: "Once-a-year bills, saved for monthly.",
    help: "Renewals and once-a-year bills. Home carries the total divided by 12 as a cash line in Out every month. Edit a line here and Home updates.",
    back: "",
    extra: items.length ? `<div class="dash single"><div class="stat"><span>Saved each month</span><strong>${formatMoney(reserve)}</strong></div></div>` : "",
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
    title: "Pots.",
    lede: "What you hold today, and pension names.",
    help: "Named pots and today’s figure, logged month by month so the line can be drawn. Pensions are names and status only — no policy or NI numbers.",
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
    title: "Payslips.",
    lede: "Net pay per person, per pay period.",
    help: "The month on the slip stays the month on the slip. Net pay that lands in a cashflow month is the income on Home. Type the net your payslip prints and the app works out how the slip is written.",
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
            // Net is the figure the month is actually built on, so it is the
            // one in the amount column; gross moves into the detail line.
            detail: payslipSaysNothing(slip)
              ? `${confirmed ? "Confirmed" : "Forecast"} · lands ${labels.lands} · nothing to work a net out from — add the net it prints`
              : payslipIsNetOnly(slip)
                ? `${confirmed ? "Confirmed" : "Forecast"} · lands ${labels.lands} · net only, no detail yet`
                : `${confirmed ? "Confirmed" : "Forecast"} · lands ${labels.lands} · gross ${formatMoney(slip.grossPence || slip.salaryPence)}${payslipNetCheck(slip)?.matches === false ? " · does not match the slip" : ""}`,
            amount: formatMoney(payslipNetAsReadPence(slip)),
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
    title: "£100k.",
    lede: "Adjusted net income against the childcare cliff.",
    help: "Stay at or under £100,000 adjusted net income. YTD and the projection come from payslips. Grossed-up Gift Aid from giving in this tax year comes off automatically.",
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
        <p class="helper">${result.confirmedCount} confirmed month${result.confirmedCount === 1 ? "" : "s"}, ${result.remainingMonths} remaining at ${formatMoney(result.lastMonthlyPence)} each. Forecast rows are not counted. Grossed-up Gift Aid taken off: ${formatMoney(result.giftAidReliefPence)}.${result.netOnlyCount ? ` ${result.netOnlyCount} slip${result.netOnlyCount === 1 ? " has" : "s have"} only a net typed, so ${result.netOnlyCount === 1 ? "it is" : "they are"} not in this figure — add the gross to count ${result.netOnlyCount === 1 ? "it" : "them"}.` : ""}</p>
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
    title: "Giving.",
    lede: "Donations, and the Gift Aid on them.",
    help: "Who, charity, date, amount, Gift Aid. Gross is 25% extra when Gift Aid is on. Tax year follows 6 April. Gift Aid in a tax year feeds the £100k helper.",
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
    title: "More.",
    lede: "The rooms you visit now and then, and your account.",
    body: `
      <section class="block">
        ${sectionHead("Rooms")}
        ${MORE_ROOMS.map(([route, label, what]) => lineRow({
          edit: "go-room",
          id: route,
          title: label,
          detail: what,
          amount: "<span class=\"line-chevron\" aria-hidden=\"true\">›</span>",
        })).join("")}
      </section>
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
        ${sectionHead("People", "add-person", "Add")}
        ${household().people.map((person) => lineRow({
          edit: "edit-person",
          id: person.id,
          title: person.name,
          detail: "Rename this person",
          amount: "",
        })).join("")}
      </section>
      <section class="block">
        ${sectionHead("Payslip categories", "add-payslip-category-master", "Add")}
        <p class="helper">The slip’s column set. Pick these and type the amount when you enter a payslip.</p>
        <details class="room-help">
          <summary>${categories.length} categor${categories.length === 1 ? "y" : "ies"}</summary>
          ${categories.length ? categories.map((item) => lineRow({
            edit: "edit-payslip-category",
            id: item.id,
            title: item.label,
            detail: payslipKindLabel(item.kind),
            amount: "",
          })).join("") : emptyLines("The usual slip columns live here. Add another if a new one appears.", "add-payslip-category-master", "Add a category")}
        </details>
      </section>
    `,
  });
}

function payslipKindLabel(kind) {
  return {
    bonus: "Paid, and taxed",
    benefits: "Taxed; paid or not is read off your net",
    extra: "Paid, adds to net",
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
    <header class="topbar"><a class="wordmark" href="#/home" data-action="go" data-screen="home">TAB</a><span></span><span class="topbar-end">${syncChip()}<button class="text-button" data-action="add-friend">Add friend</button></span></header>
    <div class="intro compact"><h1>Tabs.</h1><p class="lede">Shared costs with friends, without the maths.</p></div>
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
      <span class="topbar-end">${syncChip()}<button class="text-button" data-action="edit-friend" data-id="${friend.id}">Edit</button></span>
    </header>
    <section class="friend-hero">
      <h1>${esc(friend.name)}</h1>
      ${friend.email ? `<p class="lede">${esc(friend.email)}</p>` : ""}
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

/**
 * The running total after this entry. It used to repeat the row's own sentence
 * word for word — "Ben owes you £42.00" beside "Ben owes £42.00" — so the two
 * read as the same fact twice rather than as an entry and where it left things.
 */
function runningBalanceLabel(balancePence) {
  if (!balancePence) return "square";
  return `runs to ${formatMoney(Math.abs(balancePence))}`;
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
    <div class="transaction-side"><strong>${formatMoney(transaction.amountPence)}</strong><small class="${signedBalanceClass(balancePence)}">${esc(runningBalanceLabel(balancePence))}</small></div>
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
    "per-diem": perDiemForm,
    "payslip-category": payslipCategoryForm,
    oneoff: oneOffForm,
    exception: exceptionForm,
    setaside: setAsideForm,
    fromsavings: fromSavingsForm,
    annual: annualForm,
    pot: potForm,
    pension: pensionForm,
    payslip: payslipForm,
    donation: donationForm,
  };
  return kinds[modal.kind] ? kinds[modal.kind]() : "";
}

/**
 * One title, the way a room has one. Every sheet led with an eyebrow that said
 * the same thing as the title underneath it — "NEW MONTHLY" over "Add a
 * monthly" — which is a line of furniture per modal saying nothing.
 */
function modalHead(title) {
  return `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="close" data-action="close-modal" aria-label="Close">×</button></div>`;
}

/**
 * The rules behind a field, folded away. A form's explanation is read once and
 * then re-read every time the sheet opens; the rooms already fold theirs, so
 * the sheets do it the same way rather than stacking paragraphs above the
 * submit button.
 */
function formHelp(html) {
  return `<details class="room-help form-help"><summary>How this works</summary><p>${html}</p></details>`;
}

/**
 * `optional` marks a field you can leave out. It is separate from `required`
 * because one field is neither: the net can carry a slip on its own, so calling
 * it optional undersells it, but requiring it would block a slip built from its
 * gross and deductions instead.
 */
function moneyLabel(label, name, pence, { required = false, optional = !required, placeholder = "0.00" } = {}) {
  return `<label>${esc(label)}${optional ? ' <span class="optional">optional</span>' : ""}${moneyControl({ name, pence, required, placeholder })}</label>`;
}

function friendForm() {
  const friend = modal.friend || {};
  return `<form id="friend-form">${modalHead(friend.id ? "Edit friend" : "Add a friend")}
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
  return `<form id="transaction-form">${modalHead(isExpense ? "Add expense" : "Record transfer")}
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
  return `<div class="delete-confirm">${modalHead(`${clearingPending ? "Clear" : "Delete"} ${modal.label || (modal.target === "friend" ? "friend and history" : "this entry")}?`)}
    <p>${esc(modal.copy || (modal.target === "friend" ? "This will permanently remove this friend and every transaction in their tab." : "This cannot be undone."))}</p>
    <div class="confirm-actions"><button class="secondary" data-action="close-modal">Keep it</button><button class="danger" data-action="delete-confirmed">${clearingPending ? "Clear" : "Delete"}</button></div></div>`;
}

function importForm() {
  return `<div class="delete-confirm">${modalHead("Import the old local tab?")}
    <p>This browser still has friends and expenses from before Tab saved to a private gist. Import them once, then they leave this device.</p>
    <div class="confirm-actions">
      <button class="secondary" data-action="discard-local">Leave them</button>
      <button class="primary" data-action="import-local">Import</button>
    </div></div>`;
}

function personForm() {
  const person = modal.person || {};
  return `<form id="person-form">${modalHead(person.id ? "Edit name" : "Add a person")}
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
  return `<form id="monthly-form">${modalHead(item.id ? "Edit monthly" : "Add a monthly")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Phone, mortgage…" /></label>
    ${moneyLabel("Expected amount", "amount", item.amountPence)}
    <label>Due<select name="dueRoll">
      <option value="calendar" ${dueRoll === "calendar" ? "selected" : ""}>On this calendar day</option>
      <option value="nextWorking" ${dueRoll === "nextWorking" ? "selected" : ""}>This day, or the next working day if it is a weekend</option>
    </select></label>
    <label data-due-day>Day of month<input type="number" name="dueDay" min="1" max="31" value="${dueDayOf(item) || 1}" /></label>

    <label>Paid from<select name="paidFrom">
      <option value="card" ${item.paidFrom !== "cash" ? "selected" : ""}>Card — due date only, not ticked</option>
      <option value="cash" ${item.paidFrom === "cash" ? "selected" : ""}>Cash — standing out for the whole month</option>
    </select></label>
    ${formHelp("For the first working day of the month, pick day 1 with the next-working-day rule — that is the same thing. UK weekdays are Monday to Friday. Cash and card lines count in Out for the whole viewed month, and there is nothing to tick.")}
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
  return `<form id="weekly-rule-form">${modalHead(item.id ? "Edit rule" : "Add a rule")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Food shop, Amazon, cat litter…" /></label>
    ${moneyLabel("Typical amount", "amount", item.amountPence, { required: true })}
    <label>Cadence<select name="cadence" data-action="weekly-cadence">
      ${WEEKLY_CADENCE_OPTIONS.map((option) => `<option value="${option.value}" ${cadence.cadence === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
    </select></label>
    <label data-weekly-field="weekday" class="${cadence.cadence === "weekday" ? "" : "hidden"}">Weekday<select name="weekday">${WEEKDAYS.map((day) => `<option value="${day.value}" ${Number(item.weekday || 2) === day.value ? "selected" : ""}>${day.label}</option>`).join("")}</select></label>
    <label data-weekly-field="times" class="${cadence.cadence === "times" ? "" : "hidden"}">Times a month<input type="number" name="timesPerMonth" min="1" max="12" value="${cadence.timesPerMonth || 1}" /></label>
    ${formHelp("N times a month with N=1 is once a month, and its slots are spread evenly across the month. Every week on a chosen weekday makes one slot for each of that day in the month on screen. Each slot is allowed on the cards from its own date. Ticks stay on that month; a new month starts unticked.")}
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save rule" : "Add rule"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-weekly-rule">Delete rule</button>' : ""}
  </form>`;
}

function weeklyExtraForm() {
  const item = modal.item || {};
  return `<form id="weekly-extra-form">${modalHead(item.id ? "Edit extra" : "Add an extra")}
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
  return `<form id="card-form">${modalHead(item.id ? "Update card" : "Add a card")}
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
  return `<form id="sub-form">${modalHead(item.id ? "Edit subscription" : "Add a subscription")}
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
  return `<form id="pending-form">${modalHead(item.id ? "Edit pending" : "Add pending")}
    <label>Amount${moneyControl({ name: "amount", value: signedFieldValue(item.amountPence), placeholder: "0.00 or -0.00" })}</label>
    <p class="helper">A refund or a credit on the statement goes in as a minus, so it comes off the card side.</p>
    <label>Note <span class="optional">optional</span><input maxlength="80" name="note" value="${esc(item.note || item.name || "")}" placeholder="Optional" /></label>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save pending" : "Add pending"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-pending">Delete pending</button>' : ""}
  </form>`;
}

function perDiemForm() {
  const hh = household();
  const pence = perDiemTotalPence(hh);
  const days = daysInMonthKey(viewMonth);
  return `<form id="per-diem-form">${modalHead(pence ? "Change the per diem" : "Set the per diem")}
    ${moneyLabel("Whole month", "amount", pence, { required: true })}
    <p class="helper">Over ${days} days in ${esc(monthName(viewMonth))} that is <strong data-per-diem-rate>${formatMoney(days ? Math.round(pence / days) : 0)}</strong> a day.</p>
    ${formHelp("The cards are allowed a day of it for every day gone by — on the 10th of a 30-day month, a third. It is spent on the cards, so it sits on the card side of Out. Standing costs that leave the bank — a cleaner, nails — belong in Monthlies as cash lines.")}
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">Save per diem</button>
  </form>`;
}

function payslipCategoryForm() {
  const item = modal.item || {};
  const kind = item.kind || "deduction";
  return `<form id="payslip-category-form">${modalHead(item.id ? "Edit category" : "Add a category")}
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
  const paidFrom = oneOffPaidFrom(item);
  return `<form id="oneoff-form">${modalHead(item.id ? "Edit one-off" : "Add a one-off")}
    <label>Item<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="MOT, sofa, flight…" /></label>
    <label>Month<input required type="month" name="month" value="${item.month || viewMonth}" /></label>
    ${moneyLabel("Estimate", "amount", item.estimatePence)}
    <label>Paid from<select name="paidFrom" data-action="oneoff-paid-from">
      <option value="card" ${paidFrom === "card" ? "selected" : ""}>A card</option>
      <option value="cash" ${paidFrom === "cash" ? "selected" : ""}>Cash — straight out of the bank</option>
    </select></label>
    <label data-oneoff-field="dueDay" class="${paidFrom === "card" ? "" : "hidden"}">Due day <span class="optional">optional</span><input type="number" name="dueDay" min="1" max="31" value="${item.dueDay || ""}" placeholder="Any day" /></label>
    <label class="check-row"><input type="checkbox" name="purchased" ${item.purchased ? "checked" : ""} /><span>Bought</span></label>
    ${formHelp("A cash one leaves the bank with the rest of the cash out and never touches what the cards are allowed to carry. A card one does, and a due day says from when — leave it blank and the whole month is when it may be bought.")}
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save one-off" : "Add one-off"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-oneoff">Delete one-off</button>' : ""}
  </form>`;
}

function exceptionForm() {
  const item = modal.item || {};
  return `<form id="exception-form">${modalHead(item.id ? "Edit exception" : "Add an exception")}
    <label>What<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Travel insurance, school trip…" /></label>
    <label>Month<input required type="month" name="month" value="${item.month || viewMonth}" /></label>
    ${moneyLabel("Amount", "amount", item.amountPence, { required: true })}
    ${formHelp("This came from another pot, so the card is allowed to be this much higher without it reading as overspend. It never moves Savings.")}
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save exception" : "Add exception"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-exception">Delete exception</button>' : ""}
  </form>`;
}

function fromSavingsForm() {
  const item = modal.item || {};
  return `<form id="fromsavings-form">${modalHead(item.id ? "Edit what is drawn in" : "Draw in from savings")}
    <label>What for<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Cover the shortfall, new boiler…" /></label>
    <label>Month<input required type="month" name="month" value="${item.month || viewMonth}" /></label>
    ${moneyLabel("Amount", "amount", item.amountPence, { required: true })}
    ${formHelp("This is on top of the month's exceptions, which are money out of another pot already and are carried in for you. Drawing in from savings raises what the month ends up with — it does not raise what the cards are allowed to carry.")}
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save" : "Draw it in"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-fromsavings">Delete</button>' : ""}
  </form>`;
}

function setAsideForm() {
  const item = modal.item || {};
  return `<form id="setaside-form">${modalHead(item.id ? "Edit what is held back" : "Don't spend this")}
    <label>What for<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Car service, last month was dear…" /></label>
    <label>Month<input required type="month" name="month" value="${item.month || viewMonth}" /></label>
    ${moneyLabel("Amount", "amount", item.amountPence, { required: true })}
    ${formHelp("The cards are allowed to carry this much less for the month. Nothing is spent and the plan does not move — hold it and the month comes in under, which is the saving.")}
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save" : "Hold it back"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-setaside">Delete</button>' : ""}
  </form>`;
}

function annualForm() {
  const item = modal.item || {};
  return `<form id="annual-form">${modalHead(item.id ? "Edit annual bill" : "Add an annual bill")}
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
  return `<form id="pot-form">${modalHead(item.id ? "Update pot" : "Add a pot")}
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
  return `<form id="pension-form">${modalHead(item.id ? "Edit pension" : "Add a pension name")}
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
  // A new slip opens on the month you are looking at, because that is the month
  // the money arrives in and the month the household spends it in. The period
  // it covers is read off the person's last slip.
  const previous = previousPayslipForPerson(household(), personId, item.periodMonth || "");
  const months = item.id
    ? { moneyLandsMonth: item.moneyLandsMonth || item.periodMonth || viewMonth, periodMonth: item.periodMonth || viewMonth }
    : payslipMonthsForNewSlip(household(), personId, viewMonth);
  const available = unusedMasterPayslipCategories(categories, masterPayslipCategories(household()));
  const live = livePayslipFromForm(item, categories);
  return `<form id="payslip-form">${modalHead(item.id ? "Edit payslip" : "Add a payslip")}
    <label>Person<select name="personId" required data-action="payslip-person">${household().people.map((person) => `<option value="${person.id}" ${person.id === personId ? "selected" : ""}>${esc(person.name)}</option>`).join("")}</select></label>
    <label>Tax year<select name="taxYear">${taxYearOptionsFor(item.taxYear).map((year) => `<option value="${year}" ${year === (item.taxYear || currentUkTaxYear()) ? "selected" : ""}>${year}</option>`).join("")}</select></label>
    <label>Month the money lands<input required type="month" name="moneyLandsMonth" value="${months.moneyLandsMonth}" /></label>
    <label>Pay period<input required type="month" name="periodMonth" value="${months.periodMonth}" /></label>
    ${moneyLabel("Net pay", "statedNet", item.statedNetPence, { optional: false })}
    <p class="helper">The figure the payslip prints. Type just this and the month is right — the rest of the slip can follow whenever.</p>
    ${previous ? `<div class="fill-last">
      <button class="secondary wide" type="button" data-action="fill-payslip-from-last">Fill from ${esc(monthLabel(previous.periodMonth))}</button>
      <p class="helper">That slip's net was ${formatMoney(payslipNetAsReadPence(previous))}. Only empty boxes are filled — anything you have typed is left alone.</p>
    </div>` : ""}
    ${moneyLabel("Salary", "salary", item.salaryPence)}
    ${moneyLabel("Gross", "gross", item.grossPence)}
    ${formHelp("Gross is the Payments total on the slip — basic, bonus, and any parental pay — after any salary sacrifice has come off. Tax and NI go in Categories below. If your slip writes it another way, type the net it prints under Net and the app works out how to read it.")}
    <input type="hidden" name="grossBeforeSacrifice" value="${item.grossBeforeSacrifice ? "on" : ""}" />
    <input type="hidden" name="grossExcludesBonus" value="${item.grossExcludesBonus ? "on" : ""}" />
    <input type="hidden" name="benefitsPaid" value="${item.benefitsPaid ? "on" : ""}" />
    <section class="payslip-cats">
      <h3>Categories</h3>
      <p class="helper">Pick a category and enter the amount. Net is calculated. Category names live under More.</p>
      ${categories.length ? categories.map((category) => payslipCategoryField(category, item)).join("") : `<p class="helper">No categories on this slip yet.</p>`}
      ${available.length ? `<label>Add a category
        <select data-action="add-payslip-category">
          <option value="">Choose…</option>
          ${available.map((category) => `<option value="${esc(category.id)}">${esc(category.label)}</option>`).join("")}
        </select>
      </label>` : `<p class="helper">Every category is already on this slip.</p>`}
    </section>
    ${payslipNetBlock(live)}
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
  // With no gross there is no arithmetic to show, and the check would report
  // the whole net as a shortfall — a mismatch against nothing. Say what the
  // slip is worth instead, and what would turn it into a working slip.
  if (payslipIsNetOnly(live)) {
    return `<div class="payslip-net" data-payslip-net-block>
      <p class="payslip-net-line total"><span>Net</span><strong data-payslip-net>${formatMoney(live.statedNetPence)}</strong></p>
      <p class="payslip-net-check ok">Taken from the slip. Add the gross and the deductions whenever, and they get checked against it.</p>
    </div>`;
  }
  const check = payslipNetCheck(live);
  const resolved = resolvedPayslipReading(live);
  const hints = payslipNetHints(live);
  return `<div class="payslip-net" data-payslip-net-block>
    <p class="payslip-net-line"><span>Gross paid</span><strong>${formatMoney(payslipGrossPaidPence(live))}</strong></p>
    <p class="payslip-net-line"><span>Deductions</span><strong>−${formatMoney(payslipDeductionsPence(live))}</strong></p>
    <p class="payslip-net-line total"><span>Net</span><strong data-payslip-net>${formatMoney(payslipNetPence(live))}</strong></p>
    ${check
      ? (check.matches
        ? `<p class="payslip-net-check ok">Matches the net on the slip.${resolved ? ` Read as: ${esc(payslipReadingSummary(resolved))}` : ""}</p>`
        : `<p class="payslip-net-check off">${esc(`${formatMoney(Math.abs(check.differencePence))} ${check.differencePence > 0 ? "more" : "less"} than the ${formatMoney(check.statedPence)} on the slip.`)}</p>
           ${hints.map((hint) => `<p class="payslip-net-hint">${esc(hint)}</p>`).join("")}`)
      : ""}
    ${payslipReadings(live)}
  </div>`;
}

/**
 * The payslip prints its net, so typing that one figure settles how gross is
 * written and whether a benefit is money — no category to choose, no
 * convention to learn. The list of readings is the fallback for when the typed
 * net matches nothing, or matches more than one thing.
 */
function payslipReadings(live) {
  if (resolvedPayslipReading(live)) return "";
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
    <span class="payslip-cat-name">${esc(category.label)}<small>${esc(payslipKindLabel(category.kind))}</small></span>
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
    benefitsPaid: data.get("benefitsPaid") === "on",
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
    benefitsPaid: Boolean(slip?.benefitsPaid),
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
  return `<form id="donation-form">${modalHead(item.id ? "Edit donation" : "Add a donation")}
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
  // More's list navigates by row, and a row carries data-id rather than
  // data-screen, so it gets its own action instead of bending the row shape.
  if (action === "go-room" && MORE_ROOMS.some(([route]) => route === id)) {
    event.preventDefault();
    closeModal();
    setScreen({ name: id });
  }
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
  if (action === "edit-per-diem") openItem("per-diem");
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
  if (action === "add-setaside") openItem("setaside");
  if (action === "edit-setaside") openItem("setaside", "setAsides", id);
  if (action === "add-fromsavings") openItem("fromsavings");
  if (action === "edit-fromsavings") openItem("fromsavings", "fromSavings", id);
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
  if (action === "remove-setaside") {
    event.preventDefault();
    event.stopPropagation();
    removeListedItem("setAsides", id, "held-back amount");
  }
  if (action === "remove-fromsavings") {
    event.preventDefault();
    event.stopPropagation();
    removeListedItem("fromSavings", id, "transfer in");
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
  if (action === "confirm-delete-payslip-category") askDelete("payslip-category", modal.item.id, "this category");
  if (action === "confirm-delete-sub") askDelete("sub", modal.item.id, "this subscription");
  if (action === "confirm-delete-oneoff") askDelete("oneoff", modal.item.id, "this one-off");
  if (action === "confirm-delete-exception") askDelete("exception", modal.item.id, "this exception");
  if (action === "confirm-delete-setaside") askDelete("setaside", modal.item.id, "this held-back amount");
  if (action === "confirm-delete-fromsavings") askDelete("fromsavings", modal.item.id, "this transfer in");
  if (action === "confirm-delete-annual") askDelete("annual", modal.item.id, "this annual bill");
  if (action === "confirm-delete-pot") askDelete("pot", modal.item.id, "this pot");
  if (action === "confirm-delete-pension") askDelete("pension", modal.item.id, "this pension name");
  if (action === "fill-payslip-from-last") {
    snapshotPayslipForm();
    const current = modal.payslip || {};
    const last = previousPayslipForPerson(household(), current.personId, current.periodMonth || "");
    if (!last) return;
    // Any category last month used has to be on the form before its amount can
    // land in it, so the two lists are merged first.
    const merged = keepPayslipFormRows([
      ...(modal.slipCategories || []),
      ...usedPayslipCategories(last, masterPayslipCategories(household())),
    ]);
    const { fills } = payslipFillFromPrevious(current, last, merged);
    modal.slipCategories = merged;
    modal.payslip = payslipWithFills(current, fills);
    renderModal();
    showToast(fills.length
      ? `Filled ${fills.length} ${fills.length === 1 ? "box" : "boxes"} from ${monthLabel(last.periodMonth)}`
      : "Nothing left to fill");
    return;
  }
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
      if (targetModal.target === "payslip-category") {
        hh.payslipCategories = masterPayslipCategories(hh).filter((item) => item.id !== targetModal.id);
      }
      if (targetModal.target === "sub") hh.cardSubs = hh.cardSubs.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "oneoff") hh.oneOffs = hh.oneOffs.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "exception") hh.exceptions = (hh.exceptions || []).filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "setaside") hh.setAsides = (hh.setAsides || []).filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "fromsavings") hh.fromSavings = (hh.fromSavings || []).filter((item) => item.id !== targetModal.id);
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
  if (action === "oneoff-paid-from") {
    // A due day only has anywhere to be used on a card line.
    document.querySelector("[data-oneoff-field=dueDay]")?.classList.toggle("hidden", event.target.value !== "card");
  }
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
    "per-diem-form": savePerDiem,
    "payslip-category-form": savePayslipCategory,
    "home-card-form": saveHomeCard,
    "oneoff-form": saveOneOff,
    "exception-form": saveException,
    "setaside-form": saveSetAside,
    "fromsavings-form": saveFromSavings,
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
  if (event.target.closest("#per-diem-form")) updatePerDiemRate();
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
        ...(data.get("paidFrom") === "cash" || data.get("paidFrom") === "card"
        ? { paidFrom: data.get("paidFrom") }
        : {}),
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

async function savePerDiem(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  let amountPence;
  try {
    amountPence = requireMoney(data.get("amount"), "amount");
  } catch (error) {
    return showFormError(error.message);
  }
  setBusy(event.target, true);
  const saved = await withStoreUpdate(() => {
    household().perDiem = { amountPence };
  });
  if (!saved) {
    showFormError(sync.message || "Could not save.");
    setBusy(event.target, false);
    return;
  }
  closeModal();
  showToast("Per diem saved");
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

function oneOffDueDay(value) {
  const day = Number(String(value || "").trim());
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : undefined;
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
      paidFrom: data.get("paidFrom") === "cash" ? "cash" : "card",
      // A day is kept only where it can do something, so switching a line to
      // cash does not leave a date behind that nothing reads.
      dueDay: data.get("paidFrom") === "cash" ? undefined : oneOffDueDay(data.get("dueDay")),
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

async function saveFromSavings(event) {
  return saveNamedMoney(event, {
    list: "fromSavings",
    toastAdd: "Drawn in",
    toastEdit: "Updated",
    build: (data) => ({
      name: requireName(data.get("name"), "reason"),
      month: coerceMonthKey(data.get("month")) || viewMonth,
      amountPence: requireMoney(data.get("amount"), "amount"),
    }),
  });
}

async function saveSetAside(event) {
  return saveNamedMoney(event, {
    list: "setAsides",
    toastAdd: "Held back",
    toastEdit: "Updated",
    build: (data) => ({
      name: requireName(data.get("name"), "reason"),
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
    benefitsPaid: data.get("benefitsPaid") === "on",
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
    benefitsPaid: data.get("benefitsPaid") === "on",
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
    // Without this the net was dropped on every re-render, so adding a category
    // after typing the slip's own net quietly threw the net away.
    statedNetPence: readMoney("statedNet"),
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

/** The daily rate as the figure is typed, so the month's amount can be aimed. */
function updatePerDiemRate() {
  const target = document.querySelector("[data-per-diem-rate]");
  if (!target) return;
  const form = document.querySelector("#per-diem-form");
  const days = daysInMonthKey(viewMonth);
  const pence = parseMoneyAllowZero(form?.elements?.amount?.value);
  target.textContent = formatMoney(pence && days ? Math.round(pence / days) : 0);
}

function updatePayslipNet() {
  const block = document.querySelector("[data-payslip-net-block]");
  if (!block) return;
  const form = document.querySelector("#payslip-form");
  let live = livePayslipFromForm(modal?.payslip || {}, modal?.slipCategories || []);
  const resolved = resolvedPayslipReading(live);
  if (form && resolved && !resolved.current) {
    form.elements.grossBeforeSacrifice.value = resolved.grossBeforeSacrifice ? "on" : "";
    form.elements.grossExcludesBonus.value = resolved.grossExcludesBonus ? "on" : "";
    form.elements.benefitsPaid.value = resolved.benefitsPaid ? "on" : "";
    live = livePayslipFromForm(modal?.payslip || {}, modal?.slipCategories || []);
  }
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
