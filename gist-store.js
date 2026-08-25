import { emptyStore, parseStore, StoreError } from "./store.js";

export const GIST_DESCRIPTION = "tab.personal.v1";
export const GIST_FILENAME = "tab.json";
const GITHUB_API = "https://api.github.com";

export class GistError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "GistError";
    this.status = status;
  }
}

export function pickGist(gists, { description = GIST_DESCRIPTION, filename = GIST_FILENAME } = {}) {
  const matches = (gists || []).filter((gist) => gist && gist.description === description);
  matches.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  return matches.find((gist) => gist.files && gist.files[filename]) || matches[0] || null;
}

export function storeToGistContent(store) {
  return `${JSON.stringify(parseStore(store), null, 2)}\n`;
}

export function parseGistContent(text) {
  if (!text || !String(text).trim()) return emptyStore();
  try {
    return parseStore(JSON.parse(text));
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new GistError("The private gist is not valid JSON.");
  }
}

export function createGistStore({
  token,
  fetchImpl = fetch,
  description = GIST_DESCRIPTION,
  filename = GIST_FILENAME,
} = {}) {
  if (!token) throw new GistError("A GitHub token is required.");

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
    if (response.status === 401) {
      throw new GistError("That GitHub token was rejected.", 401);
    }
    if (response.status === 403) {
      throw new GistError("GitHub refused access. Use a token that can read and write gists.", 403);
    }
    if (!response.ok) {
      throw new GistError(`GitHub could not complete that request (${response.status}).`, response.status);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function identify() {
    const user = await github("/user");
    if (!user?.login) throw new GistError("GitHub did not return a user.");
    return { login: user.login };
  }

  async function listGists() {
    const gists = [];
    for (let page = 1; page <= 20; page += 1) {
      const batch = await github(`/gists?per_page=100&page=${page}`);
      if (!Array.isArray(batch) || batch.length === 0) break;
      gists.push(...batch);
      if (batch.length < 100) break;
    }
    return gists;
  }

  async function createGist() {
    return github("/gists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        public: false,
        files: { [filename]: { content: storeToGistContent(emptyStore()) } },
      }),
    });
  }

  async function ensure() {
    const found = pickGist(await listGists(), { description, filename });
    if (found) return found;
    return createGist();
  }

  async function readFileText(gist) {
    const file = gist.files?.[filename];
    if (!file) return "";
    if (file.truncated && file.raw_url) {
      const response = await fetchImpl(file.raw_url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw" },
      });
      if (!response.ok) throw new GistError("The private gist could not be downloaded.");
      return response.text();
    }
    return file.content || "";
  }

  async function read() {
    const gist = await ensure();
    if (gist.public) {
      await github(`/gists/${gist.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public: false }),
      });
    }
    return { store: parseGistContent(await readFileText(gist)), gistId: gist.id };
  }

  async function write(store, gistId) {
    const parsed = parseStore(store);
    const id = gistId || (await ensure()).id;
    const updated = await github(`/gists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public: false,
        files: { [filename]: { content: storeToGistContent(parsed) } },
      }),
    });
    return { store: parsed, gistId: updated.id };
  }

  return { identify, listGists, ensure, read, write };
}
