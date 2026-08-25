import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HttpError } from "./http-error.js";
import { emptyStore, parseStore } from "./store.js";

export function createFileStore({ filePath }) {
  if (!filePath) throw new HttpError(503, "File store path is not configured.");

  async function read() {
    try {
      const text = await readFile(filePath, "utf8");
      return { store: parseStore(JSON.parse(text)), sha: shaOf(text) };
    } catch (error) {
      if (error.code === "ENOENT") return { store: emptyStore(), sha: null };
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, "The local tab file could not be read.");
    }
  }

  async function write(store, sha) {
    const current = await read();
    if (current.sha && sha !== current.sha) {
      throw new HttpError(409, "The tab was updated elsewhere. Reload and try again.", current);
    }
    const parsed = parseStore(store);
    const text = `${JSON.stringify(parsed, null, 2)}\n`;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, text, "utf8");
    return { store: parsed, sha: shaOf(text) };
  }

  return { read, write };
}

function shaOf(text) {
  return createHash("sha1").update(text).digest("hex");
}
