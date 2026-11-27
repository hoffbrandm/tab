/**
 * On-device inventory understanding via WebLLM (WebGPU). Weights cache in the
 * browser; nothing is sent off the phone except optional cloud fallback.
 */

import {
  compactInventoryContext,
  parseJsonLoose,
  systemPrompt,
  validateSearchPayload,
  validateUpdatePayload,
} from "./inventory-understand-schema.js";
import { clearOnDeviceInstalled, onDeviceMarkedInstalled } from "./inventory-ai-settings.js";

/** ~770–850 MB q4; best fit under ~1 GB on iPhone with WebGPU (iOS 26+). */
export const ONDEVICE_MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
export const ONDEVICE_MODEL_LABEL = "Llama 3.2 1B Instruct";
export const ONDEVICE_MODEL_SIZE = "~800 MB";
export const WEB_LLM_CDN = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/lib/index.js";

let engine = null;
let state = "idle"; // idle | downloading | ready | failed
let loading = null;
const listeners = new Set();

export function onDeviceState() {
  return state;
}

export function onOnDeviceState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next) {
  state = next;
  for (const fn of listeners) {
    try { fn(next); } catch { /* screen gone */ }
  }
}

export function webGpuUsable(win = globalThis) {
  return Boolean(win?.navigator?.gpu);
}

export function connectionIsCellular(win = globalThis) {
  const c = win?.navigator?.connection;
  if (!c) return false;
  if (c.saveData) return true;
  return c.type === "cellular";
}

export function setEngineForTests(mock) {
  engine = mock;
  setState(mock ? "ready" : "idle");
}

export async function importWebLlm(importer = (url) => import(url)) {
  return importer(WEB_LLM_CDN);
}

export async function ensureOnDeviceEngine({
  importer,
  onProgress,
  storage,
  forceCellular = false,
} = {}) {
  if (engine && state === "ready") return engine;
  if (loading) return loading;
  if (!webGpuUsable()) {
    setState("failed");
    throw new Error("no-webgpu");
  }
  if (!forceCellular && connectionIsCellular() && storage) {
    const { readAiSettings } = await import("./inventory-ai-settings.js");
    if (!readAiSettings(storage).allowCellularDownload) {
      throw new Error("cellular-blocked");
    }
  }
  loading = (async () => {
    setState("downloading");
    try {
      const webllm = await importWebLlm(importer);
      engine = await webllm.CreateMLCEngine(ONDEVICE_MODEL_ID, {
        initProgressCallback: (report) => onProgress?.(report),
      });
      onDeviceMarkedInstalled(storage);
      setState("ready");
      return engine;
    } catch (error) {
      engine = null;
      setState("failed");
      throw error;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export async function unloadOnDeviceEngine({ storage } = {}) {
  if (engine?.unload) {
    try { await engine.unload(); } catch { /* already gone */ }
  }
  engine = null;
  loading = null;
  setState("idle");
  if (storage) clearOnDeviceInstalled(storage);
}

async function completeJson({ mode, userText, inventory, engine: eng }) {
  const active = eng || engine;
  if (!active) throw new Error("not-ready");
  const context = compactInventoryContext(inventory);
  const messages = [
    { role: "system", content: systemPrompt(mode, context) },
    { role: "user", content: userText },
  ];
  const reply = await active.chat.completions.create({
    messages,
    temperature: 0.1,
    max_tokens: 700,
    response_format: { type: "json_object" },
  });
  const text = reply?.choices?.[0]?.message?.content || "";
  const data = parseJsonLoose(text);
  if (mode === "search") return validateSearchPayload(data, inventory);
  return validateUpdatePayload(data);
}

export async function onDeviceUnderstandUpdate(text, inventory, opts = {}) {
  const payload = await completeJson({ mode: "update", userText: text, inventory, ...opts });
  if (!payload) throw new Error("bad-json");
  return payload;
}

export async function onDeviceUnderstandSearch(text, inventory, opts = {}) {
  const payload = await completeJson({ mode: "search", userText: text, inventory, ...opts });
  if (!payload) throw new Error("bad-json");
  return payload;
}