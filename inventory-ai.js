/**
 * Smart understanding: Gemini (primary) or Anthropic API, then rule fallback.
 * Sends only item names, aliases and known places.
 */

import {
  DEFAULT_GEMINI_MODEL,
  geminiModelUnavailable,
  geminiTryOrder,
  listGeminiModels,
  pickGeminiModelFromList,
  GEMINI_MODEL_CANDIDATES,
} from "./inventory-gemini-models.js";
import { AI_MODEL_IDS, readAiSettings, writeAiSettings } from "./inventory-ai-settings.js";
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

function parseGeminiError(message) {
  const m = String(message || "").match(/^gemini:(\d+):(.*)$/s);
  if (!m) return null;
  return { status: Number(m[1]), body: m[2] };
}

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
  const modelId = model || DEFAULT_GEMINI_MODEL;
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
    throw new Error(`gemini:${res.status}:${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
}

export async function fetchGeminiResolving({
  apiKey,
  model,
  userText,
  mode,
  context,
  fetchImpl = fetch,
  onModelResolved,
}) {
  const order = geminiTryOrder(model || DEFAULT_GEMINI_MODEL);
  let lastError;
  for (const modelId of order) {
    try {
      const text = await fetchGemini({ apiKey, model: modelId, userText, mode, context, fetchImpl });
      if (onModelResolved) onModelResolved(modelId);
      return { text, model: modelId };
    } catch (error) {
      lastError = error;
      const parsed = parseGeminiError(error.message);
      if (parsed && geminiModelUnavailable(parsed.status, parsed.body)) continue;
      throw error;
    }
  }
  const names = await listGeminiModels(apiKey, fetchImpl);
  const picked = pickGeminiModelFromList(names, GEMINI_MODEL_CANDIDATES);
  if (picked && !order.includes(picked)) {
    try {
      const text = await fetchGemini({ apiKey, model: picked, userText, mode, context, fetchImpl });
      if (onModelResolved) onModelResolved(picked);
      return { text, model: picked };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("gemini:404:no available flash model");
}

export async function callInventoryModel({ provider, apiKey, model, mode, userText, inventory, fetchImpl = fetch, storage }) {
  const context = compactInventoryContext(inventory);
  let text;
  let resolvedModel = model;
  if (provider === "gemini") {
    const out = await fetchGeminiResolving({
      apiKey,
      model: model || DEFAULT_GEMINI_MODEL,
      userText,
      mode,
      context,
      fetchImpl,
      onModelResolved: (m) => {
        resolvedModel = m;
        if (storage) writeAiSettings(storage, { geminiModel: m });
      },
    });
    text = out.text;
    resolvedModel = out.model;
  } else {
    text = await fetchAnthropic({ apiKey, model, userText, mode, context, fetchImpl });
  }
  const parsed = parseJsonLoose(text);
  if (mode === "search") return { kind: "search", data: parsed, model: resolvedModel };
  return { kind: "update", data: parsed, model: resolvedModel };
}

export async function testInventoryAiKey({ provider, apiKey, fetchImpl = fetch, storage }) {
  if (!apiKey?.trim()) return { ok: false, message: "Paste an API key first." };
  const probe = '{"changes":[{"action":"add","item":"Test hooks","place":["Kitchen"],"stock":"plenty","note":""}]}';
  try {
    const context = { items: [{ name: "Spare hooks", aliases: [] }], places: ["Kitchen drawer"] };
    if (provider === "gemini") {
      const startModel = storage ? readAiSettings(storage).geminiModel : DEFAULT_GEMINI_MODEL;
      const { text, model } = await fetchGeminiResolving({
        apiKey: apiKey.trim(),
        model: startModel,
        userText: probe,
        mode: "update",
        context,
        fetchImpl,
        onModelResolved: (m) => {
          if (storage) writeAiSettings(storage, { geminiModel: m });
        },
      });
      if (!String(text || "").trim()) return { ok: false, message: "Empty response from the provider." };
      return { ok: true, message: `Key works (model: ${model}).`, model };
    }
    const text = await fetchAnthropic({
      apiKey: apiKey.trim(),
      model: AI_MODEL_IDS.anthropic,
      userText: probe,
      mode: "update",
      context,
      fetchImpl,
    });
    if (!String(text || "").trim()) return { ok: false, message: "Empty response from the provider." };
    return { ok: true, message: `Key works (model: ${AI_MODEL_IDS.anthropic}).`, model: AI_MODEL_IDS.anthropic };
  } catch (error) {
    return { ok: false, message: String(error.message || error).replace(apiKey, "•••") };
  }
}

export async function understandUpdateSmart(text, inventory, { settings, lastItemId = null, fetchImpl = fetch, storage } = {}) {
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
        model: provider === "gemini" ? (settings.geminiModel || DEFAULT_GEMINI_MODEL) : AI_MODEL_IDS.anthropic,
        mode: "update",
        userText: said,
        inventory,
        fetchImpl,
        storage,
      }), AI_TIMEOUT_MS);
      const payload = validateUpdatePayload(raw.data);
      if (payload) return packUpdateResult(payload, inventory, said, lastItemId, provider);
    } catch { /* rules */ }
    return rules("Timed out or unavailable — used basic matching.");
  }

  return rules("");
}

export async function understandSearchSmart(text, inventory, { settings, fetchImpl = fetch, storage } = {}) {
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
      model: provider === "gemini" ? (settings.geminiModel || DEFAULT_GEMINI_MODEL) : AI_MODEL_IDS.anthropic,
      mode: "search",
      userText: text,
      inventory,
      fetchImpl,
      storage,
    }), AI_TIMEOUT_MS);
    const valid = validateSearchPayload(raw.data, inventory);
    if (valid) return { parsed, source: provider, matches: valid.matches, fallback: false };
  } catch { /* rules */ }
  return { parsed, source: "rules", matches: null, fallback: true };
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