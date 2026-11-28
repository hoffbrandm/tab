/**
 * Model / size codes in item names (CR2032, AA, M4, 1.75mm, …).
 * Different codes → different items even when the rest of the phrase matches.
 */

import { normalise } from "./inventory-text.js";

export function extractModelSignature(text) {
  const n = normalise(text);
  const sig = {
    cr: new Set(),
    year: new Set(),
    aa: null,
    m: new Set(),
    mm: new Set(),
  };
  for (const m of n.matchAll(/\bcr[-\s]?(\d{4})\b/g)) sig.cr.add(m[1]);
  const batteryCtx = /\bbatter(?:y|ies|cell|coin)\b/.test(n) || sig.cr.size > 0;
  if (batteryCtx) {
    for (const m of n.matchAll(/\b(20\d{2}|19\d{2})\b/g)) sig.year.add(m[1]);
  }
  if (/\baaa\b/.test(n)) sig.aa = "aaa";
  else if (/\baa\b/.test(n)) sig.aa = "aa";
  for (const m of n.matchAll(/\bm(\d+)\b/g)) sig.m.add(m[1]);
  for (const m of n.matchAll(/\b(\d+(?:\.\d+)?)\s*mm\b/g)) sig.mm.add(m[1]);
  return sig;
}

function batteryCodes(sig) {
  return new Set([...sig.cr, ...sig.year]);
}

/** True when both sides name a code/size and they do not agree. */
export function modelTokensConflict(a, b) {
  const sa = extractModelSignature(a);
  const sb = extractModelSignature(b);
  const batA = batteryCodes(sa);
  const batB = batteryCodes(sb);
  if (batA.size && batB.size) {
    const shared = [...batA].some((code) => batB.has(code));
    if (!shared) return true;
  }
  if (sa.aa && sb.aa && sa.aa !== sb.aa) return true;
  if (sa.m.size && sb.m.size) {
    if (![...sa.m].some((x) => sb.m.has(x))) return true;
  }
  if (sa.mm.size && sb.mm.size) {
    if (![...sa.mm].some((x) => sb.mm.has(x))) return true;
  }
  return false;
}