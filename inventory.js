/**
 * Household inventory: what we have, where it is, and whether it is running low.
 *
 * Everything here is pure and runs on the phone. Understanding a sentence like
 * "I put the hooks back in the kitchen drawer, we've only got a couple left" is
 * rules and fuzzy matching against what is already listed — no service is sent
 * anything. `understandUpdate` and `understandSearch` are the two seams a model
 * (an LLM with a key kept on the device, say) could sit behind later: anything
 * that returns the same shape can replace them without touching the screens.
 */

import { formatDisplayName, levenshtein, normalise, phraseScore, singular, tokens, wordSimilarity } from "./inventory-text.js";
import {
  addMishearAlias,
  autocorrectDictation,
  consolidateInventory,
  findExistingByName,
  mergeTwoItems,
  nearDuplicatePairs,
  normaliseItemKey,
  rankItemsEnhanced,
} from "./inventory-match.js";

export { addMishearAlias, consolidateInventory, findExistingByName, mergeTwoItems, nearDuplicatePairs, normaliseItemKey, rankItemsEnhanced, suggestItemNames } from "./inventory-match.js";

export const INVENTORY_FILENAME = "inventory.json";
export const STOCK_LEVELS = ["plenty", "low", "out"];
export const STOCK_LABELS = { plenty: "Plenty", low: "Low", out: "Run out" };
const HISTORY_LIMIT = 8;
const TOMBSTONE_DAYS = 90;
/** Counts above this stay Plenty with a note; at or below become Low. */
export const LOW_STOCK_COUNT_THRESHOLD = 5;

/* ------------------------------------------------------------------ model */

export function emptyInventory() {
  return { version: 1, items: [], deleted: [] };
}

function cleanString(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isoOr(value, fallback) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(text) && !Number.isNaN(Date.parse(text)) ? text : fallback;
}

/**
 * Lenient on purpose: one odd item must never stop the rest of the inventory
 * (or the money side of Tab) from opening. Anything unreadable is dropped.
 */
export function parseInventory(raw) {
  const out = emptyInventory();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const seen = new Set();
  const epoch = "1970-01-01T00:00:00.000Z";
  for (const item of Array.isArray(raw.items) ? raw.items : []) {
    if (!item || typeof item !== "object") continue;
    const name = cleanString(item.name, 80);
    const id = cleanString(item.id, 80);
    if (!name || !id || seen.has(id)) continue;
    seen.add(id);
    const updatedAt = isoOr(item.updatedAt, epoch);
    out.items.push({
      id,
      name,
      location: cleanString(item.location, 160),
      stock: STOCK_LEVELS.includes(item.stock) ? item.stock : "plenty",
      note: cleanString(item.note, 200),
      aliases: (Array.isArray(item.aliases) ? item.aliases : []).map((alias) => cleanString(alias, 60)).filter(Boolean).slice(0, 10),
      createdAt: isoOr(item.createdAt, updatedAt),
      updatedAt,
      history: (Array.isArray(item.history) ? item.history : [])
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          at: isoOr(entry.at, updatedAt),
          location: cleanString(entry.location, 160),
          stock: STOCK_LEVELS.includes(entry.stock) ? entry.stock : "plenty",
        }))
        .slice(0, HISTORY_LIMIT),
    });
  }
  const tombstones = new Map();
  for (const entry of Array.isArray(raw.deleted) ? raw.deleted : []) {
    const id = cleanString(entry?.id, 80);
    if (!id) continue;
    const at = isoOr(entry.at, epoch);
    if (!tombstones.has(id) || tombstones.get(id) < at) tombstones.set(id, at);
  }
  out.deleted = [...tombstones].map(([id, at]) => ({ id, at }));
  return out;
}

/**
 * Two phones can change the list between reads. Each item keeps the newer
 * copy, and a deletion wins over any edit made before it.
 */
export function mergeInventories(local, remote, now = new Date()) {
  const a = parseInventory(local);
  const b = parseInventory(remote);
  const cutoff = new Date(now.getTime() - TOMBSTONE_DAYS * 86400000).toISOString();
  const tombs = new Map();
  for (const entry of [...a.deleted, ...b.deleted]) {
    if (entry.at < cutoff) continue;
    if (!tombs.has(entry.id) || tombs.get(entry.id) < entry.at) tombs.set(entry.id, entry.at);
  }
  const byId = new Map();
  for (const item of [...b.items, ...a.items]) {
    const held = byId.get(item.id);
    if (!held || held.updatedAt <= item.updatedAt) byId.set(item.id, item);
  }
  const items = [...byId.values()].filter((item) => !(tombs.has(item.id) && tombs.get(item.id) >= item.updatedAt));
  // Keep the order the local copy had, with anything new from the other phone after it.
  const order = new Map(a.items.map((item, index) => [item.id, index]));
  items.sort((x, y) => (order.get(x.id) ?? 1e9) - (order.get(y.id) ?? 1e9));
  return { version: 1, items, deleted: [...tombs].map(([id, at]) => ({ id, at })) };
}

export function inventoryToContent(inventory) {
  return `${JSON.stringify(parseInventory(inventory), null, 2)}\n`;
}

