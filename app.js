import { balanceFor, balanceText, formatMoney, parseMoneyToPence, runningBalances, splitExpense } from "./calculations.js";
import { createGistStore, GistError } from "./gist-store.js";
import {
  addMonths,
  aniProjection,
  ANI_LIMIT_PENCE,
  cashflowForMonth,
  currentUkTaxYear,
  householdHasData,
  donationGrossPence,
  emptyHousehold,
  giftAidGrossPence,
  happenedInMonth,
  monthKey,
  monthLabel,
  ordinalDay,
  paidInMonth,
  payslipIsConfirmed,
  resetMonthTicks,
  savingLine,
  PENSION_STATUSES,
  spendVerdict,
  taxYearOptions,
  ukTaxYearFromDate,
} from "./household.js";
import { applyHouseholdImport, householdFromWorkbook, importHasData, reportLines } from "./workbook-import.js";
import { createSession } from "./session.js";
import { emptyStore, parseStore } from "./store.js";
import { readXlsx } from "./xlsx.js";

const LOCAL_KEY = "tab.personal.v1";
const SCREENS = ["home", "planned", "annual", "pots", "payslips", "ani", "giving", "more", "tabs"];
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
let isSaving = false;
let localImportOffered = false;
let localSession = false;
let viewMonth = monthKey();
let aniPersonId = null;
let aniTaxYear = null;
let payslipTaxYear = null;

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
  try {
    const payload = await gist.write(store, gistId);
    store = payload.store;
    gistId = payload.gistId;
    sync = { name: "saved" };
    updateSyncChip();
  } catch (error) {
    sync = { name: "error", message: error.message };
    updateSyncChip();
    throw error;
  }
}

