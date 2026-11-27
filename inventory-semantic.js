/**
 * Optional on-device meaning match for inventory search ("something to hang a
 * picture" -> picture hooks). A small sentence-embedding model
 * (all-MiniLM-L6-v2, about 23 MB quantised) runs in the browser through
 * transformers.js. It is fetched once, the first time Inventory is opened,
 * and the browser caches it after that. Nothing said or typed leaves the
 * phone: only the model files are downloaded.
 *
 * If the script or the model cannot load (offline, an old phone, a blocked
 * CDN) search carries on with words, typos and the built-in "what is it for"
 * hints in inventory.js. Nothing depends on this.
 */

const LIBRARY_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";
const MODEL = "Xenova/all-MiniLM-L6-v2";

let state = "idle"; // idle | loading | ready | failed
let extractor = null;
let loading = null;
const cache = new Map();
const listeners = new Set();

export function semanticState() {
  return state;
}

export function onSemanticState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next) {
  state = next;
  for (const listener of listeners) {
    try { listener(next); } catch { /* A screen that has gone away. */ }
  }
}

export function loadSemantic({ importer = (url) => import(url) } = {}) {
  if (loading) return loading;
  if (typeof window !== "undefined" && window.__TAB_NO_SEMANTIC__) {
    setState("failed");
    loading = Promise.resolve(false);
    return loading;
  }
  setState("loading");
  loading = (async () => {
    try {
      const lib = await importer(LIBRARY_URL);
      lib.env.allowLocalModels = false;
      lib.env.useBrowserCache = true;
      extractor = await lib.pipeline("feature-extraction", MODEL, { dtype: "q8" });
      setState("ready");
      return true;
    } catch (error) {
      console.warn("Smart search is off:", error?.message || error);
      extractor = null;
      setState("failed");
      return false;
    }
  })();
  return loading;
}

async function embed(texts) {
  const missing = texts.filter((text) => !cache.has(text));
  if (missing.length) {
    const output = await extractor(missing, { pooling: "mean", normalize: true });
    const rows = output.tolist();
    missing.forEach((text, index) => cache.set(text, rows[index]));
  }
  return texts.map((text) => cache.get(text));
}

function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

export function itemText(item) {
  return [item.name, ...(item.aliases || []), item.note].filter(Boolean).join(", ");
}

/**
 * Item id -> 0..1, where about 0.25 cosine is "unrelated" and 0.65 is "this is
 * it". Null when the model is not ready, so callers fall back to words.
 */
export async function semanticScores(query, items) {
  if (state !== "ready" || !extractor || !query || !items.length) return null;
  try {
    const [q, ...rows] = await embed([query, ...items.map(itemText)]);
    const scores = new Map();
    items.forEach((item, index) => {
      const value = cosine(q, rows[index]);
      scores.set(item.id, Math.max(0, Math.min(1, (value - 0.25) / 0.4)));
    });
    return scores;
  } catch (error) {
    console.warn("Smart search failed for that query:", error?.message || error);
    return null;
  }
}
