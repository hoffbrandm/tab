import { balanceFor, balanceText, formatMoney, parseMoneyToPence, runningBalances, splitExpense, transactionImpact } from "./calculations.js";

const STORAGE_KEY = "tab.personal.v1";
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let store = loadStore();
let screen = { name: "home" };
let modal = null;
let isSaving = false;

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.version === 1 && Array.isArray(saved.friends) && Array.isArray(saved.transactions)) return saved;
  } catch { /* Start fresh if an old/corrupt local record is found. */ }
  return { version: 1, friends: [], transactions: [] };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function byId(id) { return store.friends.find((friend) => friend.id === id); }
function esc(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function dateLabel(value) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function signedBalanceClass(pence) { return pence > 0 ? "positive" : pence < 0 ? "negative" : "neutral"; }

function render() {
  app.innerHTML = screen.name === "friend" ? friendScreen(byId(screen.friendId)) : homeScreen();
  renderModal();
}

function homeScreen() {
  const friends = [...store.friends].sort((a, b) => a.name.localeCompare(b.name));
  return `<section class="shell home">
    <header class="topbar"><a class="wordmark" href="#home" data-action="home">TAB</a><button class="text-button" data-action="add-friend">Add friend</button></header>
    <div class="intro"><p class="eyebrow">Your tabs</p><h1>Keep it simple.</h1><p>Shared costs, without the maths.</p></div>
    <div class="friend-list">${friends.length ? friends.map(friendCard).join("") : emptyHome()}</div>
    <button class="primary floating" data-action="add-expense" ${friends.length ? "" : "disabled"}>Add expense</button>
    ${friends.length ? "" : '<p class="helper bottom-note">Add someone first, then your first expense takes seconds.</p>'}
  </section>`;
}

function emptyHome() {
  return `<div class="empty-state"><div class="empty-mark">+</div><h2>Your first tab starts here.</h2><p>Add a friend to keep track of the little things you share.</p><button class="primary" data-action="add-friend">Add a friend</button></div>`;
}

function friendCard(friend) {
  const balance = balanceFor(store.transactions, friend.id);
  return `<button class="friend-card" data-action="open-friend" data-id="${friend.id}">
    <span class="avatar">${esc(friend.name.slice(0, 1).toUpperCase())}</span><span class="friend-main"><strong>${esc(friend.name)}</strong><small class="${signedBalanceClass(balance)}">${esc(balanceText(friend.name, balance))}</small></span><span class="chevron">›</span>
  </button>`;
}

function friendScreen(friend) {
  if (!friend) { screen = { name: "home" }; return homeScreen(); }
  const entries = runningBalances(store.transactions, friend.id);
  const balance = balanceFor(store.transactions, friend.id);
  return `<section class="shell detail">
    <header class="topbar"><button class="back" data-action="home" aria-label="Back to your tabs">‹</button><a class="wordmark" href="#home" data-action="home">TAB</a><button class="text-button" data-action="edit-friend" data-id="${friend.id}">Edit</button></header>
    <section class="friend-hero"><p class="eyebrow">${friend.email ? esc(friend.email) : "Shared tab"}</p><h1>${esc(friend.name)}</h1><p class="balance-label">Current balance</p><p class="balance-value ${signedBalanceClass(balance)}">${esc(balanceText(friend.name, balance))}</p></section>
    <div class="quick-actions"><button class="secondary" data-action="add-expense" data-id="${friend.id}">Add expense</button><button class="secondary" data-action="add-repayment" data-id="${friend.id}">Record transfer</button></div>
    <section class="history"><div class="section-heading"><h2>History</h2><span>${entries.length} ${entries.length === 1 ? "entry" : "entries"}</span></div>
      ${entries.length ? entries.map((entry) => transactionRow(entry, friend)).join("") : `<div class="empty-history"><p>No expenses yet.</p><button class="text-button" data-action="add-expense" data-id="${friend.id}">Add the first one</button></div>`}
    </section>
  </section>`;
}

function transactionRow({ transaction, balancePence }, friend) {
  const isExpense = transaction.type === "expense";
  let headline = transaction.description || (isExpense ? "Expense" : "Transfer");
  let detail;
  if (isExpense) {
    const split = splitExpense(transaction.amountPence, transaction.myShareAdjustmentPence || 0);
    detail = transaction.paidBy === "me" ? `You paid ${formatMoney(transaction.amountPence)} · ${friend.name} owes ${formatMoney(split.friendSharePence)}` : `${friend.name} paid ${formatMoney(transaction.amountPence)} · You owe ${formatMoney(split.mySharePence)}`;
  } else {
    detail = transaction.paidBy === "me" ? `You paid ${friend.name} ${formatMoney(transaction.amountPence)}` : `${friend.name} paid you ${formatMoney(transaction.amountPence)}`;
  }
  return `<article class="transaction"><button class="transaction-button" data-action="edit-transaction" data-id="${transaction.id}"><div><p class="transaction-title">${esc(headline)}</p><p class="transaction-detail">${esc(detail)}</p><p class="transaction-date">${dateLabel(transaction.date)}</p></div><div class="transaction-side"><strong>${formatMoney(transaction.amountPence)}</strong><small class="${signedBalanceClass(balancePence)}">${esc(balanceText(friend.name, balancePence))}</small></div></button></article>`;
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
  return "";
}

function friendForm() {
  const friend = modal.friend || {};
  return `<form id="friend-form"><div class="modal-head"><div><p class="eyebrow">${friend.id ? "Friend details" : "New friend"}</p><h2 id="modal-title">${friend.id ? "Edit friend" : "Add a friend"}</h2></div><button type="button" class="close" data-action="close-modal" aria-label="Close">×</button></div>
    <label>Name<input required maxlength="60" name="name" value="${esc(friend.name)}" placeholder="e.g. Ben" autocomplete="name" /></label>
    <label>Email <span class="optional">optional</span><input type="email" maxlength="120" name="email" value="${esc(friend.email)}" placeholder="ben@example.com" autocomplete="email" /></label>
    <p class="form-error" id="form-error"></p><button class="primary wide" type="submit">${friend.id ? "Save changes" : "Add friend"}</button>${friend.id ? '<button class="danger-link" type="button" data-action="confirm-delete-friend">Delete friend and history</button>' : ""}</form>`;
}

function transactionForm() {
  const transaction = modal.transaction || {};
  const friendId = transaction.friendId || modal.friendId || store.friends[0]?.id;
  const isExpense = (transaction.type || modal.type) === "expense";
  const friend = byId(friendId);
  const amount = transaction.amountPence ? (transaction.amountPence / 100).toFixed(2).replace(/\.00$/, "") : "";
  const adjustment = transaction.myShareAdjustmentPence ? (transaction.myShareAdjustmentPence / 100).toFixed(2).replace(/\.00$/, "") : "";
  return `<form id="transaction-form"><div class="modal-head"><div><p class="eyebrow">${transaction.id ? "Edit entry" : isExpense ? "New expense" : "Direct transfer"}</p><h2 id="modal-title">${isExpense ? "Add expense" : "Record transfer"}</h2></div><button type="button" class="close" data-action="close-modal" aria-label="Close">×</button></div>
    <label>With<select name="friendId" required ${modal.friendId ? "disabled" : ""}>${store.friends.map((f) => `<option value="${f.id}" ${f.id === friendId ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></label>
    <label>Amount<div class="money-input"><span>£</span><input required inputmode="decimal" name="amount" value="${amount}" placeholder="0.00" autocomplete="off" /></div></label>
    <fieldset><legend>Who paid?</legend><div class="segmented"><label><input type="radio" name="paidBy" value="me" ${(!transaction.paidBy || transaction.paidBy === "me") ? "checked" : ""}/><span>I paid</span></label><label><input type="radio" name="paidBy" value="friend" ${transaction.paidBy === "friend" ? "checked" : ""}/><span>${esc(friend?.name || "Friend")} paid</span></label></div></fieldset>
    ${isExpense ? `<details class="adjustment"><summary>Adjust my share <span>optional</span></summary><p>Keep it at zero for the usual 50/50 split. Use a positive number to add to your share, or a minus number to take it off.</p><label>Change to my share<div class="money-input"><span>£</span><input inputmode="decimal" name="adjustment" value="${adjustment}" placeholder="0" autocomplete="off" /></div></label></details>` : ""}
    <label>${isExpense ? "What was it for" : "Note"} <span class="optional">optional</span><input maxlength="100" name="description" value="${esc(transaction.description)}" placeholder="${isExpense ? "Dinner" : "Transfer"}" /></label>
    <label>Date<input required type="date" name="date" value="${transaction.date || today()}" /></label>
    <div class="live-split" id="live-split"></div><p class="form-error" id="form-error"></p><button class="primary wide" type="submit">${transaction.id ? "Save changes" : isExpense ? "Add expense" : "Record transfer"}</button>${transaction.id ? '<button class="danger-link" type="button" data-action="confirm-delete-transaction">Delete entry</button>' : ""}</form>`;
}

function deleteForm() {
  return `<div class="delete-confirm"><div class="modal-head"><div><p class="eyebrow">Please check</p><h2 id="modal-title">Delete ${modal.target === "friend" ? "friend and history" : "this entry"}?</h2></div><button type="button" class="close" data-action="close-modal" aria-label="Close">×</button></div><p>${modal.target === "friend" ? "This will permanently remove this friend and every transaction in their tab." : "This cannot be undone, but the tab balance will update immediately."}</p><div class="confirm-actions"><button class="secondary" data-action="close-modal">Keep it</button><button class="danger" data-action="delete-confirmed">Delete</button></div></div>`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2600);
}

function showFormError(message) { const element = document.querySelector("#form-error"); if (element) element.textContent = message; }

function openTransaction(type, friendId, transaction) {
  if (!store.friends.length) return openFriendForm();
  modal = { kind: "transaction", type, friendId, transaction };
  renderModal();
  updateLiveSplit();
}
function openFriendForm(friend) { modal = { kind: "friend", friend }; renderModal(); }
function closeModal() { modal = null; render(); }

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;
  if (action === "home") { screen = { name: "home" }; closeModal(); }
  if (action === "open-friend") { screen = { name: "friend", friendId: id }; render(); }
  if (action === "add-friend") openFriendForm();
  if (action === "edit-friend") openFriendForm(byId(id));
  if (action === "add-expense") openTransaction("expense", id);
  if (action === "add-repayment") openTransaction("repayment", id);
  if (action === "edit-transaction") { const transaction = store.transactions.find((item) => item.id === id); if (transaction) openTransaction(transaction.type, transaction.friendId, transaction); }
  if (action === "close-modal") closeModal();
  if (action === "confirm-delete-transaction") { modal = { kind: "delete", target: "transaction", id: modal.transaction.id }; renderModal(); }
  if (action === "confirm-delete-friend") { modal = { kind: "delete", target: "friend", id: modal.friend.id }; renderModal(); }
  if (action === "delete-confirmed") {
    if (modal.target === "transaction") store.transactions = store.transactions.filter((transaction) => transaction.id !== modal.id);
    if (modal.target === "friend") { store.friends = store.friends.filter((friend) => friend.id !== modal.id); store.transactions = store.transactions.filter((transaction) => transaction.friendId !== modal.id); screen = { name: "home" }; }
    persist(); closeModal(); showToast("Deleted");
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "friend-form") saveFriend(event);
  if (event.target.id === "transaction-form") saveTransaction(event);
});

document.addEventListener("input", (event) => { if (event.target.closest("#transaction-form")) updateLiveSplit(); });

function saveFriend(event) {
  event.preventDefault();
  if (isSaving) return;
  const data = new FormData(event.target);
  const name = data.get("name").trim();
  const email = data.get("email").trim();
  if (!name) return showFormError("Add a name so you can find this tab.");
  if (email && !event.target.elements.email.checkValidity()) return showFormError("Add a valid email address or leave it blank.");
  isSaving = true;
  const editing = Boolean(modal.friend?.id);
  if (editing) Object.assign(byId(modal.friend.id), { name, email });
  else store.friends.push({ id: uid(), name, email, createdAt: new Date().toISOString() });
  persist(); isSaving = false; closeModal(); showToast(editing ? "Friend updated" : "Friend added");
}

function parseSignedMoney(value) {
  const input = String(value).trim();
  if (!input) return 0;
  const negative = input.startsWith("-");
  const pence = parseMoneyToPence(negative ? input.slice(1) : input.replace(/^\+/, ""));
  return pence === null ? null : negative ? -pence : pence;
}

function saveTransaction(event) {
  event.preventDefault();
  if (isSaving) return;
  const data = new FormData(event.target);
  const amountPence = parseMoneyToPence(data.get("amount"));
  const type = modal.transaction?.type || modal.type;
  const adjustment = type === "expense" ? parseSignedMoney(data.get("adjustment")) : 0;
  if (!amountPence || amountPence <= 0) return showFormError("Enter an amount greater than zero.");
  if (adjustment === null) return showFormError("Use a valid adjustment, such as 5 or -5.");
  try { if (type === "expense") splitExpense(amountPence, adjustment); } catch (error) { return showFormError(error.message); }
  const friendId = modal.friendId || data.get("friendId");
  const payload = { friendId, type, amountPence, paidBy: data.get("paidBy"), description: data.get("description").trim(), date: data.get("date"), createdAt: modal.transaction?.createdAt || new Date().toISOString() };
  if (type === "expense") payload.myShareAdjustmentPence = adjustment;
  isSaving = true;
  const editing = Boolean(modal.transaction?.id);
  if (editing) Object.assign(store.transactions.find((item) => item.id === modal.transaction.id), payload);
  else store.transactions.push({ id: uid(), ...payload });
  persist(); isSaving = false; closeModal(); showToast(editing ? "Entry updated" : type === "expense" ? "Expense added" : "Transfer recorded");
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
  if (!isExpense) { output.textContent = paidBy === "me" ? `You’re paying ${friend.name} ${formatMoney(amountPence)}.` : `${friend.name} is paying you ${formatMoney(amountPence)}.`; return; }
  const adjustment = parseSignedMoney(form.elements.adjustment?.value || "");
  try {
    const split = splitExpense(amountPence, adjustment ?? 0);
    output.innerHTML = paidBy === "me" ? `You paid <strong>${formatMoney(amountPence)}</strong><span>Your share ${formatMoney(split.mySharePence)}</span><span>${esc(friend.name)}’s share ${formatMoney(split.friendSharePence)}</span><b>${esc(friend.name)} owes you ${formatMoney(split.friendSharePence)}</b>` : `${esc(friend.name)} paid <strong>${formatMoney(amountPence)}</strong><span>Your share ${formatMoney(split.mySharePence)}</span><span>${esc(friend.name)}’s share ${formatMoney(split.friendSharePence)}</span><b>You owe ${esc(friend.name)} ${formatMoney(split.mySharePence)}</b>`;
  } catch { output.textContent = "Adjustment needs to keep both shares at zero or more."; }
}

render();
