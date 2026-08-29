// Stage the public static site into _site/ for GitHub Pages.
//
// The published file list is walked from index.html's entry module rather than
// written by hand. A hand-written list went stale every time a module was
// added — home-sections.js, persist-queue.js and swipe-row.js were all imported
// by the deployed app.js and none of them was ever copied, so the module graph
// could not resolve and the site did not boot. Walking the graph publishes a
// new module with the app that imports it, and never publishes a test-only or
// server-only file, which is the property the hand-written list kept losing.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The one file everything else is reached from. */
export const ENTRY_HTML = "index.html";

/** Never publish these, whatever the graph says: they are not the app. */
export const NEVER_PUBLISH = ["test", "server.mjs", "stage-site.mjs", "node_modules", ".git"];

const MODULE_SRC = /<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i;
// A stylesheet, an icon, the manifest — anything the page names by href or src.
// Skips absolute URLs, data: URIs and in-page anchors, which are not ours.
const HTML_ASSET = /\b(?:href|src)=["'](?!https?:|data:|mailto:|#|\/\/)([^"']+)["']/gi;
// Covers `from "./x.js"`, a bare `import "./x.js"`, and `import("./x.js")`.
const RELATIVE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(?\s*)["'](\.\/[^"']+)["']/g;

export function entryModuleOf(html) {
  const found = String(html).match(MODULE_SRC);
  if (!found) throw new Error("index.html has no <script type=\"module\" src=…>");
  return found[1].replace(/^\.\//, "");
}

/**
 * Every local file the page names. The published list used to be written by
 * hand, which is how three modules went missing and the site stopped booting;
 * the modules are walked now, and so are the assets, for the same reason —
 * adding an icon should not mean remembering to add it to a list as well.
 */
export function assetsReferencedBy(html) {
  const names = new Set();
  for (const [, path] of String(html).matchAll(HTML_ASSET)) names.add(path.replace(/^\.\//, ""));
  return [...names];
}

/** The icons a web app manifest names, which the page never mentions itself. */
export function manifestIcons(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("manifest.webmanifest is not valid JSON");
  }
  return (parsed.icons || [])
    .map((icon) => String(icon?.src || "").replace(/^\.\//, ""))
    .filter(Boolean);
}

/** Everything to publish that is not reached by an import: the entry included. */
export function staticAssetsFrom(read) {
  const found = new Set([ENTRY_HTML]);
  for (const name of assetsReferencedBy(read(ENTRY_HTML))) found.add(name);
  for (const name of [...found]) {
    if (name.endsWith(".webmanifest") || name.endsWith("manifest.json")) {
      for (const icon of manifestIcons(read(name))) found.add(icon);
    }
  }
  return [...found].sort();
}

export function relativeImportsOf(source) {
  const names = new Set();
  for (const [, path] of String(source).matchAll(RELATIVE_IMPORT)) names.add(path.replace(/^\.\//, ""));
  return [...names];
}

/**
 * Every module the entry reaches, the entry included. `read` returns a file's
 * source; it throws for a module that does not exist, which is the failure this
 * whole script is here to catch — loudly, at build time, not in the browser.
 */
export function moduleGraphFrom(entry, read) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const next of relativeImportsOf(read(name))) queue.push(next);
  }
  return [...seen].sort();
}

function main() {
  const root = dirname(fileURLToPath(import.meta.url));
  const out = join(root, "_site");
  const read = (name) => {
    const path = join(root, name);
    if (!existsSync(path)) throw new Error(`${name} is imported but does not exist`);
    return readFileSync(path, "utf8");
  };

  const entry = entryModuleOf(read(ENTRY_HTML));
  const modules = moduleGraphFrom(entry, read);
  const published = [...new Set([...staticAssetsFrom(read), ...modules])].sort();

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const name of published) copyFileSync(join(root, name), join(out, name));

  for (const name of NEVER_PUBLISH) {
    if (existsSync(join(out, name))) throw new Error(`${name} must never be published`);
  }
  // Prove the published graph resolves against _site itself, not the checkout.
  for (const name of modules) {
    for (const next of relativeImportsOf(readFileSync(join(out, name), "utf8"))) {
      if (!existsSync(join(out, next))) throw new Error(`${name} imports ${next}, which was not published`);
    }
  }
  console.log(`Staged ${published.length} files into _site:\n  ${published.join("\n  ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
