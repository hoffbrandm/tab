import { balanceFor, balanceText, formatMoney, parseMoneyToPence, runningBalances, splitExpense } from "./calculations.js";

const LOCAL_KEY = "tab.personal.v1";
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

let session = null;
let methods = { github: false, password: false };
let store = { version: 1, friends: [], transactions: [] };
let storeSha = null;
let screen = parseHash();
let modal = null;
let boot = { name: "loading" };
let sync = { name: "saved" };
let isSaving = false;
let localImportOffered = false;

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  const match = hash.match(/^friend\/([\w-]+)$/);
  return match ? { name: "friend", friendId: match[1] } : { name: "home" };
}

function setScreen(next, replace = false) {
  screen = next;
  const hash = next.name === "friend" ? `#/friend/${next.friendId}` : "#/home";
  if (`#${location.hash.replace(/^#/, "")}` === hash || location.hash === hash) {
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

function byId(id) { return store.friends.find((friend) => friend.id === id); }
function esc(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}
function dateLabel(value) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}
function signedBalanceClass(pence) { return pence > 0 ? "positive" : pence < 0 ? "negative" : "neutral"; }

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Something went wrong.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function readLocalStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY));
    if (saved?.version === 1 && Array.isArray(saved.friends) && Array.isArray(saved.transactions)) return saved;
  } catch { /* Ignore a corrupt leftover browser copy. */ }
  return null;
}

function clearLocalStore() {
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* Private mode can refuse this. */ }
}

async function bootApp() {
  boot = { name: "loading" };
  render();
  try {
    const me = await api("/api/auth/me").catch(async (error) => {
      if (error.status === 401) return error.payload;
      throw error;
    });
    methods = me.methods || methods;
    if (!me.authenticated) {
      const params = new URLSearchParams(location.search);
      const reason = params.get("error");
      boot = { name: methods.github || methods.password ? "signed-out" : "setup", reason };
      render();
      return;
    }
    session = { login: me.login };
    const payload = await api("/api/store");
    store = payload.store;
    storeSha = payload.sha;
    boot = { name: "ready" };
    maybeOfferLocalImport();
    render();
  } catch (error) {
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
    const payload = await api("/api/store", { method: "PUT", body: { store, sha: storeSha } });
    store = payload.store;
    storeSha = payload.sha;
    sync = { name: "saved" };
    updateSyncChip();
  } catch (error) {
    if (error.status === 409 && error.payload?.store) {
      store = error.payload.store;
      storeSha = error.payload.sha;
      sync = { name: "error", message: "The tab changed on another device. Reloaded the latest copy." };
      updateSyncChip();
      render();
    } else {
      sync = { name: "error", message: error.message };
      updateSyncChip();
    }
    throw error;
  }
}

async function withStoreUpdate(mutator) {
  if (isSaving) return false;
  isSaving = true;
  const previous = structuredClone(store);
  const previousSha = storeSha;
  try {
    mutator();
    await persist();
    return true;
  } catch {
    store = previous;
    storeSha = previousSha;
    return false;
  } finally {
    isSaving = false;
  }
}

function render() {
  if (boot.name === "loading") app.innerHTML = `<section class="busy"><p>Opening your tabs…</p></section>`;
  else if (boot.name === "error") app.innerHTML = errorScreen(boot.message, "Try again", "reload");
  else if (boot.name === "setup") app.innerHTML = setupScreen();
  else if (boot.name === "signed-out") app.innerHTML = signInScreen();
  else app.innerHTML = screen.name === "friend" ? friendScreen(byId(screen.friendId)) : homeScreen();
  renderModal();
}

function updateSyncChip() {
  const chip = document.querySelector("[data-sync-chip]");
  if (chip) chip.outerHTML = syncChip();
}

function syncChip() {
  if (sync.name === "saving") return `<span class="status-chip saving" data-sync-chip>Saving…</span>`;
  if (sync.name === "error") {
    return `<button class="status-chip error" data-sync-chip data-action="retry-sync" type="button">${esc(sync.message || "Could not save")}</button>`;
  }
  return `<span class="status-chip" data-sync-chip>Saved to GitHub</span>`;
}

