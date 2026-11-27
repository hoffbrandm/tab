/**
 * One tap to speak, using the browser's own speech recognition
 * (webkitSpeechRecognition on iPhone, which hands audio to Apple's dictation
 * service the same way the keyboard mic does). No key, no account.
 *
 * iPhone caveats this works around rather than hides:
 * - Home-screen web apps only got the API in iOS 17; older ones fall back to
 *   the text box, where the keyboard's own mic still dictates.
 * - iOS 27 has a known bug (WebKit 326069) where a second session in the same
 *   page can open the mic and then hear nothing. A watchdog stops a session
 *   that hears nothing for a few seconds and says to use the keyboard mic.
 * - iOS may ask for microphone and speech permission again after the app has
 *   been closed; that prompt is the system's, not ours.
 */

export function speechSupported(win = globalThis) {
  return Boolean(win?.SpeechRecognition || win?.webkitSpeechRecognition);
}

const MESSAGES = {
  "not-allowed": "Microphone or speech access is off for Tab. Type instead, or use the mic on the keyboard.",
  "service-not-allowed": "Speech isn’t available here. Use the mic on the keyboard instead.",
  "no-speech": "Didn’t hear anything. Tap the box and use the keyboard mic, or try again.",
  "audio-capture": "No microphone was found.",
  network: "Speech needs a connection. Type instead.",
  aborted: "",
};

export function speechErrorMessage(code) {
  return MESSAGES[code] ?? "Speech stopped. Type instead, or use the keyboard mic.";
}

/**
 * Start listening. Interim text streams to onText; onDone gets the final text
 * after a short pause in speech. Returns a handle with stop() and cancel().
 */
export function listen({
  win = globalThis,
  lang = "en-GB",
  onText = () => {},
  onDone = () => {},
  onError = () => {},
  onState = () => {},
  pauseMs = 1600,
  nothingMs = 6500,
} = {}) {
  const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!Recognition) {
    onError("service-not-allowed");
    return { stop() {}, cancel() {} };
  }
  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = "";
  let interim = "";
  let heard = false;
  let finished = false;
  let cancelled = false;
  let pauseTimer = null;
  const nothingTimer = setTimeout(() => {
    if (!heard && !finished) {
      finished = true;
      try { recognition.abort(); } catch { /* already stopped */ }
      onState("idle");
      onError("no-speech");
    }
  }, nothingMs);

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(nothingTimer);
    clearTimeout(pauseTimer);
    onState("idle");
    if (cancelled) return;
    const text = `${finalText} ${interim}`.replace(/\s+/g, " ").trim();
    if (text) onDone(text);
    else onError("no-speech");
  }

  recognition.onstart = () => onState("listening");
  recognition.onresult = (event) => {
    heard = true;
    interim = "";
    let done = "";
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) done += ` ${result[0].transcript}`;
      else interim += ` ${result[0].transcript}`;
    }
    finalText = done.trim();
    onText(`${finalText} ${interim}`.replace(/\s+/g, " ").trim());
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => {
      try { recognition.stop(); } catch { finish(); }
    }, pauseMs);
  };
  recognition.onerror = (event) => {
    if (finished) return;
    if (event.error === "no-speech" && heard) return;
    finished = true;
    clearTimeout(nothingTimer);
    clearTimeout(pauseTimer);
    onState("idle");
    if (!cancelled && event.error !== "aborted") onError(event.error || "unknown");
  };
  recognition.onend = () => finish();

  try {
    recognition.start();
  } catch (error) {
    finished = true;
    clearTimeout(nothingTimer);
    onError("service-not-allowed");
  }
  return {
    stop() {
      try { recognition.stop(); } catch { finish(); }
    },
    cancel() {
      cancelled = true;
      try { recognition.abort(); } catch { /* fine */ }
      finish();
    },
  };
}
