/**
 * Shared JSON schema, validation and proposal mapping for every understanding path.
 */

import {
  emptyInventory,
  knownLocations,
  matchLocation,
  rankItems,
} from "./inventory.js";
import { formatDisplayName } from "./inventory-text.js";
import { findExistingByName } from "./inventory-match.js";

const STOCK_MAP = { plenty: "plenty", low: "low", out: "out", unchanged: null };
const ACTIONS = new Set(["add", "move", "update_stock", "took_out", "remove"]);

export function compactInventoryContext(inventory) {
  const items = (inventory?.items || []).slice(0, 200).map((item) => ({
    name: item.name,
    aliases: (item.aliases || []).slice(0, 8),
  }));
  const places = knownLocations(inventory || emptyInventory()).slice(0, 80);
  return { items, places };
}

const UPDATE_SCHEMA = `{
  "changes": [
    {
      "action": "add|move|update_stock|took_out|remove",
      "item": "exact existing name when the same thing, else clean title with 3D/AA/USB capitals",
      "place": ["segment","path"],
      "stock": "plenty|low|out|unchanged",
      "note": ""
    }
  ]
}`;

const SEARCH_SCHEMA = `{
  "matches": [
    { "item": "exact name from list", "reason": "short" }
  ]
}`;

export function systemPrompt(mode, context) {
  const ctx = JSON.stringify(context);
  if (mode === "update") {
    return `You parse household inventory updates from dictated English. Output ONLY valid JSON matching this schema (no markdown):\n${UPDATE_SCHEMA}\n`
      + `Rules: use exact item names from context when they mean the same thing; place is an array of path segments (outer room first); `
      + `stock plenty|low|out|unchanged; action add for new items, move when location changes, update_stock when only quantity changes, took_out when removed from storage but kept on list, remove when deleted. `
      + `Split multiple items in one utterance into multiple changes. Ignore filler like "it belongs in". Map "don't have any"/"none left" to stock out. `
      + `Known items and places: ${ctx}`;
  }
  return `You rank inventory search queries. Output ONLY valid JSON:\n${SEARCH_SCHEMA}\n`
    + `Pick names only from the item list; rank best first. Known: ${ctx}`;
}

export function parseJsonLoose(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1].trim() : raw;
  return JSON.parse(body);
}

export function validateUpdatePayload(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.changes) || !data.changes.length) return null;
  const changes = [];
  for (const row of data.changes) {
    if (!row || typeof row !== "object") return null;
    const action = String(row.action || "").toLowerCase();
    if (!ACTIONS.has(action)) return null;
    const item = String(row.item || "").trim().slice(0, 80);
    if (!item) return null;
    let stock = String(row.stock || "unchanged").toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(STOCK_MAP, stock)) stock = "unchanged";
    const place = Array.isArray(row.place)
      ? row.place.map((p) => String(p || "").trim()).filter(Boolean).slice(0, 6)
      : [];
    const note = String(row.note || "").trim().slice(0, 200);
    changes.push({ action, item, place, stock, note });
  }
  return { changes };
}

export function validateSearchPayload(data, inventory) {
  if (!data || typeof data !== "object" || !Array.isArray(data.matches)) return null;
  const names = new Set((inventory?.items || []).map((item) => item.name));
  const matches = data.matches
    .map((row) => ({
      item: String(row?.item || "").trim(),
      reason: String(row?.reason || "").trim().slice(0, 120),
    }))
    .filter((row) => row.item && names.has(row.item));
  return matches.length ? { matches } : null;
}

function placePathToLocation(segments, inventory) {
  if (!segments?.length) return { location: "", matched: null, suggestions: [] };
  const joined = segments.map((part) => formatDisplayName(part)).join(" › ");
  return matchLocation(joined, knownLocations(inventory || emptyInventory()));
}

function actionToStock(action, stockToken, existing) {
  const mapped = STOCK_MAP[stockToken];
  if (mapped) return mapped;
  if (action === "took_out" || action === "remove") return "out";
  return existing?.stock || "plenty";
}

export function aiChangeToProposal(change, inventory, said, { lastItemId = null } = {}) {
  const items = inventory?.items || [];
  const displayName = formatDisplayName(change.item);
  let item = null;
  const exact = items.find((row) => row.name === change.item);
  if (exact) item = exact;
  else {
    const found = findExistingByName(inventory, displayName);
    if (found) item = found.item;
    else {
      const ranked = rankItems(displayName, items);
      if (ranked[0]?.score >= 0.72) item = ranked[0].item;
    }
  }
  const placed = placePathToLocation(change.place, inventory);
  let location = placed.location;
  if (change.action === "took_out") location = item?.location || location;
  else if (change.action === "move" && !location && item) location = item.location;
  else if (!location && item && (change.action === "update_stock" || change.stock !== "unchanged")) {
    location = item.location;
  }
  const stock = actionToStock(change.action, change.stock, item);
  const candidates = rankItems(displayName, items).slice(0, 4).map((row) => ({
    id: row.item.id,
    name: row.item.name,
    location: row.item.location,
    stock: row.item.stock,
    score: Number(row.score.toFixed(2)),
  }));
  return {
    said,
    itemText: displayName,
    itemId: item?.id || null,
    name: item ? item.name : displayName,
    isNew: !item,
    pronoun: false,
    ambiguous: false,
    needsSplit: false,
    candidates,
    location,
    locationMatched: placed.matched,
    locationSuggestions: placed.suggestions,
    locationIsHere: false,
    locationKept: Boolean(item && location && location === item.location),
    stock,
    stockHeard: change.stock !== "unchanged",
    stockPhrase: "",
    count: null,
    note: change.note || "",
    tookOut: change.action === "took_out",
    aiAction: change.action,
  };
}

export function proposalsFromAiPayload(payload, inventory, said, opts) {
  return payload.changes.map((change) => aiChangeToProposal(change, inventory, said, opts));
}
