/** Flip local state first; persist later. One write in flight, one write queued. */

export function createPersistQueue({ persist, debounceMs = 400 } = {}) {
  let timer = null;
  let inFlight = null;
  let queued = false;

  function applyLocal(mutator, { render } = {}) {
    mutator();
    render?.();
    schedule();
  }

  function schedule() {
    queued = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, debounceMs);
  }

  async function flush() {
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    if (!queued) return;
    queued = false;
    // A failed write already reports itself; swallow it here so a rejection
    // never escapes the debounce timer as an unhandled error, and so the next
    // change still gets its own attempt.
    inFlight = Promise.resolve()
      .then(() => persist?.())
      .catch(() => {})
      .finally(() => {
        inFlight = null;
        if (queued) flush();
      });
    return inFlight;
  }

  return { applyLocal, schedule, flush };
}
