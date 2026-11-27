# Inventory smart understanding

## On-device (primary)

- **Model:** Llama 3.2 1B Instruct (`Llama-3.2-1B-Instruct-q4f16_1-MLC`) via [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm)
- **Download:** More → Smart understanding → **Download model** (~800 MB). Requires **WebGPU** (iOS 26+ Safari standalone).
- **Caching:** WebLLM stores weights in the browser cache / IndexedDB for offline reuse.
- **Mobile data:** Off by default; enable “Allow download on mobile data” before downloading on cellular.

Smaller models (e.g. Qwen2.5-0.5B) load faster but parse natural language less reliably; 1B q4 is the largest we target under ~1 GB on iPhone.

## Cloud fallback (optional)

Anthropic `claude-haiku-4-5` or Gemini `gemini-2.5-flash-lite` only when on-device is unavailable and you enable cloud fallback + paste a key in **localStorage** (never in the gist).

## Apple Shortcuts (iOS 26)

Use the **Use Model** action (on-device Apple Intelligence) to turn dictation into JSON, then open Tab:

1. **Dictate Text** (or receive spoken text).
2. **Use Model** — prompt: extract `name`, `location`, `stock` (`plenty`|`low`|`out`) as JSON only.
3. **URL** — `https://hoffbrandm.github.io/tab/#/inventory?add=` + **URL Encode** the JSON string.

Example JSON (before encoding):

```json
{"name":"3D printer filament","location":"Office","stock":"out"}
```

Tab opens the inventory check card when signed in and inventory is loaded.

Rough cloud cost if fallback is used: ~100 updates ≈ **$0.02–0.08** (Haiku) or **free tier / ~$0.01** (Gemini flash-lite), depending on utterance length.