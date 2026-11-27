/** Smart understanding — on-device model + optional cloud fallback. Device only; never in the gist. */

export const INV_AI_STORAGE_KEY = "tab.inventory.ai.v1";

export const AI_PROVIDER_IDS = ["anthropic", "gemini"];

export const AI_MODEL_IDS = {
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-2.5-flash-lite",
};

export function emptyAiSettings() {
  return {
    onDeviceInstalled: false,
    allowCellularDownload: false,
    cloudProvider: "anthropic",
    cloudApiKey: "",
    cloudFallback: false,
  };
}

export function readAiSettings(storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return emptyAiSettings();
  try {
    const raw = JSON.parse(store.getItem(INV_AI_STORAGE_KEY));
    if (!raw || typeof raw !== "object") return emptyAiSettings();
    const legacyKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
    const provider = AI_PROVIDER_IDS.includes(raw.cloudProvider || raw.provider) ? (raw.cloudProvider || raw.provider) : "anthropic";
    return {
      onDeviceInstalled: Boolean(raw.onDeviceInstalled),
      allowCellularDownload: Boolean(raw.allowCellularDownload),
      cloudProvider: provider,
      cloudApiKey: String(raw.cloudApiKey || legacyKey || "").trim(),
      cloudFallback: Boolean(raw.cloudFallback),
    };
  } catch {
    return emptyAiSettings();
  }
}

export function writeAiSettings(storage, partial) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) throw new Error("No storage available.");
  const next = { ...readAiSettings(store), ...partial };
  if (!AI_PROVIDER_IDS.includes(next.cloudProvider)) next.cloudProvider = "anthropic";
  next.cloudApiKey = String(next.cloudApiKey || "").trim();
  store.setItem(INV_AI_STORAGE_KEY, JSON.stringify({
    onDeviceInstalled: Boolean(next.onDeviceInstalled),
    allowCellularDownload: Boolean(next.allowCellularDownload),
    cloudProvider: next.cloudProvider,
    cloudApiKey: next.cloudApiKey,
    cloudFallback: Boolean(next.cloudFallback),
  }));
  return next;
}

export function smartUnderstandingAvailable(settings = readAiSettings()) {
  return Boolean(settings.onDeviceInstalled || (settings.cloudFallback && settings.cloudApiKey));
}

export function onDeviceMarkedInstalled(storage) {
  writeAiSettings(storage, { onDeviceInstalled: true });
}

export function clearOnDeviceInstalled(storage) {
  writeAiSettings(storage, { onDeviceInstalled: false });
}