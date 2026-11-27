import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GEMINI_MODEL, LEGACY_GEMINI_MODEL } from "../inventory-gemini-models.js";
import { fetchGeminiResolving } from "../inventory-ai.js";
import { INV_AI_STORAGE_KEY, readAiSettings, writeAiSettings } from "../inventory-ai-settings.js";

test("DEFAULT_GEMINI_MODEL targets new free-tier flash-lite", () => {
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
});

test("readAiSettings migrates keyed v1 storage without geminiModel", () => {
  const storage = new Map();
  const mock = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };
  mock.setItem(INV_AI_STORAGE_KEY, JSON.stringify({
    provider: "gemini",
    apiKey: "k",
    smartUnderstanding: true,
  }));
  const got = readAiSettings(mock);
  assert.equal(got.geminiModel, DEFAULT_GEMINI_MODEL);
});

test("fetchGeminiResolving tries next model after 404 on legacy", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.includes(LEGACY_GEMINI_MODEL)) {
      return {
        ok: false,
        status: 404,
        async text() {
          return "This model models/gemini-2.5-flash-lite is no longer available to new users";
        },
      };
    }
    if (url.includes(DEFAULT_GEMINI_MODEL)) {
      return {
        ok: true,
        async json() {
          return { candidates: [{ content: { parts: [{ text: '{"changes":[]}' }] } }] };
        },
        async text() { return ""; },
      };
    }
    return { ok: false, status: 404, async text() { return "missing"; } };
  };
  let saved = "";
  const { text, model } = await fetchGeminiResolving({
    apiKey: "test-key",
    model: LEGACY_GEMINI_MODEL,
    userText: "{}",
    mode: "update",
    context: { items: [], places: [] },
    fetchImpl,
    onModelResolved: (m) => { saved = m; },
  });
  assert.ok(text.includes("changes"));
  assert.equal(model, DEFAULT_GEMINI_MODEL);
  assert.equal(saved, DEFAULT_GEMINI_MODEL);
  assert.ok(calls.some((u) => u.includes(LEGACY_GEMINI_MODEL)));
  assert.ok(calls.some((u) => u.includes(DEFAULT_GEMINI_MODEL)));
});

test("models.list picks a flash model when fixed candidates all fail", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/models?")) {
      return {
        ok: true,
        async json() {
          return {
            models: [
              { name: "models/gemini-embeddings", supportedGenerationMethods: ["embedContent"] },
              { name: "models/gemini-3.1-flash-lite", supportedGenerationMethods: ["generateContent"] },
            ],
          };
        },
      };
    }
  if (url.includes("gemini-3.1-flash-lite:generateContent")) {
      return {
        ok: true,
        async json() {
          return { candidates: [{ content: { parts: [{ text: "{}" }] } }] };
        },
        async text() { return ""; },
      };
    }
    return { ok: false, status: 404, async text() { return "no longer available"; } };
  };
  const { model } = await fetchGeminiResolving({
    apiKey: "key",
    model: LEGACY_GEMINI_MODEL,
    userText: "x",
    mode: "update",
    context: { items: [], places: [] },
    fetchImpl,
  });
  assert.equal(model, "gemini-3.1-flash-lite");
});

test("test key persists working geminiModel", async () => {
  const storage = new Map();
  const mockStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };
  writeAiSettings(mockStorage, { provider: "gemini", apiKey: "key", smartUnderstanding: true });
  const { testInventoryAiKey } = await import("../inventory-ai.js");
  const fetchImpl = async (url) => {
    if (url.includes("/models?")) return { ok: true, async json() { return { models: [] }; } };
    if (url.includes("generateContent")) {
      return {
        ok: true,
        async json() {
          return { candidates: [{ content: { parts: [{ text: '{"changes":[{"action":"add","item":"T","place":[],"stock":"plenty","note":""}]}' }] } }] };
        },
        async text() { return ""; },
      };
    }
    return { ok: false, status: 404, async text() { return "unavailable"; } };
  };
  const result = await testInventoryAiKey({ provider: "gemini", apiKey: "key", fetchImpl, storage: mockStorage });
  assert.equal(result.ok, true);
  assert.match(result.message, /Key works \(model: gemini-/);
  assert.equal(readAiSettings(mockStorage).geminiModel, result.model);
});