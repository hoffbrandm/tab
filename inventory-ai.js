/**
 * Smart understanding: Gemini (primary) or Anthropic API, then rule fallback.
 * Sends only item names, aliases and known places.
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
import { understandSearch, understandUpdate } from "./inventory.js";

export {
  compactInventoryContext,
  parseJsonLoose,
  validateSearchPayload,
  validateUpdatePayload,
  aiChangeToProposal,
  proposalsFromAiPayload,
} from "./inventory-understand-schema.js";

export const AI_TIMEOUT_MS = 6000;

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
  const probe = '{"changes":[{"action":"add","item":"Test hooks","place":["Kitchen"],"stock":"plenty","note":""}]}';
  try {
    const context = { items: [{ name: "Spare hooks", aliases: [] }], places: ["Kitchen drawer"] };
    const text = provider === "gemini"
      ? await fetchGemini({ apiKey: apiKey.trim(), model: AI_MODEL_IDS.gemini, userText: probe, mode: "update", context, fetchImpl })
      : await fetchAnthropic({ apiKey: apiKey.trim(), model: AI_MODEL_IDS.anthropic, userText: probe, mode: "update", context, fetchImpl });
    if (!String(text || "").trim()) return { ok: false, message: "Empty response from the provider." };
    return { ok: true, message: "Key works." };
  } catch (error) {
    return { ok: false, message: String(error.message || error).replace(apiKey, "•••") };
  }
}

export function withTimeout(promise, ms = AI_TIMEOUT_MS) {
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

  const key = settings?.apiKey?.trim();
  const useApi = key && settings?.smartUnderstanding !== false;
  if (useApi) {
    const provider = settings.provider === "anthropic" ? "anthropic" : "gemini";
    try {
      const raw = await withTimeout(callInventoryModel({
        provider,
        apiKey: key,
        model: AI_MODEL_IDS[provider],
        mode: "update",
        userText: said,
        inventory,
        fetchImpl,
      }), AI_TIMEOUT_MS);
      const payload = validateUpdatePayload(raw.data);
      if (payload) return packUpdateResult(payload, inventory, said, lastItemId, provider);
    } catch { /* rules */ }
    return rules("Timed out or unavailable — used basic matching.");
  }

  return rules("");
}

export async function understandSearchSmart(text, inventory, { settings, fetchImpl = fetch } = {}) {
  const parsed = understandSearch(text);
  const key = settings?.apiKey?.trim();
  if (!key || settings?.smartUnderstanding === false) {
    return { parsed, source: "rules", matches: null, fallback: false };
  }
  const provider = settings.provider === "anthropic" ? "anthropic" : "gemini";
  try {
    const raw = await withTimeout(callInventoryModel({
      provider,
      apiKey: key,
      model: AI_MODEL_IDS[provider],
      mode: "search",
      userText: text,
      inventory,
      fetchImpl,
    }), AI_TIMEOUT_MS);
    const valid = validateSearchPayload(raw.data, inventory);
    if (valid) return { parsed, source: provider, matches: valid.matches, fallback: false };
  } catch { /* rules */ }
  return { parsed, source: "rules", matches: null, fallback: true };
}