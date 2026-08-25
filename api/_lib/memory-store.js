import { HttpError } from "./http-error.js";
import { emptyStore, parseStore } from "./store.js";

export function createMemoryStore(initial = emptyStore(), initialSha = "mem-1") {
  let current = { store: parseStore(initial), sha: initialSha };

  return {
    async read() {
      return { store: structuredClone(current.store), sha: current.sha };
    },
    async write(store, sha) {
      if (current.sha && sha !== current.sha) {
        throw new HttpError(409, "The tab was updated elsewhere. Reload and try again.", {
          store: structuredClone(current.store),
          sha: current.sha,
        });
      }
      current = { store: parseStore(store), sha: `mem-${current.sha ? Number(String(current.sha).replace(/\D/g, "") || 1) + 1 : 2}` };
      return { store: structuredClone(current.store), sha: current.sha };
    },
  };
}