function errorScreen(message, actionLabel, action) {
  return `<section class="shell gate">
    <header class="topbar"><span class="wordmark">TAB</span></header>
    <div class="intro"><p class="eyebrow">Tab</p><h1>Couldn’t open the tab.</h1><p class="lede">${esc(message)}</p></div>
    <button class="primary wide" data-action="${action}">${esc(actionLabel)}</button>
  </section>`;
}

function setupScreen() {
  return `<section class="shell gate">
    <header class="topbar"><span class="wordmark">TAB</span></header>
    <div class="intro"><p class="eyebrow">Needs setup</p><h1>Sign-in is not configured yet.</h1>
      <p class="lede">This app will not store tabs in the browser. Add a GitHub OAuth app or a passphrase, plus a server-side GitHub token, then reload.</p>
    </div>
    <div class="gate-card"><p class="helper">See the README for <code>GITHUB_TOKEN</code>, <code>SESSION_SECRET</code>, and either GitHub OAuth or <code>TAB_PASSWORD</code>.</p></div>
  </section>`;
}

function signInScreen() {
  const reason = boot.reason === "forbidden"
    ? "That GitHub account is not allowed to open this tab."
    : boot.reason === "oauth"
      ? "GitHub sign-in did not finish. Try again."
      : "";
  return `<section class="shell gate">
    <header class="topbar"><span class="wordmark">TAB</span></header>
    <div class="intro"><p class="eyebrow">Private tab</p><h1>Your tabs live on GitHub.</h1>
      <p class="lede">Sign in on this phone or browser. After a reset, sign in again and the same friends and balances come back.</p>
    </div>
    <div class="gate-card">
      ${reason ? `<p class="form-error">${esc(reason)}</p>` : ""}
      ${methods.github ? `<a class="github wide" href="/api/auth/login">Sign in with GitHub</a>` : ""}
      ${methods.github && methods.password ? `<p class="helper">Or use your passphrase.</p>` : ""}
      ${methods.password ? `<form id="login-form"><label>Passphrase<input type="password" name="password" required autocomplete="current-password" /></label><p class="form-error" id="form-error"></p><button class="primary wide" type="submit">Sign in</button></form>` : ""}
    </div>
  </section>`;
}

function homeScreen() {
  const friends = [...store.friends].sort((a, b) => a.name.localeCompare(b.name));
  return `<section class="shell home">
    <header class="topbar"><a class="wordmark" href="#/home" data-action="home">TAB</a><button class="text-button" data-action="add-friend">Add friend</button></header>
    <div class="sync-row">${syncChip()}</div>
    <div class="intro"><p class="eyebrow">Your tabs</p><h1>Keep it simple.</h1><p>Shared costs, without the maths.</p></div>
    <div class="friend-list">${friends.length ? friends.map(friendCard).join("") : emptyHome()}</div>
    ${friends.length ? `<button class="primary floating" data-action="add-expense">Add expense</button>` : ""}
    <section class="account-card">
      <div><strong>Signed in as ${esc(session.login)}</strong><p class="helper account-copy">Data is saved to GitHub, not this browser.</p></div>
      <button class="secondary wide" data-action="sign-out">Sign out</button>
    </section>
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
    queueMicrotask(() => setScreen({ name: "home" }, true));
    return homeScreen();
  }
  const entries = runningBalances(store.transactions, friend.id);
  const balance = balanceFor(store.transactions, friend.id);
  return `<section class="shell detail">
    <header class="topbar">
      <button class="back" data-action="home" aria-label="Back to your tabs">‹</button>
      <a class="wordmark" href="#/home" data-action="home">TAB</a>
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
  const focus = layer.querySelector("input, select, button");
  requestAnimationFrame(() => focus?.focus());
}

function modalMarkup() {
  if (modal.kind === "friend") return friendForm();
  if (modal.kind === "transaction") return transactionForm();
  if (modal.kind === "delete") return deleteForm();
  if (modal.kind === "import-local") return importForm();
  return "";
}

