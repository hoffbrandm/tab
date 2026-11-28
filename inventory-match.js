/**
 * Item identity: normalised keys, fuzzy and phonetic matching, and merging.
 * Pure — runs on the phone; nothing is sent out.
 */

import { formatDisplayName, levenshtein, normalise, phraseScore, singular, tokens } from "./inventory-text.js";
import { modelTokensConflict } from "./inventory-model-tokens.js";

const ARTICLE = /^(?:a|an|the|some)\s+/;

/** Stable key for dedup: case, articles, punctuation, 3D variants, plurals. */
export function normaliseItemKey(name) {
  let t = normalise(name).replace(ARTICLE, "");
  t = t.replace(/\bthree\s*d\b/g, "3d").replace(/\b3\s*-\s*d\b/g, "3d").replace(/\b3\s+d\b/g, "3d");
  t = t.replace(/[.,!?;:]+$/g, "").trim();
  return tokens(t).join(" ");
}

/** Light phonetic key for dictation mishears (consonant skeleton). */
export function doubleMetaphone(input) {
  let s = normalise(input).replace(/[^a-z0-9]/g, "");
  if (!s) return "";
  s = s.replace(/ph/g, "f").replace(/gh/g, "g").replace(/kn/g, "n").replace(/wr/g, "r");
  s = s.replace(/[aeiouy]+/g, "");
  s = s.replace(/(.)\1+/g, "$1");
  return s.slice(0, 8);
}

function metaphoneWords(text) {
  return tokens(text).map((word) => doubleMetaphone(word));
}

function metaphonePhraseScore(a, b) {
  const ma = metaphoneWords(a);
  const mb = metaphoneWords(b);
  if (!ma.length || !mb.length) return 0;
  let hits = 0;
  for (const code of ma) {
    if (mb.some((other) => other === code || (code.length >= 3 && other.startsWith(code.slice(0, 3))))) hits += 1;
  }
  return hits / Math.max(ma.length, mb.length);
}

const CONFUSION_PAIRS = [
  ["complement", "filament"],
  ["compliment", "filament"],
  ["printed", "printer"],
  ["print", "printer"],
  ["filaments", "filament"],
  ["papers", "paper"],
];

function itemList(source) {
  if (Array.isArray(source)) return source;
  return source?.items || [];
}

function vocabularyFromItems(items) {
  const rows = itemList(items);
  const words = new Set();
  for (const item of rows) {
    for (const label of [item.name, ...(item.aliases || [])]) {
      for (const word of tokens(label)) words.add(word);
      words.add(normaliseItemKey(label));
    }
  }
  return words;
}

const PHRASE_FIXES = [
  [/\b3d printed complement\b/g, "3d printer filament"],
  [/\bprinted complement\b/g, "printer filament"],
  [/\bprinter compliment\b/g, "printer filament"],
];

/** Light autocorrect toward known item/alias words and common dictation slips. */
export function autocorrectDictation(text, inventory) {
  const vocab = vocabularyFromItems(inventory);
  const vocabList = [...vocab];
  let out = normalise(text);
  for (const [pattern, replacement] of PHRASE_FIXES) {
    if (tokens(replacement).every((word) => vocab.has(word) || vocab.has(singular(word)))) {
      out = out.replace(pattern, replacement);
    }
  }
  for (const [wrong, right] of CONFUSION_PAIRS) {
    if (vocab.has(right) || vocab.has(singular(right))) {
      out = out.replace(new RegExp(`\\b${wrong}\\b`, "g"), right);
    }
  }
  out = out
    .split(" ")
    .map((word) => {
      if (word.length < 4 || vocab.has(word)) return word;
      let best = word;
      let top = 0;
      for (const known of vocabList) {
        if (known.length < 4 || word.length < 4) continue;
        if (singular(word) === singular(known)) { best = known; top = 1; continue; }
        const ratio = 1 - levenshtein(word, known) / Math.max(word.length, known.length);
        if (ratio > top && ratio >= 0.84) { top = ratio; best = known; }
      }
      return best;
    })
    .join(" ");
  return out;
}

export function itemLabels(item) {
  return [item.name, ...(item.aliases || [])];
}

export function itemSimilarityScore(said, item) {
  const keySaid = normaliseItemKey(said);
  const labels = itemLabels(item);
  let score = 0;
  for (const label of labels) {
    const key = normaliseItemKey(label);
    if (keySaid && keySaid === key) score = Math.max(score, 1);
    else if (keySaid && (keySaid.includes(key) || key.includes(keySaid))) score = Math.max(score, 0.94);
    score = Math.max(score, phraseScore(tokens(said), tokens(label)));
    score = Math.max(score, metaphonePhraseScore(said, label) * 0.92);
  }
  return Math.min(0.99, score);
}

export function rankItemsEnhanced(text, items) {
  return items
    .map((item) => ({ item, score: itemSimilarityScore(text, item) }))
    .filter((row) => row.score > 0.32)
    .sort((a, b) => b.score - a.score);
}

export function findExistingByName(inventory, name, { minScore = 0.78 } = {}) {
  const key = normaliseItemKey(name);
  if (!key) return null;
  for (const item of inventory.items || []) {
    if (normaliseItemKey(item.name) === key && !modelTokensConflict(name, item.name)) {
      return { item, score: 1, exactKey: true };
    }
    for (const alias of item.aliases || []) {
      if (normaliseItemKey(alias) === key && !modelTokensConflict(name, item.name)) {
        return { item, score: 0.99, exactKey: true };
      }
    }
  }
  const top = rankItemsEnhanced(name, inventory.items || [])[0];
  if (top && top.score >= minScore) {
    if (modelTokensConflict(name, top.item.name)) return null;
    return { item: top.item, score: top.score, exactKey: false };
  }
  return null;
}