/** Save what was said: new item or an existing one, with a line of history. */
export function applyUpdate(inventory, change, { now = new Date(), id, forceNew = false } = {}) {
  const at = now.toISOString();
  const items = inventory.items;
  let existing = change.itemId ? items.find((item) => item.id === change.itemId) : null;
  if (!existing && !forceNew && change.name) {
    const found = findExistingByName(inventory, change.name);
    if (found) existing = found.item;
  }
  const location = cleanString(change.location, 160);
  const stock = STOCK_LEVELS.includes(change.stock) ? change.stock : "plenty";
  if (existing) {
    const before = structuredClone(existing);
    const nextName = cleanString(change.name, 80);
    if (nextName && normaliseItemKey(nextName) !== normaliseItemKey(existing.name)) existing.name = nextName;
    if (change.location != null) existing.location = location;
    existing.stock = stock;
    if (change.note != null) existing.note = cleanString(change.note, 200);
    let aliases = Array.isArray(change.aliases) ? change.aliases : existing.aliases;
    if (Array.isArray(change.aliases)) aliases = change.aliases;
    if (change.learnAlias) aliases = addMishearAlias(existing, change.learnAlias, existing.name);
    if (Array.isArray(aliases)) existing.aliases = aliases.map((alias) => cleanString(alias, 60)).filter(Boolean).slice(0, 10);
    existing.updatedAt = at;
    existing.history = [{ at, location: existing.location, stock: existing.stock }, ...(existing.history || [])].slice(0, HISTORY_LIMIT);
    return { item: existing, before };
  }
  const item = {
    id: id || `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: cleanString(change.name, 80) || "Unnamed item",
    location,
    stock,
    note: cleanString(change.note, 200),
    aliases: [
      ...(Array.isArray(change.aliases) ? change.aliases.map((alias) => cleanString(alias, 60)).filter(Boolean) : []),
      ...(change.learnAlias ? [cleanString(change.learnAlias, 60)] : []),
    ].filter(Boolean).slice(0, 10),
    createdAt: at,
    updatedAt: at,
    history: [{ at, location, stock }],
  };
  items.push(item);
  return { item, before: null };
}

export function removeItem(inventory, id, now = new Date()) {
  const item = inventory.items.find((row) => row.id === id);
  if (!item) return null;
  inventory.items = inventory.items.filter((row) => row.id !== id);
  inventory.deleted = [...(inventory.deleted || []).filter((entry) => entry.id !== id), { id, at: now.toISOString() }];
  return item;
}

export function restoreItem(inventory, item, before = null) {
  inventory.deleted = (inventory.deleted || []).filter((entry) => entry.id !== item.id);
  const restored = { ...(before || item), updatedAt: new Date().toISOString() };
  const index = inventory.items.findIndex((row) => row.id === item.id);
  if (index >= 0) inventory.items[index] = restored;
  else inventory.items.push(restored);
  return restored;
}

export function shoppingList(inventory) {
  const rank = { out: 0, low: 1 };
  return inventory.items
    .filter((item) => item.stock === "low" || item.stock === "out")
    .sort((a, b) => rank[a.stock] - rank[b.stock] || a.name.localeCompare(b.name));
}

/** Every place things have been put, most recently used first. */
export function knownLocations(inventory) {
  const seen = new Map();
  for (const item of inventory.items) {
    const entries = [{ at: item.updatedAt, location: item.location }, ...(item.history || [])];
    for (const entry of entries) {
      const location = cleanString(entry.location, 160);
      if (!location) continue;
      const key = location.toLowerCase();
      if (!seen.has(key) || seen.get(key).at < entry.at) seen.set(key, { location, at: entry.at });
    }
  }
  return [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).map((entry) => entry.location);
}

/* ------------------------------------------------------------ text tools */

export { formatDisplayName, levenshtein, normalise, phraseScore, singular, tokens, wordSimilarity } from "./inventory-text.js";

function itemNameScore(saidTokens, item) {
  const names = [item.name, ...(item.aliases || [])];
  return names.reduce((top, name) => Math.max(top, phraseScore(saidTokens, tokens(name))), 0);
}

/** Existing items ranked against a spoken name. */
export function rankItems(text, items) {
  return rankItemsEnhanced(text, items);
}

/* -------------------------------------------------------- stock phrases */

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, dozen: 12 };
const NUM = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|a dozen)";
const OF_THEM = "(?: of (?:them|those|these|'em|it|the [a-z ]+?))?";

// Order matters: "running out" and "nearly run out" are low, not out.
const STOCK_RULES = [
  ["low", new RegExp(`\\b(?:running (?:out|low)|run(?:ning)? short|getting low|nearly (?:run |ran )?(?:out|gone|finished|empty)|almost (?:run |ran )?(?:out|gone|finished|empty)|not (?:got )?(?:many|much|enough|a lot)(?: left)?|only (?:got |have |got about |about )?(?:a couple|a few|a handful|a little|a bit|\\bone\\b|\\btwo\\b|\\bthree\\b|${NUM}|the one)${OF_THEM}(?: left| remaining)?|just (?:a couple|a few|\\bone\\b|\\btwo\\b|${NUM})${OF_THEM} left|(?:a couple|a few|a handful|${NUM})${OF_THEM} (?:left|remaining)|last (?:one|few|couple|pack|packet|box|bottle|roll|bag|tin|tube)|need (?:to (?:buy|get|order) )?(?:more|some more)|need to (?:buy|get|order|restock)|(?:should|must) (?:buy|get|order) (?:more|some)|(?:buy|get|order) more|we'?ve (?:only )?got a couple|we have (?:only )?a couple|there(?:'s| is| are) (?:only )?a couple|low (?:on|stock)|\\blow\\b|few left|hardly any)`), "low"],
  ["out", /\b(?:(?:have |we've |we have |'ve )?(?:run|ran) out|out of (?:stock|them|those|these|it)|we(?:'re| are) out|none left|no more(?: left)?|nothing left|none at all|all gone|(?:all )?used up|used (?:them|it|those|these) (?:all )?up|used (?:all of )?(?:them|it) all|used the last(?:\s+of)?|finished (?:them|it|those|the lot)|(?:is|are|it's|they're) finished|\bfinished\b|(?:is|are|it's|they're) empty|there(?:'s| is| are) none|(?:got|have) none|zero left|none\b|(?:don't|do not|dont) have any|(?:haven't|have not) got any|we(?:'re| are) empty|out of stock)/, "out"],
  ["plenty", /\b(?:loads|plenty|lots|a lot|tons|heaps|masses|hundreds|half (?:a |the )?(?:box|pack|packet|bag|roll|tin|tub|bottle|tube)|full (?:box|pack|bag|set|tub|tin)|stocked up|restocked|topped up|well stocked|bought (?:more|loads|lots|some|a new|new)|new (?:box|pack|packet|bag|set|roll)|a good (?:amount|number|supply|few)|more than enough|enough|a load|a ton|shed ?loads|loads left|we're fine|we are fine|good for now|all good)\b/, "plenty"],
];

function refineStockLevel(stock, text) {
  if (!stock) return null;
  const t = normalise(text);
  if (/\bhalf (?:a |the )?(?:box|pack|packet|bag|roll|tin|tub|bottle|tube)\b/.test(t) && !/\bhalf (?:a |the )?(?:box|pack)/.test(stock.phrase)) {
    stock = { ...stock, level: "plenty", phrase: stock.phrase || "half a box", vague: "half" };
  }
  if (stock.count != null && stock.count > LOW_STOCK_COUNT_THRESHOLD) {
    return { ...stock, level: "plenty" };
  }
  if (stock.count != null && stock.count >= 1 && stock.count <= LOW_STOCK_COUNT_THRESHOLD) {
    return { ...stock, level: "low" };
  }
  if (/\ba handful(?:\s+of)?\b/.test(t) && stock.level !== "out") {
    return { ...stock, level: "low", phrase: stock.phrase || "a handful" };
  }
  return stock;
}

/** The stock level a sentence states, the words that said it, and any rough count. */
export function detectStock(text) {
  const t = normalise(text);
  const hardOut = t.match(/\b(?:none left|no more(?: left)?|nothing left|all gone|zero left)\b/);
  if (hardOut) {
    return refineStockLevel({ level: "out", phrase: hardOut[0], index: hardOut.index, count: null }, t);
  }
  for (const [, pattern, level] of STOCK_RULES) {
    const found = t.match(pattern);
    if (found) {
      let count = null;
      const counted = found[0].match(new RegExp(`\\b(${NUM})${OF_THEM} (?:left|remaining)`))
        || found[0].match(new RegExp(`(?:only |about |roughly |around )?(?:got |have )?(${NUM})\\b`))
        || found[0].match(new RegExp(`\\b(${NUM})\\b(?=\\s*(?:left|remaining))`));
      if (counted) {
        const raw = counted[1].replace(/^a /, "");
        count = /^\d+$/.test(raw) ? Number(raw) : NUM_WORDS[raw] ?? null;
      }
      return refineStockLevel({ level, phrase: found[0], index: found.index, count }, t);
    }
  }
  if (/\ba handful(?:\s+of)?\b/.test(t)) {
    return refineStockLevel({ level: "low", phrase: "a handful", index: t.search(/\ba handful/), count: null }, t);
  }
  return null;
}

/* ------------------------------------------------------- update parsing */

const FILLERS = /\b(?:um+|uh+|erm+|er+|you know|i mean|basically|literally|sort of|kind of|like(?=\s|,)|okay so|ok so|right so|so yeah|yeah|,?\s*right)\b/gi;
const LEADS = /^(?:(?:ok(?:ay)?|so|right|and|well|hey|now|just|also|oh)\b[ ,]*)+/;
const VERBS = "put|putting|placed|moved|move|stored|store|stashed|left|kept|keep|popped|pop|dropped|chucked|thrown|threw|stuck|added|add|returned|return|taken|took|take|takes|taking|got|get|gotten|removed|remove|hidden|hid|packed|tidied|filed|stacked|hung|lined|placing|moving|storing";
const SUBJECT = "(?:i(?:'ve| have| just| had|'d)?|we(?:'ve| have| just)?|sarah(?:'s| has)?|someone(?:'s| has)?|eli(?:'s| has)?|you(?:'ve)?)";
const VERB_LEAD = new RegExp(`^(?:${SUBJECT}\\s+)?(?:just\\s+|now\\s+|also\\s+|gone and\\s+|finally\\s+)*(?:${VERBS})\\b\\s*`);
const BE_LOCATION = /^(.+?)(?:'s|'re|\s+(?:are|is|'re|'s|live|lives|go|goes|belong|belongs|now live|are now|is now|have been|has been|are kept|is kept|are stored|is stored|can be found|sit|sits|have gone(?: up| back| away| down)?|has gone(?: up| back| away| down)?|went(?: up| back| away| down)?|are going|ended up))\s+(?:now\s+|kept\s+|stored\s+|put\s+|moved\s+)?(?=(?:back\s+)?(?:in|into|inside|on|onto|under|underneath|beneath|behind|next to|beside|by|at|above|below|upstairs|downstairs|in the|on the|here|there)\b)(.*)$/;
const PREPS = ["on top of", "at the back of", "in the back of", "at the bottom of", "at the top of", "in front of", "next to", "underneath", "beneath", "under", "behind", "beside", "above", "below", "inside", "into", "onto", "in", "on", "at", "to", "by"];
const KEEP_PREPS = new Set(["on top of", "at the back of", "in the back of", "at the bottom of", "at the top of", "in front of", "next to", "underneath", "beneath", "under", "behind", "beside", "above", "below", "by"]);
const PREP_RE = new RegExp(`(?:^|\\s)(?:(?:back|away|up|down|over|out|now|safely)\\s+)*(${PREPS.join("|")})\\s+`);
const BARE_PLACES = /(?:^|\s)(?:(?:back|away|up|down|over|now)\s+)*(upstairs|downstairs|in the loft|in the garage|outside)\b/;
const HERE = /^(?:back\s+)?(?:here|there|over here|over there|right here|down here|up here|in here|in there|this one|this place)\b/;
const WHERE_IT_WAS = /^(?:back(?: where (?:it|they|those|these|we) (?:was|were|belong|belongs|live|lives|go|goes|keep (?:it|them)))?|back in (?:its|their) place|away|back away)$/;
const PRONOUN = /^(?:it|them|they|those|these|that|this|this lot|the rest|the lot|the last ones|the others|those ones|these ones|that one|this one|em|'em)$/;
const DETERMINERS = /^(?:(?:all|both|all of|some of|the rest of|one of|a couple of|a few|a few of|loads of|lots of|plenty of|a load of|a lot of|a bunch of|a handful of|the|a|an|some|our|my|your|any|those|these|this|that|more|a few more|some more)\s+)+/;
const CONTAINER_OF = /^(?:(?:a|the|one|two|three|another|new)\s+)?(?:box|boxes|pack|packs|packet|packets|bag|bags|tub|tubs|tin|tins|roll|rolls|bottle|bottles|jar|jars|tube|tubes|set|sets|pair|pairs|bunch|load|sack|carton|case|reel)\s+of\s+/;
const PART_ARTICLES = /^(?:(?:the|a|an|this|that|these|those|our|my|one of the|one of|its|their|his|her)\s+)+/;
const ROOM_WORDS = /\b(?:upstairs|downstairs|loft|attic|garage|shed|kitchen|utility|hall|hallway|landing|bathroom|ensuite|en suite|bedroom|nursery|office|study|lounge|living room|dining room|playroom|conservatory|garden|porch|cellar|basement|car|boot|room)\b/;
const FURNITURE_WORDS = /\b(?:cupboard|wardrobe|closet|cabinet|shelf|shelves|shelving|unit|dresser|desk|sideboard|chest|bookcase|rack|fridge|freezer|larder|pantry|airing|stairs|sink|bed|table|counter|worktop|island|cot|sofa)\b/;
const CONTAINER_WORDS = /\b(?:box|tub|bag|tin|jar|basket|crate|drawer|caddy|case|pouch|tray|bin|bucket|organiser|organizer|pot|container|envelope|folder|file|toolbox|holdall)\b/;
const LOCATION_CUT = /\s*\b(?:because|cos|cause|so that|so we|so i|so they|for now|for later|just in case|in case|to keep|which is|which are|where we|you know|right|we have|we've|we're|i have|i've|there's|there is|there are|about|roughly|around|,?\s*but\s+we\b|,?\s*and\s+we\b|,?\s*but\s+it's\b|,?\s*but\s+they're\b)\b.*$/i;
const BELONGS_IN = /^(?:it|they|this|that)?\s*(?:belongs?|belonging|lives?|goes?)\s+(?:in|at|inside|into)\s+(?:the\s+)?(.+)$/i;
const IT_IS_IN = /^(?:it|they|this|that)\s+(?:is|are|'s|'re)\s+(?:in|at|inside|into)\s+(?:the\s+)?(.+)$/i;

function capitalise(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function stripStockPhrases(text) {
  let rest = normalise(text);
  for (let i = 0; i < 4; i += 1) {
    const stock = detectStock(rest);
    if (!stock) break;
    rest = rest.replace(stock.phrase, " ").replace(/\s+/g, " ").trim();
  }
  return rest;
}

function cleanItemPhrase(text) {
  let item = stripStockPhrases(text).replace(FILLERS, " ").split(",")[0].replace(/[,.;:!?]+/g, " ").replace(/\s+/g, " ").trim();
  item = item.replace(VERB_LEAD, "").replace(LEADS, "").trim();
  for (let i = 0; i < 3; i += 1) {
    item = item.replace(/^back\s+/, "").replace(DETERMINERS, "").replace(CONTAINER_OF, "").trim();
  }
  item = item.replace(/\b(?:out of|from)\s+(?:the\s+)?[a-z][\w\s]*$/i, "").trim();
  item = item.replace(/\s+(?:left|remaining)(?:\s+of\s+them)?$/g, "").trim();
  item = item.replace(/\s+(?:back|away|over|down|up|again|now|as well|too|here|there|safely)$/g, "").trim();
  item = item.replace(/\s+(?:back|away)$/, "").trim();
  item = item.replace(/'s$/i, "").trim();
  return item;
}

function detectNeedsSplit(text) {
  const t = normalise(text).replace(FILLERS, " ").replace(/\s+/g, " ").trim();
  const verbs = (t.match(/\b(?:put|placed|moved|stashed|stored|left|took|taken)\b/g) || []).length;
  if (verbs >= 2 && /\band\b/.test(t)) return true;
  if (/\b(?:put|moved|placed|stashed)\b[^.]+?\band\b[^.]+?\b(?:the\s+)?\w+.*\b(?:in|into|on|under)\b/.test(t)) return true;
  return false;
}

function locationRank(part) {
  if (ROOM_WORDS.test(part) && !FURNITURE_WORDS.test(part) && !CONTAINER_WORDS.test(part)) return 0;
  if (CONTAINER_WORDS.test(part)) return 2;
  if (FURNITURE_WORDS.test(part)) return 1;
  return 1;
}

/** "into the cupboard upstairs, into the X box" -> "Cupboard upstairs › X box" (outer first). */
export function formatLocation(raw) {
  let text = stripStockPhrases(raw).replace(FILLERS, " ").replace(LOCATION_CUT, "").replace(/[.;:!?]+/g, ",").trim()
    .replace(/^(?:(?:back|away|up|down|over|now|safely)\s+)+/, "");
  if (!text) return "";
  const parts = [];
  // Split at each preposition and comma, remembering the ones worth keeping ("under the sink").
  const splitter = new RegExp(`(?:,|\\s)\\s*(?=(?:${PREPS.join("|")})\\s)|,`, "g");
  for (let piece of text.split(splitter)) {
    piece = piece.replace(/^[\s,]+|[\s,]+$/g, "");
    if (!piece) continue;
    let kept = "";
    for (const prep of PREPS) {
      if (piece.startsWith(`${prep} `)) {
        kept = KEEP_PREPS.has(prep) ? `${prep} ` : "";
        piece = piece.slice(prep.length + 1);
        break;
      }
    }
    if (!kept) piece = piece.replace(PART_ARTICLES, "");
    piece = piece.replace(/^(?:back|away)\s+/, "").replace(/\s+(?:back|away|again|now|here|there|over here|over there)$/, "").trim();
    if (!piece || HERE.test(piece) || /^(?:it|them|there|here|this|that|back|away)$/.test(piece)) continue;
    const previous = parts[parts.length - 1];
    // "the cupboard under the stairs", "the drawer by the back door": one place.
    if (kept && previous && !previous.includes(" › ") && (FURNITURE_WORDS.test(previous) || CONTAINER_WORDS.test(previous)) && !ROOM_WORDS.test(piece)) {
      parts[parts.length - 1] = `${previous} ${kept}${piece}`.trim();
      continue;
    }
    parts.push(`${kept}${piece}`.trim());
  }
  if (!parts.length) return "";
  const ranked = parts.map((part, index) => ({ part, index, rank: locationRank(part) }));
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map((entry) => capitalise(entry.part)).join(" › ");
}

function locationTokens(location) {
  return tokens(String(location).replace(/›/g, " "));
}

/**
 * Reuse a place already in the list when what was said names it, so "the X
 * box" lands on "Cupboard upstairs › X box" rather than a second spelling.
 */
export function matchLocation(location, known) {
  if (!location) return { location: "", matched: null, suggestions: known.slice(0, 4) };
  const said = locationTokens(location);
  const scored = known.map((place) => {
    const theirs = locationTokens(place);
    const exact = place.toLowerCase() === location.toLowerCase() || said.join(" ") === theirs.join(" ");
    const lastPart = place.split("›").pop().trim();
    const tail = phraseScore(said, tokens(lastPart));
    const whole = phraseScore(said, theirs);
    return { place, score: exact ? 1 : Math.max(whole, tail >= 0.95 ? 0.92 : tail * 0.9) };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (top && top.score >= 0.88) return { location: top.place, matched: top.place, suggestions: scored.slice(0, 4).map((row) => row.place) };
  return { location, matched: null, suggestions: scored.filter((row) => row.score > 0.4).slice(0, 4).map((row) => row.place) };
}

function splitClauses(text) {
  const boundary = /\s*[,;.!?]+\s*|\s+(?:and|but|so|cos|because)\s+(?=(?:we|we've|we have|we're|there|there's|there are|only|i've|i have|it's|they're|got|just|not|nearly|almost|running|loads|plenty|lots|none|all|need|i think|they are|it is|that's|it|they)\b)/i;
  return text.split(boundary).map((part) => part.trim()).filter(Boolean);
}

/** Terse natural language: "hooks, it belongs in the office, but we don't have any". */
function parseCommaNaturalLanguage(t) {
  const parts = t.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const hasBelongClause = parts.slice(1).some((part) => BELONGS_IN.test(part) || IT_IS_IN.test(part));
  if (!hasBelongClause) return null;
  if (VERB_LEAD.test(t) && /\b(?:put|moved|placed|stashed|took|left|stored)\b/.test(t)) return null;
  let itemText = parts[0];
  let locationRaw = "";
  let stock = detectStock(t);
  for (const part of parts.slice(1)) {
    const local = detectStock(part);
    const stripped = local ? withoutStock(part, local.phrase) : part;
    if (local && !stripped) {
      stock = stock || local;
      continue;
    }
    const belong = stripped.match(BELONGS_IN) || stripped.match(IT_IS_IN);
    if (belong) {
      const place = belong[1].replace(LOCATION_CUT, "").trim();
      if (place) locationRaw = `in ${place}`;
      if (local) stock = stock || local;
      continue;
    }
    const prep = stripped.match(/^(?:in|at|into|inside|on)\s+(?:the\s+)?(.+)$/i);
    if (prep && !locationRaw) {
      locationRaw = stripped.replace(LOCATION_CUT, "").trim();
      if (local) stock = stock || local;
      continue;
    }
    if (local) stock = stock || local;
  }
  itemText = cleanItemPhrase(itemText);
  if (!itemText) return null;
  return { itemText, locationRaw, stock };
}

/** Strip what said the stock level from a clause; a clause that only said that is dropped. */
function withoutStock(clause, phrase) {
  const rest = clause.replace(phrase, " ")
    .replace(/\b(?:we've|we have|we're|we are|they're|they are|it's|i'm|we|i've|i have|there's|there is|there are|got|have|left|remaining|of them|of those|of these|only|just|now|still|think|i think|probably|about|roughly|around|is|are|it's|they're|so)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  return rest;
}

/**
 * Turn a spoken update into a proposed change. Nothing is saved here; the
 * screen shows this as a card to check first.
 */
export function understandUpdate(text, inventory, { lastItemId = null } = {}) {
  const said = cleanString(text, 600);
  const items = inventory?.items || [];
  let t = autocorrectDictation(normalise(said).replace(FILLERS, " ").replace(/\s+/g, " ").trim(), { items });
  const commaNatural = parseCommaNaturalLanguage(t);
  let stock = commaNatural?.stock || detectStock(t);
  let count = stock?.count ?? null;

  // Clauses that only state the stock ("we've got loads") come out; one that
  // also names the thing ("we've run out of bin bags") keeps the name.
  let stockItemText = "";
  let clauses = splitClauses(t).filter((clause) => !/^(?:right|ok|okay|yeah|this|this one|that one|um|so)$/.test(clause));
  if (stock) {
    clauses = clauses.flatMap((clause) => {
      const local = detectStock(clause);
      if (!local) return [clause];
      const rest = withoutStock(clause, local.phrase);
      if (!rest) return [];
      if (/^(?:on|of|with|up|out)$/.test(rest)) return [];
      // "We've run out of bin bags", "running low on batteries": the thing comes straight after.
      const at = clause.indexOf(local.phrase);
      const before = clause.slice(0, at).replace(/\b(?:we've|we have|we're|we are|we|i've|i have|i'm|i|there's|there is|there are|got|have|are|is|just|really|so|now|also|and|they're|it's)\b/g, "").trim();
      const after = clause.slice(at + local.phrase.length).replace(/^\s*(?:of|on|for|with|some)\s+/, "").trim();
      if (!before && after) {
        stockItemText = stockItemText || after;
        return [];
      }
      const cleared = clause.replace(new RegExp(`${local.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: of)?`), " ").replace(/\s+/g, " ").trim();
      return cleared ? [cleared] : [];
    });
  }

  let main = clauses.join(", ").replace(LEADS, "").trim();
  // "taken the drill out of the garage, it's now in…": the old place is not the new one.
  if (/\b(?:it's|they're|it is|they are|now)\b.*\b(?:in|into|on|under|behind|at)\b/.test(main)) {
    main = main.replace(/\s+(?:out of|from|off)\s+[^,]+,\s*(?:(?:it's|they're|it is|they are|and|now|put (?:it|them))\s+)*/, " ");
  }
  let itemText = "";
  let locationRaw = "";
  let keepLocation = false;
  let tookOut = false;

  if (commaNatural) {
    itemText = commaNatural.itemText;
    locationRaw = commaNatural.locationRaw;
  }

  const tookMatch = !commaNatural && main.match(/^(?:the\s+)?(.+?)\s+out(?:\s+of\s+.+)?$/);
  if (tookMatch && /\b(?:took|take|taken|removed|remove)\b/.test(clauses[0] || main)) {
    itemText = tookMatch[1];
    locationRaw = "";
    tookOut = true;
    keepLocation = false;
  }

  const fromTo = !commaNatural && !tookOut && main.match(/^(.*?)\s+from\s+.+?\s+(?:to|into|in)\s+(.+)$/);
  const be = !commaNatural && main.replace(VERB_LEAD, "").match(BE_LOCATION);
  const verbLead = VERB_LEAD.test(main);
  if (verbLead) main = main.replace(VERB_LEAD, "");
  if (!commaNatural && !tookOut && fromTo && verbLead) {
    itemText = fromTo[1].replace(VERB_LEAD, "");
    locationRaw = fromTo[2];
  } else if (!commaNatural && !tookOut && !verbLead && be) {
    itemText = be[1];
    locationRaw = be[2];
  } else if (!commaNatural && !tookOut) {
    const prep = main.match(PREP_RE);
    const bare = main.match(BARE_PLACES);
    const here = main.match(/\s(?:back\s+)?(?:here|there|over here|over there|in here|in there)\b/);
    const cut = [prep, bare, here].filter(Boolean).sort((a, b) => a.index - b.index)[0];
    if (cut) {
      itemText = main.slice(0, cut.index);
      locationRaw = main.slice(cut.index);
    } else if (clauses.length >= 2 && !verbLead) {
      // Terse: "Hooks. Kitchen drawer. Low."
      itemText = clauses[0];
      locationRaw = `in ${clauses.slice(1).join(", ")}`;
    } else {
      itemText = main;
      if (/\bback\b/.test(main)) keepLocation = true;
    }
  }
  if (!itemText && stockItemText) itemText = stockItemText;
  if (!locationRaw && itemText) {
    const tail = itemText.match(/^(.*?)\s+(?:in|into|on|onto|under|inside)\s+(.+)$/i);
    if (tail) {
      itemText = tail[1];
      locationRaw = `in ${tail[2]}`;
    }
  }
  itemText = cleanItemPhrase(itemText);
  if (/^(?:put|got|have|we|i)$/.test(itemText)) itemText = "";
  locationRaw = locationRaw.replace(/^[\s,]+/, "");
  const locationTrim = normalise(locationRaw).replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  const locationIsHere = HERE.test(locationTrim) && !formatLocation(locationRaw);
  if (WHERE_IT_WAS.test(locationTrim)) { keepLocation = true; locationRaw = ""; }
  if (!locationRaw && /\bback$/.test(normalise(main))) keepLocation = true;
  let location = locationIsHere ? "" : formatLocation(locationRaw);

  // Which item: a pronoun means the last one touched; otherwise match by name.
  const pronoun = !itemText || PRONOUN.test(itemText);
  let candidates = [];
  let item = null;
  let ambiguous = false;
  if (pronoun && lastItemId) {
    item = items.find((row) => row.id === lastItemId) || null;
  } else if (!pronoun) {
    candidates = rankItems(itemText, items).slice(0, 4);
    const [top, second] = candidates;
    if (top && top.score >= 0.72) {
      item = top.item;
      ambiguous = Boolean(second && second.score >= 0.68 && top.score - second.score < 0.12);
      if (ambiguous) {
        // Close call: the one touched most recently is the likelier one in hand.
        const close = candidates.filter((row) => row.score >= 0.7 && top.score - row.score < 0.12);
        item = close.sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt))[0].item;
      }
    }
  }

  const known = knownLocations(inventory || emptyInventory());
  const placed = matchLocation(location, known);
  location = placed.location;
  if (!location && item && (keepLocation || !locationIsHere)) location = item.location;

  const level = stock?.level || (item ? item.stock : "plenty");
  const name = item ? item.name : formatDisplayName(pronoun ? "" : itemText);
  let note = "";
  if (count != null) note = `About ${count} left`;
  else if (stock?.vague === "half" || /\bhalf (?:a |the )?(?:box|pack)/.test(t)) note = "About half left";
  return {
    said,
    itemText,
    itemId: item?.id || null,
    name,
    isNew: !item,
    pronoun,
    ambiguous,
    needsSplit: detectNeedsSplit(said),
    candidates: candidates.map((row) => ({ id: row.item.id, name: row.item.name, location: row.item.location, stock: row.item.stock, score: Number(row.score.toFixed(2)) })),
    location,
    locationMatched: placed.matched,
    locationSuggestions: placed.suggestions,
    locationIsHere,
    locationKept: Boolean(item && location && location === item.location && !locationRaw),
    stock: level,
    stockHeard: Boolean(stock),
    stockPhrase: stock?.phrase || "",
    count,
    note,
    tookOut,
  };
}

/* -------------------------------------------------------- search parsing */

const QUESTION_LEADS = /^(?:(?:hey|ok|okay|so|right|um|erm|can you tell me|tell me|do you know|any idea)\s*,?\s*)*(?:where(?:'s| is| are|'re| was| were| have| has| did| do)?(?:\s+(?:i|we|you|someone|sarah|eli)\s+(?:put|leave|left|keep|store|stash|hide)(?:\s+the|\s+our|\s+my)?)?|where can i find|where would i find|where do we keep|where might(?: the)?|what do we have (?:for|to)|have we got(?: any)?|have we any|do we have(?: any)?|do we still have(?: any)?|have we still got(?: any)?|is there(?: any)?|are there(?: any)?|i'?m (?:looking|searching|hunting) for|i am (?:looking|searching) for|i need|we need|looking for|search(?:ing)? for|find(?: me)?|show me|got any|how many|how much|what about)\b\s*/;
const PURPOSE = /\b(?:something|anything|stuff|things?|a thing)\s+(?:to|for|that|which|i can use to|we can use to|i could use to)\s+(.+)$/;

/** Words that point at things, for "something to hang a picture" style questions. */
export const CONCEPTS = {
  hang: ["hook", "nail", "picture hook", "command strip", "string", "wire"],
  picture: ["picture hook", "frame", "nail"],
  frame: ["picture hook", "nail"],
  stick: ["glue", "tape", "sellotape", "superglue", "blu tack", "command strip"],
  glue: ["glue", "superglue", "tape"],
  fix: ["screwdriver", "tool", "glue", "tape", "screw", "allen key"],
  repair: ["screwdriver", "tool", "glue", "tape"],
  screw: ["screwdriver", "screw", "rawl plug", "drill"],
  wall: ["rawl plug", "screw", "nail", "picture hook", "filler"],
  light: ["bulb", "torch", "candle", "battery"],
  dark: ["torch", "bulb", "candle"],
  power: ["battery", "charger", "cable", "plug", "extension lead"],
  charge: ["charger", "cable", "battery"],
  remote: ["battery"],
  clean: ["cleaner", "spray", "cloth", "sponge", "bleach", "wipe", "polish"],
  wash: ["detergent", "washing up liquid", "soap", "laundry", "tablet"],
  laundry: ["detergent", "fabric conditioner", "stain remover"],
  cut: ["scissors", "knife", "saw", "stanley knife"],
  write: ["pen", "pencil", "marker", "paper", "notepad"],
  wrap: ["wrapping paper", "tape", "gift bag", "ribbon"],
  present: ["wrapping paper", "gift bag", "ribbon", "card"],
  gift: ["wrapping paper", "gift bag", "ribbon", "card"],
  measure: ["tape measure", "ruler"],
  drill: ["drill", "drill bit", "rawl plug"],
  baby: ["nappy", "wipe", "bottle", "formula", "calpol"],
  nappy: ["nappy", "wipe", "nappy bag"],
  paint: ["paint", "brush", "roller", "masking tape"],
  bin: ["bin bag", "bin liner"],
  rubbish: ["bin bag", "bin liner"],
  sew: ["needle", "thread", "button"],
  hurt: ["plaster", "bandage", "antiseptic", "first aid"],
  graze: ["plaster", "antiseptic"],
  headache: ["paracetamol", "ibuprofen"],
  pain: ["paracetamol", "ibuprofen", "calpol"],
  fever: ["calpol", "paracetamol", "thermometer"],
  cold: ["tissue", "lemsip", "paracetamol"],
  tie: ["string", "cable tie", "rope", "twine"],
  hold: ["clip", "clamp", "cable tie", "elastic band"],
  post: ["stamp", "envelope", "tape"],
  letter: ["stamp", "envelope"],
  party: ["candle", "balloon", "napkin"],
  birthday: ["candle", "card", "wrapping paper", "balloon"],
  bike: ["pump", "inner tube", "lock"],
  tyre: ["pump", "inner tube"],
  garden: ["glove", "secateur", "hose"],
  shoe: ["shoe polish", "lace"],
  dog: ["dog food", "poo bag", "lead"],
  bathroom: ["bleach", "cleaner", "toilet roll", "plunger", "limescale"],
  toilet: ["toilet roll", "bleach", "brush"],
  kitchen: ["foil", "baking paper", "sponge", "washing up liquid", "cling film"],
  cook: ["foil", "baking paper", "oil", "spice"],
  baking: ["baking paper", "foil", "flour"],
  diy: ["drill", "screw", "rawl plug", "filler", "sandpaper", "masking tape"],
  toolbox: ["screwdriver", "hammer", "tape measure", "allen key"],
  stationery: ["pen", "pencil", "stapler", "sellotape", "envelope", "paper"],
  batteries: ["AA batteries", "AAA batteries", "battery"],
  battery: ["AA batteries", "AAA batteries", "battery"],
  tape: ["sellotape", "masking tape", "duct tape"],
  first: ["plaster", "bandage", "antiseptic", "thermometer"],
  aid: ["plaster", "bandage", "antiseptic"],
  disinfect: ["antiseptic", "wipe", "spray"],
  stain: ["stain remover", "vanish", "bicarbonate"],
  spill: ["cloth", "kitchen roll", "wipe"],
  mop: ["mop", "bucket", "floor cleaner"],
  hoover: ["vacuum bag", "filter"],
  laminate: ["floor cleaner", "mop"],
};

export function understandSearch(text) {
  const said = cleanString(text, 300);
  let t = normalise(said).replace(FILLERS, " ").replace(/[?!.]+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(QUESTION_LEADS, "").replace(/\b(?:please|at the moment|right now|now|again|at all|left)\b/g, " ").replace(/\s+/g, " ").trim();
  const inPlace = t.match(/^(?:what(?:'s| is| do we have| have we got| have we)?|whats)\s+(?:in|inside|on|under)\s+(.+)$/);
  const purpose = t.match(PURPOSE);
  const forWhat = t.match(/\b(?:what (?:do )?we have|anything|something) (?:for|to)\s+(.+)$/);
  let query = cleanItemPhrase(purpose ? purpose[1] : forWhat ? forWhat[1] : t);
  const words = tokens(query);
  const expanded = new Set();
  for (const word of words) {
    for (const extra of CONCEPTS[word] || []) expanded.add(extra);
    for (const [key, list] of Object.entries(CONCEPTS)) {
      if (key.includes(word) || word.includes(key)) list.forEach((entry) => expanded.add(entry));
    }
  }
  return {
    said,
    query: inPlace ? "" : query,
    place: inPlace ? formatLocation(`in ${inPlace[1]}`) : "",
    tokens: words,
    concepts: [...expanded],
    purpose: Boolean(purpose),
  };
}

/**
 * Rank items for a search. `semantic` is an optional map of item id -> score
 * (0–1) from the on-device model; without it this is words and typos only.
 */
export function searchItems(inventory, parsed, { semantic = null } = {}) {
  const items = inventory?.items || [];
  if (parsed.place) {
    const want = locationTokens(parsed.place);
    return {
      mode: "place",
      results: items
        .map((item) => ({ item, score: Math.max(phraseScore(want, locationTokens(item.location)), phraseScore(want, tokens(item.location.split("›").pop() || ""))) }))
        .filter((row) => row.score >= 0.6)
        .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)),
    };
  }
  const q = parsed.tokens;
  if (!q.length && !parsed.concepts.length) return { mode: "none", results: [] };
  const scored = items.map((item) => {
    const nameTokens = [item.name, ...(item.aliases || [])].map(tokens);
    let lexical = nameTokens.reduce((top, name) => Math.max(top, phraseScore(q, name)), 0);
    const exact = nameTokens.some((name) => name.join(" ") === q.join(" "));
    let concept = 0;
    for (const extra of parsed.concepts) {
      const extraTokens = tokens(extra);
      for (const name of nameTokens) concept = Math.max(concept, phraseScore(extraTokens, name) * 0.75);
    }
    const noteScore = item.note ? phraseScore(q, tokens(item.note)) * 0.5 : 0;
    const placeScore = phraseScore(q, locationTokens(item.location)) * 0.45;
    const sem = semantic?.get?.(item.id) ?? 0;
    const score = Math.max(lexical, concept, noteScore, placeScore, sem * 0.85);
    return { item, score, exact, why: score === lexical ? "name" : score === concept ? "use" : score === sem * 0.85 ? "meaning" : score === placeScore ? "place" : "note" };
  }).filter((row) => row.score >= 0.4).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return { mode: "items", results: scored.slice(0, 8) };
}

/** Best matches and "did you mean": a confident name match leads, the rest are suggestions. */
export function splitSearchResults(results) {
  const best = results.filter((row) => row.exact || row.score >= 0.88);
  const rest = results.filter((row) => !best.includes(row));
  return { best, didYouMean: rest };
}
