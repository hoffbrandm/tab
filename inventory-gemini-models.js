/** Gemini model ids and discovery for Smart understanding (browser + tests). */

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/** Older Tab default; still on fallback for keys that already used it. */
export const LEGACY_GEMINI_MODEL = "gemini-2.5-flash-lite";

/** Tried in order after any stored / list-picked model fails with 404-style errors. */
export const GEMINI_MODEL_CANDIDATES = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
  "gemini-flash-latest",
  LEGACY_GEMINI_MODEL,
  "gemini-2.5-flash",
];

const SKIP_MODEL = /(?:embed|imagen|tts|live|aqa|robotics|computer-use|gemma)/i;

export function normalizeGeminiModelStored(raw) {
  const text = String(raw || "").trim();
  if (!text) return DEFAULT_GEMINI_MODEL;
  return text;
}

export function geminiModelUnavailable(status, errText) {
  if (status === 404 || status === 400) {
    const t = String(errText || "").toLowerCase();
    if (t.includes("no longer available") || t.includes("not found") || t.includes("not supported")) return true;
    if (status === 404) return true;
  }
  return false;
}

export function geminiTryOrder(storedModel) {
  const seen = new Set();
  const order = [];
  const add = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };
  add(storedModel);
  for (const id of GEMINI_MODEL_CANDIDATES) add(id);
  return order;
}

export function pickGeminiModelFromList(modelNames, candidates = GEMINI_MODEL_CANDIDATES) {
  const bare = (name) => String(name || "").replace(/^models\//, "");
  const names = [...new Set(modelNames.map(bare).filter(Boolean))];
  const set = new Set(names);
  for (const id of candidates) {
    if (set.has(id)) return id;
  }
  const flashLite = names
    .filter((n) => /flash-lite/i.test(n) && !SKIP_MODEL.test(n))
    .sort()
    .reverse();
  if (flashLite.length) return flashLite[0];
  const flash = names.filter((n) => /flash/i.test(n) && !SKIP_MODEL.test(n)).sort().reverse();
  if (flash.length) return flash[0];
  return "";
}

export async function listGeminiModels(apiKey, fetchImpl = fetch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`;
  const res = await fetchImpl(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.models || [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => m.name || "");
}

export function displayGeminiModel(settings) {
  return settings?.geminiModel || DEFAULT_GEMINI_MODEL;
}