import { emptyInventory, INVENTORY_FILENAME, inventoryToContent, mergeInventories, parseInventory } from "./inventory.js";

/**
 * The inventory is its own file, inventory.json, in the same private gist as
 * tab.json. A gist PATCH only touches the files it names, so saving the
 * inventory never rewrites the household, and saving the household never
 * rewrites the inventory.
 */

const GITHUB_API = "https://api.github.com";

export class InventoryError extends Error {
  constructor(message, code = "") {
    super(message);
    this.name = "InventoryError";
    this.code = code;
  }
}

export function createInventoryStore({ token, fetchImpl = (...args) => fetch(...args), filename = INVENTORY_FILENAME } = {}) {
  if (!token) throw new InventoryError("A GitHub token is required.");

  async function github(path, init = {}) {
    const response = await fetchImpl(`${GITHUB_API}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    });
    if (!response.ok) throw new InventoryError(`GitHub could not complete that request (${response.status}).`, String(response.status));
    return response.json();
  }

  async function read(gistId) {
    if (!gistId) throw new InventoryError("The private gist is not open yet.");
    const gist = await github(`/gists/${gistId}`);
    const file = gist?.files?.[filename];
    if (!file) return { inventory: emptyInventory(), exists: false };
    let text = typeof file.content === "string" && !file.truncated ? file.content : null;
    if (text == null && file.raw_url) {
      const raw = await fetchImpl(file.raw_url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw" } });
      if (!raw.ok) throw new InventoryError("The inventory could not be downloaded.", String(raw.status));
      text = await raw.text();
    }
    if (!text || !text.trim()) return { inventory: emptyInventory(), exists: true };
    try {
      return { inventory: parseInventory(JSON.parse(text)), exists: true };
    } catch {
      // Never write over a file we could not read: that would lose it.
      throw new InventoryError("inventory.json in your gist is not valid JSON, so Tab will not overwrite it.", "corrupt");
    }
  }

  /** Read, merge in anything another phone saved, then write the merged list. */
  async function write(local, gistId) {
    const remote = await read(gistId);
    const merged = mergeInventories(local, remote.inventory);
    await github(`/gists/${gistId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: { [filename]: { content: inventoryToContent(merged) } } }),
    });
    return merged;
  }

  return { read, write };
}

/** For the local workbook on localhost: nothing leaves the page. */
export function createMemoryInventoryStore(initial = emptyInventory()) {
  let held = parseInventory(initial);
  return {
    async read() { return { inventory: parseInventory(held), exists: true }; },
    async write(local) { held = mergeInventories(local, held); return parseInventory(held); },
  };
}