function friendForm() {
  const friend = modal.friend || {};
  return `<form id="friend-form"><div class="modal-head"><div><p class="eyebrow">${friend.id ? "Friend details" : "New friend"}</p><h2 id="modal-title">${friend.id ? "Edit friend" : "Add a friend"}</h2></div><button type="button" class="close" data-action="close-modal" aria-label="Close">×</button></div>
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
  return `<form id="transaction-form"><div class="modal-head"><div><p class="eyebrow">${transaction.id ? "Edit entry" : isExpense ? "New expense" : "Direct transfer"}</p><h2 id="modal-title">${isExpense ? "Add expense" : "Record transfer"}</h2></div><button type="button" class="close" data-action="close-modal" aria-label="Close">×</button></div>
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
  return `<div class="delete-confirm"><div class="modal-head"><div><p class="eyebrow">Please check</p><h2 id="modal-title">Delete ${modal.target === "friend" ? "friend and history" : "this entry"}?</h2></div><button type="button" class="close" data-action="close-modal" aria-label="Close">×</button></div>
    <p>${modal.target === "friend" ? "This will permanently remove this friend and every transaction in their tab." : "This cannot be undone, but the tab balance will update immediately."}</p>
    <div class="confirm-actions"><button class="secondary" data-action="close-modal">Keep it</button><button class="danger" data-action="delete-confirmed">Delete</button></div></div>`;
}

function importForm() {
  return `<div class="delete-confirm"><div class="modal-head"><div><p class="eyebrow">This browser</p><h2 id="modal-title">Import the old local tab?</h2></div></div>
    <p>This browser still has friends and expenses from before Tab saved to GitHub. Import them once, then they leave this device.</p>
    <div class="confirm-actions">
      <button class="secondary" data-action="discard-local">Leave them</button>
      <button class="primary" data-action="import-local">Import</button>
    </div></div>`;
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

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;
  if (action === "home") { event.preventDefault(); setScreen({ name: "home" }); closeModal(); }
  if (action === "open-friend") setScreen({ name: "friend", friendId: id });
  if (action === "add-friend") openFriendForm();
  if (action === "edit-friend") openFriendForm(byId(id));
  if (action === "add-expense") openTransaction("expense", id);
  if (action === "add-repayment") openTransaction("repayment", id);
  if (action === "edit-transaction") {
    const transaction = store.transactions.find((item) => item.id === id);
    if (transaction) openTransaction(transaction.type, transaction.friendId, transaction);
  }
  if (action === "close-modal") closeModal();
  if (action === "confirm-delete-transaction") { modal = { kind: "delete", target: "transaction", id: modal.transaction.id }; renderModal(); }
  if (action === "confirm-delete-friend") { modal = { kind: "delete", target: "friend", id: modal.friend.id }; renderModal(); }
  if (action === "delete-confirmed") {
    const targetModal = modal;
    const saved = await withStoreUpdate(() => {
      if (targetModal.target === "transaction") store.transactions = store.transactions.filter((transaction) => transaction.id !== targetModal.id);
      if (targetModal.target === "friend") {
        store.friends = store.friends.filter((friend) => friend.id !== targetModal.id);
        store.transactions = store.transactions.filter((transaction) => transaction.friendId !== targetModal.id);
        screen = { name: "home" };
      }
    });
    if (saved) { closeModal(); showToast("Deleted"); }
    else showToast(sync.message || "Could not delete");
  }
  if (action === "sign-out") {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    session = null;
    store = { version: 1, friends: [], transactions: [] };
    storeSha = null;
    boot = { name: "signed-out" };
    modal = null;
    history.replaceState(null, "", "/");
    render();
  }
  if (action === "reload") bootApp();
  if (action === "retry-sync") persist().catch(() => {});
  if (action === "discard-local") { clearLocalStore(); closeModal(); }
  if (action === "import-local") {
    const leftover = modal.leftover;
    const saved = await withStoreUpdate(() => { store = leftover; });
    if (saved) { clearLocalStore(); closeModal(); showToast("Imported from this browser"); }
    else showToast(sync.message || "Could not import");
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "friend-form") saveFriend(event);
  if (event.target.id === "transaction-form") saveTransaction(event);
  if (event.target.id === "login-form") signInWithPassword(event);
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

async function signInWithPassword(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  setBusy(event.target, true);
  try {
    await api("/api/auth/login", { method: "POST", body: { password: data.get("password") } });
    if (location.search) history.replaceState(null, "", location.pathname + location.hash);
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
