/** Smart understanding API keys — localStorage on this device only, never in the gist. */

export const INV_AI_STORAGE_KEY = "tab.inventory.ai.v1";

export const AI_PROVIDER_IDS = ["gemini", "anthropic"];

/** Gemini is primary (free-tier flash-lite); Anthropic optional second. */
export const AI_MODEL_IDS = {
  gemini: "gemini-2.5-flash-lite",
  anthropic: "claude-haiku-4-5",
};

export function emptyAiSettings() {
  return { provider: "gemini", apiKey: "", smartUnderstanding: true };
}

export function readAiSettings(storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return emptyAiSettings();
  try {
    const raw = JSON.parse(store.getItem(INV_AI_STORAGE_KEY));
    if (!raw || typeof raw !== "object") return emptyAiSettings();
    const legacyKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
    const fromCloud = String(raw.cloudApiKey || "").trim();
    const apiKey = String(raw.apiKey || fromCloud || legacyKey || "").trim();
    let provider = raw.provider || raw.cloudProvider || "gemini";
    if (!AI_PROVIDER_IDS.includes(provider)) provider = "gemini";
    const smartUnderstanding = raw.smartUnderstanding !== false;
    return { provider, apiKey, smartUnderstanding };
  } catch {
    return emptyAiSettings();
  }
}

export function writeAiSettings(storage, partial) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) throw new Error("No storage available.");
  const next = { ...readAiSettings(store), ...partial };
  if (!AI_PROVIDER_IDS.includes(next.provider)) next.provider = "gemini";
  next.apiKey = String(next.apiKey || "").trim();
  store.setItem(INV_AI_STORAGE_KEY, JSON.stringify({
    provider: next.provider,
    apiKey: next.apiKey,
    smartUnderstanding: next.smartUnderstanding !== false,
  }));
  return next;
}

export function smartUnderstandingAvailable(settings = readAiSettings()) {
  return Boolean(settings.smartUnderstanding && settings.apiKey);
}