async function withStoreUpdate(mutator) {
  if (isSaving) return false;
  isSaving = true;
  const previous = structuredClone(store);
  try {
    mutator();
    await persist();
    return true;
  } catch {
    store = previous;
    return false;
  } finally {
    isSaving = false;
  }
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
        <input id="github-user" name="username" value="hoffbrandm" autocomplete="username" class="visually-hidden" />
        <label>GitHub token
          <input type="password" name="token" required autocomplete="current-password" spellcheck="false" />
        </label>
        <p class="helper">Use a fine-grained token with <strong>Gists: Read and write</strong> only. A password manager can remember it on your phone.</p>
        <p class="form-error" id="form-error"></p>
        <button class="primary wide" type="submit">Sign in</button>
      </form>
      <a class="text-button token-link" href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">Create a token on GitHub</a>
      ${isLocalHost() ? `<button class="secondary wide" type="button" data-action="local-workbook">Open a local workbook</button><p class="helper">This machine only. Nothing is written to a gist or to localStorage. Close the tab and it is gone.</p>` : ""}
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
    ${month ? monthSwitcher({ reset: month === "reset" }) : ""}
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

function monthSwitcher({ reset = false } = {}) {
  return `<div class="month-switch">
    <button type="button" class="month-nav" data-action="month-prev" aria-label="Previous month">‹</button>
    <div><strong>${esc(monthLabel(viewMonth))}</strong>${viewMonth === monthKey() ? "" : `<button type="button" class="text-button" data-action="month-now">This month</button>`}${reset ? `<button type="button" class="text-button" data-action="reset-month">Reset ticks</button>` : ""}</div>
    <button type="button" class="month-nav" data-action="month-next" aria-label="Next month">›</button>
  </div>`;
}

function dock() {
  const more = ["more", "annual", "pots", "payslips", "ani", "giving"].includes(screen.name);
  const item = (name, label, active) =>
    `<a class="dock-item${active ? " active" : ""}" href="#/${name}" data-action="go" data-screen="${name}">${label}</a>`;
  return `<nav class="dock" aria-label="App">
    ${item("home", "Home", screen.name === "home")}
    ${item("planned", "Planned", screen.name === "planned")}
    ${item("more", "More", more)}
    ${item("tabs", "Tabs", screen.name === "tabs" || screen.name === "friend")}
  </nav>`;
}

function sectionHead(title, action, addLabel) {
  return `<div class="section-heading"><h2>${esc(title)}</h2>${action ? `<button class="text-button" type="button" data-action="${action}">${esc(addLabel)}</button>` : ""}</div>`;
}

function lineRow({ edit, id, title, detail, amount, tickAction, ticked, tickLabel }) {
  return `<article class="line">
    ${tickAction ? `<button class="tick${ticked ? " on" : ""}" type="button" data-action="${tickAction}" data-id="${id}" aria-pressed="${ticked ? "true" : "false"}" aria-label="${esc(tickLabel || (ticked ? "Done" : "Not done"))}">${ticked ? "✓" : ""}</button>` : ""}
    <button class="line-main" type="button" data-action="${edit}" data-id="${id}">
      <span class="line-copy"><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}</span>
      <span class="line-amount">${amount}</span>
    </button>
  </article>`;
}

function emptyLines(text, action, label) {
  return `<div class="empty-lines"><p>${esc(text)}</p>${action ? `<button class="text-button" type="button" data-action="${action}">${esc(label)}</button>` : ""}</div>`;
}

function cashflowScreen() {
  const hh = household();
  const flow = cashflowForMonth(hh, viewMonth, new Date());
  const leftoverClass = flow.potPence < 0 ? "negative" : "neutral";
  const verdictClass = flow.overUnderPence < 0 ? "negative" : flow.overUnderPence > 0 ? "positive" : "neutral";

  return shell({
    eyebrow: "This month",
    title: "",
    month: "reset",
    extra: `<section class="friend-hero cash-hero">
        <p class="eyebrow">This month</p>
        <h1 class="${leftoverClass}">${formatMoney(flow.potPence)}</h1>
        <p class="balance-label">Left after monthly out</p>
        <p class="balance-value ${verdictClass}">${esc(spendVerdict(flow.overUnderPence, formatMoney))}</p>
        <p class="helper">${esc(savingLine(flow))} In ${formatMoney(flow.incomePence)} · Out ${formatMoney(flow.committedOutPence)} · Cards ${formatMoney(flow.cardBalancesPence)}${flow.pendingPence ? ` + pending ${formatMoney(flow.pendingPence)}` : ""}.</p>
      </section>`,
    body: `
      <section class="block">
        ${sectionHead("Income", "add-income", "Add")}
        ${hh.incomes.length ? hh.incomes.map((item) => lineRow({
          edit: "edit-income",
          id: item.id,
          title: item.label,
          detail: personById(item.personId)?.name || "",
          amount: formatMoney(item.amountPence),
        })).join("") : ""}
      </section>
      <section class="block">
        ${sectionHead("Monthly", "add-bill", "Add")}
        ${hh.bills.map((item) => lineRow({
          edit: "edit-bill",
          id: item.id,
          title: item.name,
          detail: `Due ${ordinalDay(item.dueDay)}`,
          amount: formatMoney(item.amountPence),
          tickAction: "toggle-bill",
          ticked: paidInMonth(item, viewMonth),
          tickLabel: paidInMonth(item, viewMonth) ? "Paid" : "Not paid",
        })).join("")}
      </section>
      <section class="block">
        ${sectionHead("Weekly", "add-envelope", "Add")}
        ${hh.envelopes.map((item) => {
          const happened = happenedInMonth(item, viewMonth);
          return lineRow({
            edit: "edit-envelope",
            id: item.id,
            title: item.name,
            detail: happened.length ? `${happened.length} this month` : "Tick when it happened",
            amount: formatMoney(item.weeklyPence),
            tickAction: "tick-envelope",
            ticked: viewMonth === monthKey() ? happened.includes(today()) : happened.includes(`${viewMonth}-01`),
            tickLabel: "This week happened",
          });
        }).join("")}
      </section>
      <section class="block">
        ${sectionHead("Cards", "add-card", "Add")}
        ${hh.cards.map((item) => lineRow({
          edit: "edit-card",
          id: item.id,
          title: item.name,
          detail: item.pendingPence ? `Pending ${formatMoney(item.pendingPence)}` : "Balance",
          amount: formatMoney(item.balancePence),
        })).join("")}
        ${hh.pendings.map((item) => lineRow({
          edit: "edit-pending",
          id: item.id,
          title: item.name,
          detail: "Pending",
          amount: formatMoney(item.amountPence),
        })).join("")}
        ${hh.cards.length || hh.pendings.length ? `<button class="text-button" type="button" data-action="add-pending">Add pending</button>` : ""}
      </section>
      ${hh.cardSubs.length ? `<section class="block">
        ${sectionHead("Card subs", "add-sub", "Add")}
        ${hh.cardSubs.map((item) => lineRow({
          edit: "edit-sub",
          id: item.id,
          title: item.name,
          detail: `Due ${ordinalDay(item.dueDay)}`,
          amount: formatMoney(item.amountPence),
          tickAction: "toggle-sub",
          ticked: paidInMonth(item, viewMonth),
          tickLabel: paidInMonth(item, viewMonth) ? "Allowed" : "Not yet",
        })).join("")}
      </section>` : `<section class="block">${sectionHead("Card subs", "add-sub", "Add")}</section>`}
      ${flow.oneOffs.length ? `<section class="block">
        ${sectionHead("This month", "add-oneoff", "Add")}
        ${flow.oneOffs.map((item) => lineRow({
          edit: "edit-oneoff",
          id: item.id,
          title: item.name,
          detail: item.purchased ? "Purchased" : "Planned",
          amount: formatMoney(item.estimatePence),
          tickAction: "toggle-oneoff",
          ticked: item.purchased,
          tickLabel: item.purchased ? "Purchased" : "Not purchased",
        })).join("")}
      </section>` : ""}
      ${hh.annualBills.length ? `<section class="block">
        ${sectionHead("Set aside", "go-annual", "Edit")}
        <article class="line"><div class="line-main static"><span class="line-copy"><strong>Annual reserve</strong></span><span class="line-amount">${formatMoney(flow.annualReservePence)}</span></div></article>
      </section>` : ""}
    `,
  });
}

function plannedScreen() {
  const items = [...household().oneOffs].sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name));
  const thisMonth = items.filter((item) => item.month === viewMonth);
  const later = items.filter((item) => item.month !== viewMonth);
  return shell({
    eyebrow: "Planned",
    title: "Planned.",
    lede: "This month’s items show on Home.",
    month: true,
    body: `
      <section class="block">
        ${sectionHead(monthLabel(viewMonth), "add-oneoff", "Add")}
        ${thisMonth.length ? thisMonth.map(oneOffRow).join("") : emptyLines("Nothing planned this month.", "add-oneoff", "Add a one-off")}
      </section>
      ${later.length ? `<section class="block">${sectionHead("Other months", "", "")}${later.map(oneOffRow).join("")}</section>` : ""}
    `,
  });
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
  });
}

