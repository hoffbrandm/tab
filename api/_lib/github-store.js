import { HttpError } from "./http-error.js";
import { emptyStore, parseStore } from "./store.js";

const GITHUB_API = "https://api.github.com";

export function createGitHubStore({ token, repo, path, fetchImpl = fetch }) {
  if (!token) throw new HttpError(503, "GITHUB_TOKEN is not configured.");
  if (!repo || !repo.includes("/")) throw new HttpError(503, "GITHUB_REPO must look like owner/name.");
  if (!path) throw new HttpError(503, "GITHUB_DATA_PATH is not configured.");

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "tab-personal-expense-tracker",
  };

  async function github(url, init = {}) {
    const response = await fetchImpl(url, {
      ...init,
      headers: { ...headers, ...init.headers },
    });
    return response;
  }

  async function read() {
    const response = await github(`${GITHUB_API}/repos/${repo}/contents/${encodeURI(path)}`);
    if (response.status === 404) return { store: emptyStore(), sha: null };
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(503, githubAuthMessage(response.status));
    }
    if (!response.ok) {
      throw new HttpError(502, `GitHub could not read the tab (${response.status}).`);
    }
    const payload = await response.json();
    if (payload.encoding !== "base64" || typeof payload.content !== "string") {
      throw new HttpError(502, "GitHub returned a tab file that could not be decoded.");
    }
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(payload.content, "base64").toString("utf8"));
    } catch {
      throw new HttpError(502, "The GitHub tab file is not valid JSON.");
    }
    return { store: parseStore(parsed), sha: payload.sha };
  }

  async function write(store, sha) {
    const parsed = parseStore(store);
    const content = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8").toString("base64");
    const body = {
      message: "Update tab [skip ci]",
      content,
    };
    if (sha) body.sha = sha;
    const response = await github(`${GITHUB_API}/repos/${repo}/contents/${encodeURI(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 409 || response.status === 422) {
      const current = await read();
      throw new HttpError(409, "The tab was updated elsewhere. Reload and try again.", current);
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(503, githubAuthMessage(response.status));
    }
    if (!response.ok) {
      throw new HttpError(502, `GitHub could not save the tab (${response.status}).`);
    }
    const payload = await response.json();
    return { store: parsed, sha: payload.content?.sha || sha };
  }

  return { read, write };
}

function githubAuthMessage(status) {
  if (status === 401) return "The GitHub token was rejected. Check GITHUB_TOKEN.";
  return "GitHub refused access to the tab file. Check that the token can read and write this repository.";
}
