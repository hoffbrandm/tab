/**
 * Smart understanding: on-device WebLLM first, optional cloud API fallback, then rules.
 */

import { AI_MODEL_IDS } from "./inventory-ai-settings.js";
import {
  compactInventoryContext,
  parseJsonLoose,
  proposalsFromAiPayload,
  systemPrompt,
  validateSearchPayload,
  validateUpdatePayload,
} from "./inventory-understand-schema.js";
import {
  onDeviceState,
  onDeviceUnderstandSearch,
  onDeviceUnderstandUpdate,
  webGpuUsable,
} from "./inventory-ondevice.js";
import { understandSearch, understandUpdate } from "./inventory.js";

export {
  compactInventoryContext,
  parseJsonLoose,
  validateSearchPayload,
  validateUpdatePayload,
  aiChangeToProposal,
  proposalsFromAiPayload,
  proposalFromShortcutJson,
} from "./inventory-understand-schema.js";

export const AI_TIMEOUT_MS = 6000;
export const ONDEVICE_TIMEOUT_MS = 12000;

export async function fetchAnthropic({ apiKey, model, userText, mode, context, fetchImpl = fetch }) {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || AI_MODEL_IDS.anthropic,
      max_tokens: 1024,
      system: systemPrompt(mode, context),
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`anthropic:${res.status}:${err.slice(0, 120)}`);
  }
  const data = await res.json();
  const block = data.content?.find((row) => row.type === "text");
  return block?.text || "";
}

export async function fetchGemini({ apiKey, model, userText, mode, context, fetchImpl = fetch }) {
  const modelId = model || AI_MODEL_IDS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${systemPrompt(mode, context)}\n\nUser:\n${userText}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`gemini:${res.status}:${err.slice(0, 120)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
}

export async function callInventoryModel({ provider, apiKey, model, mode, userText, inventory, fetchImpl = fetch }) {
  const context = compactInventoryContext(inventory);
  const text = provider === "gemini"
    ? await fetchGemini({ apiKey, model, userText, mode, context, fetchImpl })
    : await fetchAnthropic({ apiKey, model, userText, mode, context, fetchImpl });
  const parsed = parseJsonLoose(text);
  if (mode === "search") return { kind: "search", data: parsed };
  return { kind: "update", data: parsed };
}

export async function testInventoryAiKey({ provider, apiKey, fetchImpl = fetch }) {
  if (!apiKey?.trim()) return { ok: false, message: "Paste an API key first." };
  const probe = '{"changes":[{"action":"add","item":"Test","place":[],"stock":"plenty","note":""}]}';
  try {
    const context = { items: [{ name: "Spare hooks", aliases: [] }], places: ["Kitchen drawer"] };
    const text = provider === "gemini"
      ? await fetchGemini({ apiKey: apiKey.trim(), model: AI_MODEL_IDS.gemini, userText: probe, mode: "update", context, fetchImpl })
      : await fetchAnthropic({ apiKey: apiKey.trim(), model: AI_MODEL_IDS.anthropic, userText: probe, mode: "update", context, fetchImpl });
    if (!String(text || "").trim()) return { ok: false, message: "Empty response from the provider." };
    return { ok: true, message: "Key works (cloud fallback only)." };
  } catch (error) {
    return { ok: false, message: String(error.message || error).replace(apiKey, "•••") };
  }
}

export function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function packUpdateResult(payload, inventory, said, lastItemId, source) {
  const proposals = proposalsFromAiPayload(payload, inventory, said, { lastItemId });
  if (proposals.length > 1) proposals[0].needsSplit = true;
  return {
    proposal: proposals[0],
    proposals,
    source,
    fallback: false,
    aiChanges: payload.changes,
  };
}

export async function understandUpdateSmart(text, inventory, { settings, lastItemId = null, fetchImpl = fetch } = {}) {
  const said = String(text || "").trim();
  const rules = (note) => {
    const proposal = understandUpdate(said, inventory, { lastItemId });
    return {
      proposal,
      proposals: [proposal],
      source: "rules",
      fallback: Boolean(note),
      fallbackNote: note || "",
    };
  };

  if (settings?.onDeviceInstalled && webGpuUsable() && onDeviceState() === "ready") {
    try {
      const payload = await withTimeout(onDeviceUnderstandUpdate(said, inventory), ONDEVICE_TIMEOUT_MS);
      if (payload) return packUpdateResult(payload, inventory, said, lastItemId, "on-device");
    } catch { /* fall through */ }
  }

  if (settings?.cloudFallback && settings?.cloudApiKey) {
    try {
      const raw = await withTimeout(callInventoryModel({
        provider: settings.cloudProvider,
        apiKey: settings.cloudApiKey,
        model: AI_MODEL_IDS[settings.cloudProvider],
        mode: "update",
        userText: said,
        inventory,
        fetchImpl,
      }), AI_TIMEOUT_MS);
      const payload = validateUpdatePayload(raw.data);
      if (payload) return { ...packUpdateResult(payload, inventory, said, lastItemId, "cloud"), fallback: false };
    } catch { /* rules */ }
  }

  const onDeviceTried = settings?.onDeviceInstalled && webGpuUsable();
  return rules(onDeviceTried || settings?.cloudApiKey
    ? "Used basic matching — download the on-device model or check cloud fallback."
  : "");
}

export async function understandSearchSmart(text, inventory, { settings, fetchImpl = fetch } = {}) {
  const parsed = understandSearch(text);

  if (settings?.onDeviceInstalled && webGpuUsable() && onDeviceState() === "ready") {
    try {
      const valid = await withTimeout(onDeviceUnderstandSearch(text, inventory), ONDEVICE_TIMEOUT_MS);
      if (valid) return { parsed, source: "on-device", matches: valid.matches, fallback: false };
    } catch { /* continue */ }
  }

  if (settings?.cloudFallback && settings?.cloudApiKey) {
    try {
      const raw = await withTimeout(callInventoryModel({
        provider: settings.cloudProvider,
        apiKey: settings.cloudApiKey,
        model: AI_MODEL_IDS[settings.cloudProvider],
        mode: "search",
        userText: text,
        inventory,
        fetchImpl,
      }), AI_TIMEOUT_MS);
      const valid = validateSearchPayload(raw.data, inventory);
      if (valid) return { parsed, source: "cloud", matches: valid.matches, fallback: false };
    } catch { /* rules */ }
  }

  return { parsed, source: "rules", matches: null, fallback: false };
}