export { modelTokensConflict } from "./inventory-model-tokens.js";

function candidateRow(item, score) {
  return {
    id: item.id,
    name: item.name,
    location: item.location,
    stock: item.stock,
    score: Number(score.toFixed(2)),
  };
}

/**
 * After rules/AI parsing: resolve auto-match vs new item, pickId, and top candidates.
 */
export function finalizeInventoryProposal(proposal, inventory) {
  const items = inventory?.items || [];
  const typed = formatDisplayName(proposal.itemText || proposal.name || "");
  proposal.typedName = typed;
  const ranked = rankItemsEnhanced(typed, items).filter((row) => row.score > 0.32).slice(0, 3);
  proposal.candidates = ranked.map((row) => candidateRow(row.item, row.score));

  let confident = false;
  const found = findExistingByName(inventory, typed);

  if (proposal.itemId) {
    const current = items.find((row) => row.id === proposal.itemId);
    if (current && modelTokensConflict(typed, current.name)) {
      proposal.itemId = null;
      proposal.isNew = true;
      proposal.autoMatched = false;
    } else if (current) {
      const exact = found?.exactKey && found.item.id === current.id;
      const sameKey = normaliseItemKey(current.name) === normaliseItemKey(typed);
      confident = Boolean(exact || sameKey);
      if (!confident && found && !found.exactKey) {
        proposal.itemId = null;
        proposal.isNew = true;
        proposal.autoMatched = false;
      }
    }
  } else if (found?.exactKey && !modelTokensConflict(typed, found.item.name)) {
    proposal.itemId = found.item.id;
    proposal.name = found.item.name;
    proposal.isNew = false;
    proposal.autoMatched = true;
    proposal.matchConfidence = "exact";
    confident = true;
  } else {
    proposal.itemId = null;
    proposal.isNew = true;
    proposal.autoMatched = false;
    proposal.name = typed;
    proposal.matchConfidence = proposal.candidates.length ? "similar" : "new";
  }

  if (proposal.pickId === undefined || proposal.pickId === null) {
    proposal.pickId = confident && proposal.itemId ? proposal.itemId : "new";
  }
  applyPickId(proposal, items, typed);
  proposal.showItemPicker = proposal.candidates.length > 0 || confident;
  return proposal;
}

export function applyPickId(proposal, inventory, typedName) {
  const items = Array.isArray(inventory) ? inventory : inventory?.items || [];
  const typed = typedName || proposal.typedName || proposal.itemText || proposal.name;
  const pickId = proposal.pickId;
  if (pickId === "new") {
    proposal.itemId = null;
    proposal.forceNew = true;
    proposal.isNew = true;
    proposal.name = formatDisplayName(typed);
    proposal.autoMatched = false;
    return proposal;
  }
  const item = items.find((row) => row.id === pickId);
  if (item) {
    proposal.itemId = item.id;
    proposal.name = item.name;
    proposal.forceNew = false;
    proposal.isNew = false;
    proposal.autoMatched = false;
  }
  return proposal;
}

export function mergeTwoItems(keep, other) {
  const newer = keep.updatedAt >= other.updatedAt ? keep : other;
  const older = newer === keep ? other : keep;
  const aliases = [...new Set([...(keep.aliases || []), ...(other.aliases || []), older.name])]
    .filter((alias) => alias && normaliseItemKey(alias) !== normaliseItemKey(newer.name))
    .slice(0, 10);
  const history = [...(keep.history || []), ...(other.history || [])]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);
  const name = newer.name.length >= older.name.length ? newer.name : older.name;
  return {
    ...newer,
    name,
    location: newer.location || older.location,
    stock: newer.updatedAt >= older.updatedAt ? newer.stock : older.stock,
    note: newer.note || older.note,
    aliases,
    history,
    updatedAt: newer.updatedAt,
    createdAt: keep.createdAt <= other.createdAt ? keep.createdAt : other.createdAt,
  };
}

/** Merge items that share the same normalised name; keep newest stock/location. */
export function consolidateInventory(inventory) {
  const inv = { ...(inventory || {}), items: [...(inventory?.items || [])] };
  const groups = new Map();
  for (const item of inv.items) {
    const key = normaliseItemKey(item.name);
    if (!key) continue;
    const held = groups.get(key);
    groups.set(key, held ? mergeTwoItems(held, item) : { ...item });
  }
  inv.items = [...groups.values()];
  return inv;
}

export function nearDuplicatePairs(items, { minScore = 0.88 } = {}) {
  const pairs = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (normaliseItemKey(a.name) === normaliseItemKey(b.name)) continue;
      const score = itemSimilarityScore(a.name, b);
      if (score >= minScore) pairs.push({ a, b, score: Number(score.toFixed(2)) });
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, 5);
}

export function suggestItemNames(query, items, limit = 6) {
  const text = String(query || "").trim();
  if (!text) return [];
  return rankItemsEnhanced(text, items).slice(0, limit).map((row) => row.item.name);
}

export function addMishearAlias(item, heard, correctedName) {
  const alias = cleanAlias(heard, correctedName);
  if (!alias) return item.aliases || [];
  const aliases = [...(item.aliases || [])];
  if (!aliases.some((entry) => normaliseItemKey(entry) === normaliseItemKey(alias))) aliases.push(alias);
  return aliases.slice(0, 10);
}

function cleanAlias(heard, correctedName) {
  const h = normalise(heard).replace(/[.,!?]+$/g, "").trim();
  const c = normalise(correctedName).trim();
  if (!h || normaliseItemKey(h) === normaliseItemKey(c)) return "";
  return h.slice(0, 60);
}