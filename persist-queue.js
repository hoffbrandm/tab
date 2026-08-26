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
    inFlight = Promise.resolve()
      .then(() => persist?.())
      .finally(() => {
        inFlight = null;
        if (queued) flush();
      });
    return inFlight;
  }

  return { applyLocal, schedule, flush };
}
