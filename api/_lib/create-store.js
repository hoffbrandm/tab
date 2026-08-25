import { resolve } from "node:path";
import { HttpError } from "./http-error.js";
import { createFileStore } from "./file-store.js";
import { createGitHubStore } from "./github-store.js";

export function createStoreFromEnv(env, extras = {}) {
  const driver = env.STORE_DRIVER || (env.GITHUB_TOKEN ? "github" : "");
  if (driver === "file") {
    return createFileStore({
      filePath: extras.filePath || resolve(process.cwd(), env.GITHUB_DATA_PATH || "data/tab.json"),
    });
  }
  if (driver === "github" || env.GITHUB_TOKEN) {
    return createGitHubStore({
      token: env.GITHUB_TOKEN,
      repo: env.GITHUB_REPO || "hoffbrandm/tab",
      path: env.GITHUB_DATA_PATH || "data/tab.json",
      fetchImpl: extras.fetchImpl || fetch,
    });
  }
  throw new HttpError(503, "No store is configured. Set GITHUB_TOKEN, or STORE_DRIVER=file for local use.");
}