function annualScreen() {
  const items = household().annualBills;
  const reserve = items.length ? Math.round(items.reduce((sum, item) => sum + item.amountPence, 0) / 12) : 0;
  const monthName = (month) => new Intl.DateTimeFormat("en-GB", { month: "long" }).format(new Date(2026, month - 1, 1));
  return shell({
    eyebrow: "Annual",
    title: "Sinking fund.",
    lede: "Renewals and once-a-year bills. The cashflow reserve is the total divided by 12.",
    back: "more",
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
        })).join("") : emptyLines("Insurance, MOT, memberships — add each line.", "add-annual", "Add an annual bill")}
      </section>
    `,
  });
}

function potsScreen() {
  const hh = household();
  const total = hh.pots.reduce((sum, pot) => sum + pot.amountPence, 0);
  return shell({
    eyebrow: "Where’s the money",
    title: "Pots.",
    lede: "Named pots and today’s figure. Pensions are names and status only — no policy or NI numbers.",
    back: "more",
    extra: hh.pots.length ? `<div class="dash single"><div class="stat"><span>Pots total</span><strong>${formatMoney(total)}</strong></div></div>` : "",
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

function payslipsScreen() {
  const hh = household();
  const year = payslipTaxYear || currentUkTaxYear();
  const rows = hh.payslips
    .filter((slip) => slip.taxYear === year)
    .sort((a, b) => b.periodMonth.localeCompare(a.periodMonth) || a.personId.localeCompare(b.personId));
  return shell({
    eyebrow: "Pay",
    title: "Payslips.",
    lede: "Per person, per month. Future rows stay marked as forecast until the money lands.",
    back: "more",
    extra: `<label class="inline-label">Tax year
      <select data-action="payslip-year">${taxYearOptions().map((item) => `<option value="${item}" ${item === year ? "selected" : ""}>${item}</option>`).join("")}</select>
    </label>`,
    body: `
      <section class="block">
        ${sectionHead(year, "add-payslip", "Add")}
        ${rows.length ? rows.map((slip) => {
          const confirmed = payslipIsConfirmed(slip);
          return lineRow({
            edit: "edit-payslip",
            id: slip.id,
            title: `${personById(slip.personId)?.name || "Person"} · ${monthLabel(slip.periodMonth)}`,
            detail: `${confirmed ? "Confirmed" : "Forecast"} · lands ${monthLabel(slip.moneyLandsMonth)} · net ${formatMoney(slip.netPence)}`,
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
  const person = personById(personId);
  const result = aniProjection({
    payslips: hh.payslips,
    donations: hh.donations,
    personId,
    personName: person?.name,
    taxYear: year,
    includeGiftAid: hh.includeGiftAidInAni,
    today: new Date(),
  });
  return shell({
    eyebrow: "Childcare cliff",
    title: "£100k ANI.",
    lede: "Stay at or under £100,000 adjusted net income. YTD from confirmed payslips, then the remaining months at the last confirmed month’s run-rate.",
    back: "more",
    extra: `
      <div class="ani-controls">
        <label>Person
          <select data-action="ani-person">${hh.people.map((item) => `<option value="${item.id}" ${item.id === personId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>
        </label>
        <label>Tax year
          <select data-action="ani-year">${taxYearOptions().map((item) => `<option value="${item}" ${item === year ? "selected" : ""}>${item}</option>`).join("")}</select>
        </label>
      </div>
      <label class="check-row">
        <input type="checkbox" data-action="toggle-gift-aid-ani" ${hh.includeGiftAidInAni ? "checked" : ""} />
        <span>Add Gift Aid from the giving log. Leave this off to treat Gift Aid as £0.</span>
      </label>
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
            ? `<p>Sacrifice another ${formatMoney(result.extraSacrificePence)} this tax year to stay at £100k.${result.remainingMonths ? ` That’s ${formatMoney(result.extraPerRemainingMonthPence)} in each of the ${result.remainingMonths} remaining months.` : ""}</p>`
            : `<p>On this projection you’re ${formatMoney(result.underByPence)} under the £100k cliff.</p>`}
        <p class="helper">${result.confirmedCount} confirmed month${result.confirmedCount === 1 ? "" : "s"}, ${result.remainingMonths} remaining at ${formatMoney(result.lastMonthlyPence)} each. Forecast rows are not counted. Gift Aid add-back ${formatMoney(result.giftAidAddBackPence)}.</p>
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
    lede: "Who, charity, date, amount, Gift Aid. Gross is 25% extra when Gift Aid is on. Tax year follows 6 April.",
    back: "more",
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
        })).join("") : emptyLines("Add a donation when you give.", "add-donation", "Add a donation")}
      </section>
    `,
  });
}

function moreScreen() {
  const links = [
    ["annual", "Annual sinking fund", "Insurance, MOT, memberships, monthly reserve"],
    ["pots", "Pots", "Where the money is, plus pension names"],
    ["payslips", "Payslips", "Tax year, gross, NI amount, net, landing month"],
    ["ani", "£100k childcare helper", "Adjusted net income vs the cliff"],
    ["giving", "Giving", "Donations and Gift Aid"],
  ];
  return shell({
    eyebrow: "More",
    title: "More.",
    lede: "",
    body: `
      <section class="nav-grid">
        ${links.map(([name, title, detail]) => `<a class="friend-card" href="#/${name}" data-action="go" data-screen="${name}">
          <span class="friend-main"><strong>${esc(title)}</strong><small>${esc(detail)}</small></span>
          <span class="chevron">›</span>
        </a>`).join("")}
      </section>
      <section class="block">
        ${sectionHead("Spreadsheet", "", "")}
        <p class="helper">One-time upload of your Numbers/Excel export. Friend tabs stay. Nothing from the file is committed to the public repo.</p>
        <button class="secondary wide" type="button" data-action="import-workbook">Import spreadsheet</button>
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
      <section class="account-card">
        <div><strong>Signed in as ${esc(session.login)}</strong><p class="helper account-copy">Household and tabs are in a private gist, not this browser.</p></div>
        <button class="secondary wide" data-action="sign-out">Sign out</button>
      </section>
    `,
  });
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
    income: incomeForm,
    bill: billForm,
    envelope: envelopeForm,
    card: cardForm,
    sub: subForm,
    pending: pendingForm,
    oneoff: oneOffForm,
    import: importWorkbookForm,
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
  return `<label>${esc(label)}${required ? "" : ' <span class="optional">optional</span>'}<div class="money-input"><span>£</span><input ${required ? "required" : ""} inputmode="decimal" name="${name}" value="${moneyFieldValue(pence)}" placeholder="${placeholder}" autocomplete="off" /></div></label>`;
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
    <label>Amount<div class="money-input"><span>£</span><input required inputmode="decimal" name="amount" value="${amount}" placeholder="0.00" autocomplete="off" /></div></label>
    <fieldset><legend>Who paid?</legend><div class="segmented">
      <label><input type="radio" name="paidBy" value="me" ${(!transaction.paidBy || transaction.paidBy === "me") ? "checked" : ""}/><span>I paid</span></label>
      <label><input type="radio" name="paidBy" value="friend" ${transaction.paidBy === "friend" ? "checked" : ""}/><span>${esc(friend?.name || "Friend")} paid</span></label>
    </div></fieldset>
    ${isExpense ? `<details class="adjustment" ${adjustment ? "open" : ""}><summary>Adjust my share <span>optional</span></summary><p>Keep it at zero for the usual 50/50 split. Use a positive number to add to your share, or a minus number to take it off.</p><label>Change to my share<div class="money-input"><span>£</span><input inputmode="decimal" name="adjustment" value="${adjustment}" placeholder="0" autocomplete="off" /></div></label></details>` : ""}
    <label>${isExpense ? "What was it for" : "Note"} <span class="optional">optional</span><input maxlength="100" name="description" value="${esc(transaction.description)}" placeholder="${isExpense ? "Dinner" : "Transfer"}" /></label>
    <label>Date<input required type="date" name="date" value="${transaction.date || today()}" /></label>
    <div class="live-split" id="live-split"></div>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${transaction.id ? "Save changes" : isExpense ? "Add expense" : "Record transfer"}</button>
    ${transaction.id ? '<button class="danger-link" type="button" data-action="confirm-delete-transaction">Delete entry</button>' : ""}
  </form>`;
}

function deleteForm() {
  return `<div class="delete-confirm">${modalHead("Please check", modal.target === "reset-month" ? `Reset ${modal.label}?` : `Delete ${modal.label || (modal.target === "friend" ? "friend and history" : "this entry")}?`)}
    <p>${esc(modal.copy || (modal.target === "friend" ? "This will permanently remove this friend and every transaction in their tab." : "This cannot be undone."))}</p>
    <div class="confirm-actions"><button class="secondary" data-action="close-modal">Keep it</button><button class="${modal.target === "reset-month" ? "primary" : "danger"}" data-action="delete-confirmed">${modal.target === "reset-month" ? "Reset ticks" : "Delete"}</button></div></div>`;
}

function importReportCopy(report) {
  const lines = reportLines(report);
  const landed = lines.landed.length ? lines.landed.map(([label, count]) => `${label}: ${count}`).join(" · ") : "Nothing landed.";
  const skipped = lines.skipped
    ? ` · Skipped ${lines.skipped}${lines.skippedWhy.length ? ` (${lines.skippedWhy.join(", ")})` : ""}`
    : "";
  return `${landed}${skipped}`;
}

function importWorkbookForm() {
  const report = modal.report;
  if (report) {
    return `<div class="delete-confirm">${modalHead("Imported", "It’s in the gist.")}
      <p>${esc(importReportCopy(report))}</p>
      <button class="primary wide" type="button" data-action="close-modal">Done</button>
    </div>`;
  }
  if (modal.pending) {
    return `<div class="delete-confirm">${modalHead("Replace household?", "Friend tabs stay.")}
      <p>This gist already has household lines. Replace them with the workbook, or keep what is there?</p>
      <p class="helper">${esc(importReportCopy(modal.pending.report))}</p>
      <div class="confirm-actions">
        <button class="secondary" type="button" data-action="import-keep">Keep existing</button>
        <button class="danger" type="button" data-action="import-replace">Replace household</button>
      </div>
    </div>`;
  }
  return `<form id="import-form">${modalHead("Spreadsheet", "Import household lines")}
    <p>Upload the .xlsx export. Household lines are written to the same private gist. Friend tabs are not removed.</p>
    ${householdHasData(household()) ? `<p class="helper">If this household already has lines, you will be asked before they are replaced.</p>` : ""}
    <label>Workbook<input required type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></label>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">Import</button>
  </form>`;
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

function incomeForm() {
  const item = modal.item || {};
  return `<form id="income-form">${modalHead(item.id ? "Income" : "New income", item.id ? "Edit income" : "Add income")}
    <label>Whose<select name="personId" required>${household().people.map((person) => `<option value="${person.id}" ${person.id === (item.personId || household().people[0]?.id) ? "selected" : ""}>${esc(person.name)}</option>`).join("")}</select></label>
    <label>Label<input required maxlength="80" name="label" value="${esc(item.label || "Take-home")}" placeholder="Take-home" /></label>
    ${moneyLabel("Monthly take-home", "amount", item.amountPence)}
    <p class="helper">Type the figure. A payslip that lands this month is shown on Home as a hint only.</p>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save income" : "Add income"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-income">Delete income</button>' : ""}
  </form>`;
}

function billForm() {
  const item = modal.item || {};
  return `<form id="bill-form">${modalHead(item.id ? "Cash bill" : "New bill", item.id ? "Edit bill" : "Add a bill")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Mortgage, council tax, energy…" /></label>
    ${moneyLabel("Amount", "amount", item.amountPence)}
    <label>Due day<input required type="number" name="dueDay" min="1" max="31" value="${item.dueDay || 1}" /></label>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save bill" : "Add bill"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-bill">Delete bill</button>' : ""}
  </form>`;
}

function envelopeForm() {
  const item = modal.item || {};
  return `<form id="envelope-form">${modalHead(item.id ? "Weekly slot" : "New weekly slot", item.id ? "Edit weekly slot" : "Add a weekly slot")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Food shop, Amazon…" /></label>
    ${moneyLabel("Weekly amount", "amount", item.weeklyPence)}
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save slot" : "Add slot"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-envelope">Delete slot</button>' : ""}
  </form>`;
}

function cardForm() {
  const item = modal.item || {};
  return `<form id="card-form">${modalHead(item.id ? "Card" : "New card", item.id ? "Update card" : "Add a card")}
    <label>Name<input required maxlength="80" name="name" value="${esc(item.name || "Card one")}" placeholder="Card one" /></label>
    ${moneyLabel("Balance", "amount", item.balancePence)}
    ${moneyLabel("Pending", "pending", item.pendingPence)}
    <p class="helper">Saving sets the snapshot date to today.</p>
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
    <label>What<input required maxlength="80" name="name" value="${esc(item.name)}" placeholder="Flight hold…" /></label>
    ${moneyLabel("Amount", "amount", item.amountPence)}
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save pending" : "Add pending"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-pending">Delete pending</button>' : ""}
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
  const show = {
    bonus: Boolean(item.bonusPence),
    benefits: Boolean(item.benefitsPence),
    sacrifice: Boolean(item.salarySacrificePensionPence),
  };
  const deductions = item.otherDeductions || [];
  return `<form id="payslip-form">${modalHead(item.id ? "Payslip" : "New payslip", item.id ? "Edit payslip" : "Add a payslip")}
    <label>Person<select name="personId" required>${household().people.map((person) => `<option value="${person.id}" ${person.id === (item.personId || household().people[0]?.id) ? "selected" : ""}>${esc(person.name)}</option>`).join("")}</select></label>
    <label>Tax year<select name="taxYear">${taxYearOptions().map((year) => `<option value="${year}" ${year === (item.taxYear || currentUkTaxYear()) ? "selected" : ""}>${year}</option>`).join("")}</select></label>
    <label>Pay period<input required type="month" name="periodMonth" value="${item.periodMonth || viewMonth}" /></label>
    <label>Month the money lands<input required type="month" name="moneyLandsMonth" value="${item.moneyLandsMonth || item.periodMonth || viewMonth}" /></label>
    ${moneyLabel("Salary", "salary", item.salaryPence)}
    ${moneyLabel("Gross", "gross", item.grossPence)}
    <div class="extra-actions">
      ${show.bonus ? "" : `<button type="button" class="text-button" data-action="show-extra" data-extra="bonus">Add bonus</button>`}
      ${show.benefits ? "" : `<button type="button" class="text-button" data-action="show-extra" data-extra="benefits">Add benefits</button>`}
      ${show.sacrifice ? "" : `<button type="button" class="text-button" data-action="show-extra" data-extra="sacrifice">Add salary-sacrifice pension</button>`}
    </div>
    <label data-extra-field="bonus" class="${show.bonus ? "" : "hidden"}">Bonus<div class="money-input"><span>£</span><input inputmode="decimal" name="bonus" value="${moneyFieldValue(item.bonusPence)}" placeholder="0.00" autocomplete="off" /></div></label>
    <label data-extra-field="benefits" class="${show.benefits ? "" : "hidden"}">Benefits<div class="money-input"><span>£</span><input inputmode="decimal" name="benefits" value="${moneyFieldValue(item.benefitsPence)}" placeholder="0.00" autocomplete="off" /></div></label>
    <label data-extra-field="sacrifice" class="${show.sacrifice ? "" : "hidden"}">Salary-sacrifice pension<div class="money-input"><span>£</span><input inputmode="decimal" name="sacrifice" value="${moneyFieldValue(item.salarySacrificePensionPence)}" placeholder="0.00" autocomplete="off" /></div></label>
    <div id="deduction-rows">${deductions.map((row) => deductionRowMarkup(row.id, row.label, row.amountPence)).join("")}</div>
    <button type="button" class="text-button" data-action="add-deduction-row">Add a deduction type</button>
    ${moneyLabel("Tax", "tax", item.taxPence)}
    ${moneyLabel("National Insurance", "ni", item.niPence)}
    ${moneyLabel("Net", "net", item.netPence)}
    <label>Tax code <span class="optional">optional</span><input maxlength="20" name="taxCode" value="${esc(item.taxCode)}" autocomplete="off" /></label>
    <label>Note <span class="optional">optional</span><input maxlength="200" name="note" value="${esc(item.note)}" /></label>
    <label class="check-row"><input type="checkbox" name="forecast" ${item.forecast ? "checked" : ""} /><span>This is a forecast — do not treat it as confirmed</span></label>
    <p class="form-error" id="form-error"></p>
    <button class="primary wide" type="submit">${item.id ? "Save payslip" : "Add payslip"}</button>
    ${item.id ? '<button class="danger-link" type="button" data-action="confirm-delete-payslip">Delete payslip</button>' : ""}
  </form>`;
}

function deductionRowMarkup(id, label = "", amountPence = 0) {
  return `<div class="deduction-row" data-deduction data-id="${id}">
    <label>Deduction<input maxlength="80" name="deductionLabel" value="${esc(label)}" placeholder="Cycle to work, student loan…" /></label>
    <label>Amount<div class="money-input"><span>£</span><input inputmode="decimal" name="deductionAmount" value="${moneyFieldValue(amountPence)}" placeholder="0.00" autocomplete="off" /></div></label>
    <button type="button" class="danger-link" data-action="remove-deduction-row">Remove</button>
  </div>`;
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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2600);
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
  return household()[list].find((item) => item.id === id);
}

function openItem(kind, list, id) {
  modal = { kind, item: id ? findIn(list, id) : {} };
  if (kind === "payslip") modal = { kind, payslip: id ? findIn("payslips", id) : {} };
  if (kind === "person") modal = { kind, person: id ? personById(id) : {} };
  renderModal();
}

function askDelete(target, id, label, copy) {
  modal = { kind: "delete", target, id, label, copy };
  renderModal();
}

function togglePaid(list, id) {
  return withStoreUpdate(() => {
    const item = findIn(list, id);
    if (!item) return;
    const months = new Set(item.paidMonths || []);
    if (months.has(viewMonth)) months.delete(viewMonth);
    else months.add(viewMonth);
    item.paidMonths = [...months].sort();
  });
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
  if (!target) return;
  const { action, id, screen: nextScreen, extra } = target.dataset;

  if (action === "go") {
    event.preventDefault();
    closeModal();
    if (nextScreen === "planned") setScreen({ name: "planned" });
    else setScreen({ name: nextScreen || "home" });
  }
  if (action === "go-planned") setScreen({ name: "planned" });
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
  if (action === "add-income") openItem("income");
  if (action === "edit-income") openItem("income", "incomes", id);
  if (action === "add-bill") openItem("bill");
  if (action === "edit-bill") openItem("bill", "bills", id);
  if (action === "add-envelope") openItem("envelope");
  if (action === "edit-envelope") openItem("envelope", "envelopes", id);
  if (action === "add-card") openItem("card");
  if (action === "edit-card") openItem("card", "cards", id);
  if (action === "add-pending") openItem("pending");
  if (action === "edit-pending") openItem("pending", "pendings", id);
  if (action === "add-sub") openItem("sub");
  if (action === "edit-sub") openItem("sub", "cardSubs", id);
  if (action === "add-oneoff") openItem("oneoff");
  if (action === "edit-oneoff") openItem("oneoff", "oneOffs", id);
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

  if (action === "toggle-bill") { event.preventDefault(); await togglePaid("bills", id); render(); }
  if (action === "toggle-sub") { event.preventDefault(); await togglePaid("cardSubs", id); render(); }
  if (action === "toggle-oneoff") {
    event.preventDefault();
    await withStoreUpdate(() => {
      const item = findIn("oneOffs", id);
      if (item) item.purchased = !item.purchased;
    });
    render();
  }
  if (action === "reset-month") {
    modal = {
      kind: "delete",
      target: "reset-month",
      label: `${monthLabel(viewMonth)} ticks`,
      copy: "Untick monthly bills, weekly slots, and card subs for this month. Amounts stay. You can tick them again as the month happens.",
    };
    renderModal();
  }
  if (action === "import-workbook") {
    modal = { kind: "import" };
    renderModal();
  }
  if (action === "tick-envelope") {
    event.preventDefault();
    await withStoreUpdate(() => {
      const item = findIn("envelopes", id);
      if (!item) return;
      const stamp = viewMonth === monthKey() ? today() : `${viewMonth}-01`;
      const dates = new Set(item.happenedDates || []);
      if (dates.has(stamp)) dates.delete(stamp);
      else dates.add(stamp);
      item.happenedDates = [...dates].sort();
    });
    render();
  }
  if (action === "show-extra") {
    document.querySelector(`[data-extra-field="${extra}"]`)?.classList.remove("hidden");
    target.remove();
  }
  if (action === "add-deduction-row") {
    document.querySelector("#deduction-rows")?.insertAdjacentHTML("beforeend", deductionRowMarkup(uid()));
  }
  if (action === "remove-deduction-row") {
    target.closest("[data-deduction]")?.remove();
  }

  if (action === "close-modal") closeModal();
  if (action === "confirm-delete-transaction") askDelete("transaction", modal.transaction.id, "this entry");
  if (action === "confirm-delete-friend") askDelete("friend", modal.friend.id, "friend and history");
  if (action === "confirm-delete-person") askDelete("person", modal.person.id, "this person", "Their income and payslip rows will be removed. Donations keep the typed name.");
  if (action === "confirm-delete-income") askDelete("income", modal.item.id, "this income");
  if (action === "confirm-delete-bill") askDelete("bill", modal.item.id, "this bill");
  if (action === "confirm-delete-envelope") askDelete("envelope", modal.item.id, "this weekly slot");
  if (action === "confirm-delete-card") askDelete("card", modal.item.id, "this card");
  if (action === "confirm-delete-pending") askDelete("pending", modal.item.id, "this pending amount");
  if (action === "confirm-delete-sub") askDelete("sub", modal.item.id, "this subscription");
  if (action === "confirm-delete-oneoff") askDelete("oneoff", modal.item.id, "this one-off");
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
      if (targetModal.target === "income") hh.incomes = hh.incomes.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "bill") hh.bills = hh.bills.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "envelope") hh.envelopes = hh.envelopes.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "card") {
        hh.cards = hh.cards.filter((item) => item.id !== targetModal.id);
        hh.cardSubs = hh.cardSubs.map((item) => (item.cardId === targetModal.id ? { ...item, cardId: undefined } : item));
      }
      if (targetModal.target === "reset-month") resetMonthTicks(hh, viewMonth);
      if (targetModal.target === "pending") hh.pendings = hh.pendings.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "sub") hh.cardSubs = hh.cardSubs.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "oneoff") hh.oneOffs = hh.oneOffs.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "annual") hh.annualBills = hh.annualBills.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "pot") hh.pots = hh.pots.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "pension") hh.pensions = hh.pensions.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "payslip") hh.payslips = hh.payslips.filter((item) => item.id !== targetModal.id);
      if (targetModal.target === "donation") hh.donations = hh.donations.filter((item) => item.id !== targetModal.id);
    });
    if (saved) { closeModal(); showToast(targetModal.target === "reset-month" ? "Ticks reset" : "Deleted"); }
    else showToast(sync.message || "Could not delete");
  }
  if (action === "sign-out") signOut();
  if (action === "local-workbook") openLocalWorkbook();
  if (action === "reload") bootApp();
  if (action === "retry-sync") persist().catch(() => {});
  if (action === "discard-local") { clearLocalStore(); closeModal(); }
  if (action === "import-local") {
    const leftover = modal.leftover;
    const saved = await withStoreUpdate(() => { store = parseStore({ ...leftover, household: leftover.household || emptyHousehold() }); });
    if (saved) { clearLocalStore(); closeModal(); showToast("Imported from this browser"); }
    else showToast(sync.message || "Could not import");
  }
  if (action === "import-keep") {
    closeModal();
    showToast("Kept the existing household");
  }
  if (action === "import-replace") {
    const pending = modal.pending;
    if (!pending) return;
    await commitWorkbookImport(pending.household, pending.report);
  }
});

document.addEventListener("change", async (event) => {
  const action = event.target.dataset.action;
  if (action === "payslip-year") { payslipTaxYear = event.target.value; render(); }
  if (action === "ani-person") { aniPersonId = event.target.value; render(); }
  if (action === "ani-year") { aniTaxYear = event.target.value; render(); }
  if (action === "toggle-gift-aid-ani") {
    const checked = event.target.checked;
    const saved = await withStoreUpdate(() => { household().includeGiftAidInAni = checked; });
    if (!saved) showToast(sync.message || "Could not save");
    render();
  }
});

document.addEventListener("submit", (event) => {
  const handlers = {
    "friend-form": saveFriend,
    "transaction-form": saveTransaction,
    "login-form": signIn,
    "person-form": savePerson,
    "income-form": saveIncome,
    "bill-form": saveBill,
    "envelope-form": saveEnvelope,
    "card-form": saveCard,
    "sub-form": saveSub,
    "pending-form": savePending,
    "import-form": importWorkbook,
    "oneoff-form": saveOneOff,
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

async function saveIncome(event) {
  return saveNamedMoney(event, {
    list: "incomes",
    toastAdd: "Income added",
    toastEdit: "Income updated",
    build: (data) => ({
      personId: data.get("personId"),
      label: requireName(data.get("label"), "label"),
      amountPence: requireMoney(data.get("amount"), "amount"),
    }),
  });
}

async function saveBill(event) {
  return saveNamedMoney(event, {
    list: "bills",
    toastAdd: "Bill added",
    toastEdit: "Bill updated",
    build: (data) => ({
      name: requireName(data.get("name"), "name"),
      amountPence: requireMoney(data.get("amount"), "amount"),
      dueDay: requireDueDay(data.get("dueDay")),
      paidMonths: modal.item?.paidMonths || [],
    }),
  });
}

async function saveEnvelope(event) {
  return saveNamedMoney(event, {
    list: "envelopes",
    toastAdd: "Weekly slot added",
    toastEdit: "Weekly slot updated",
    build: (data) => ({
      name: requireName(data.get("name"), "name"),
      weeklyPence: requireMoney(data.get("amount"), "amount"),
      happenedDates: modal.item?.happenedDates || [],
    }),
  });
}

async function saveCard(event) {
  return saveNamedMoney(event, {
    list: "cards",
    toastAdd: "Card added",
    toastEdit: "Card updated",
    build: (data) => ({
      name: requireName(data.get("name"), "name"),
      balancePence: requireMoney(data.get("amount"), "balance"),
      pendingPence: requireMoney(data.get("pending"), "pending"),
      updatedOn: today(),
    }),
  });
}

async function savePending(event) {
  return saveNamedMoney(event, {
    list: "pendings",
    toastAdd: "Pending added",
    toastEdit: "Pending updated",
    build: (data) => ({
      name: requireName(data.get("name"), "name"),
      amountPence: requireMoney(data.get("amount"), "amount"),
    }),
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
        paidMonths: modal.item?.paidMonths || [],
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
      month: data.get("month"),
      estimatePence: requireMoney(data.get("amount"), "estimate"),
      purchased: data.get("purchased") === "on",
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
    build: (data) => ({
      name: requireName(data.get("name"), "name"),
      amountPence: requireMoney(data.get("amount"), "amount"),
      updatedOn: today(),
    }),
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
  const otherDeductions = [...event.target.querySelectorAll("[data-deduction]")].map((row) => ({
    id: row.dataset.id || uid(),
    label: row.querySelector("[name=deductionLabel]").value.trim(),
    amountPence: parseMoneyAllowZero(row.querySelector("[name=deductionAmount]").value),
  })).filter((row) => row.label || row.amountPence);
  if (otherDeductions.some((row) => row.amountPence === null)) {
    return showFormError("Use a valid deduction amount, such as 12.50.");
  }
  let salaryPence;
  let grossPence;
  let bonusPence;
  let benefitsPence;
  let salarySacrificePensionPence;
  let taxPence;
  let niPence;
  let netPence;
  try {
    salaryPence = requireMoney(data.get("salary"), "salary");
    grossPence = requireMoney(data.get("gross"), "gross");
    bonusPence = requireMoney(data.get("bonus"), "bonus");
    benefitsPence = requireMoney(data.get("benefits"), "benefits");
    salarySacrificePensionPence = requireMoney(data.get("sacrifice"), "salary sacrifice");
    taxPence = requireMoney(data.get("tax"), "tax");
    niPence = requireMoney(data.get("ni"), "NI");
    netPence = requireMoney(data.get("net"), "net");
  } catch (error) {
    return showFormError(error.message);
  }
  const payload = {
    personId: data.get("personId"),
    taxYear: data.get("taxYear"),
    periodMonth: data.get("periodMonth"),
    salaryPence,
    grossPence,
    bonusPence,
    benefitsPence,
    salarySacrificePensionPence,
    otherDeductions,
    taxPence,
    niPence,
    netPence,
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
  });
  if (!saved) {
    showFormError(sync.message || "Could not save this payslip.");
    setBusy(event.target, false);
    return;
  }
  closeModal();
  showToast(editing ? "Payslip updated" : "Payslip added");
}

async function commitWorkbookImport(imported, report) {
  const saved = await withStoreUpdate(() => {
    store = applyHouseholdImport(store, imported, { overwrite: true });
  });
  if (!saved) {
    const message = sync.message || "Could not save the import.";
    showFormError(message);
    showToast(message);
    return false;
  }
  modal = { kind: "import", report };
  renderModal();
  showToast("Imported");
  return true;
}

async function importWorkbook(event) {
  event.preventDefault();
  const file = event.target.elements.file?.files?.[0];
  if (!file) return showFormError("Choose the .xlsx export.");
  setBusy(event.target, true);
  try {
    const workbook = await readXlsx(await file.arrayBuffer());
    const { household: imported, report } = householdFromWorkbook(workbook);
    if (!importHasData(report)) {
      throw new Error("Nothing from that workbook mapped. Check it is the .xlsx export with Main, Payslips, Annually, Where’s the money, and Charity.");
    }
    if (householdHasData(household())) {
      modal = { kind: "import", pending: { household: imported, report } };
      renderModal();
      return;
    }
    const saved = await commitWorkbookImport(imported, report);
    if (!saved) setBusy(event.target, false);
  } catch (error) {
    showFormError(error.message || "Could not read that workbook.");
    setBusy(event.target, false);
  }
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
