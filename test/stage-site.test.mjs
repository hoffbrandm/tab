import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  entryModuleOf,
  moduleGraphFrom,
  relativeImportsOf,
  assetsReferencedBy,
  manifestIcons,
  staticAssetsFrom,
  NEVER_PUBLISH,
  ENTRY_HTML,
} from "../stage-site.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(root, name), "utf8");

test("every published module parses", () => {
  // The rest of the suite reads app.js as text, so a module that does not parse
  // passes every test and fails in the browser. Nothing else catches it: only
  // the browser ever executes these files.
  const modules = moduleGraphFrom(entryModuleOf(read("index.html")), read);
  assert.ok(modules.includes("app.js"));
  for (const name of modules) {
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ["--check", join(root, name)], { stdio: "pipe" }),
      `${name} does not parse`,
    );
  }
});

test("the entry module is read off index.html, not assumed", () => {
  assert.equal(entryModuleOf(read("index.html")), "app.js");
  assert.equal(entryModuleOf('<script type="module" src="./main.js"></script>'), "main.js");
  assert.equal(entryModuleOf("<script type='module' defer src='app.js'></script>"), "app.js");
  // A classic script is not an entry module, and neither is nothing at all.
  assert.throws(() => entryModuleOf('<script src="app.js"></script>'), /no <script/);
});

test("every shape of relative import counts, and nothing else does", () => {
  const source = `
    import { a } from "./one.js";
    import * as b from './two.js';
    import "./three.js";
    const c = await import("./four.js");
    export { d } from "./five.js";
    import { e } from "https://cdn.example/six.js";
    import f from "node:fs";
  `;
  assert.deepEqual(relativeImportsOf(source).sort(), ["five.js", "four.js", "one.js", "three.js", "two.js"]);
});

test("the graph is transitive, deduped, and survives a cycle", () => {
  const files = {
    "app.js": 'import "./a.js"; import "./b.js";',
    "a.js": 'import "./deep.js";',
    "b.js": 'import "./deep.js"; import "./app.js";',
    "deep.js": "",
  };
  assert.deepEqual(moduleGraphFrom("app.js", (name) => files[name]), ["a.js", "app.js", "b.js", "deep.js"]);
});

test("the real app publishes every module it imports, and only those", () => {
  const published = moduleGraphFrom(entryModuleOf(read("index.html")), read);
  // The three the hand-written list kept missing: the site did not boot without
  // them, so a regression here is a blank page in production.
  assert.ok(published.includes("home-sections.js"));
  assert.ok(published.includes("persist-queue.js"));
  assert.ok(published.includes("swipe-row.js"));
  assert.deepEqual(published, [
    "app.js",
    "calculations.js",
    "gist-store.js",
    "home-sections.js",
    "household.js",
    "persist-queue.js",
    "session.js",
    "store.js",
    "swipe-row.js",
  ]);
  // Test-only and server-only files are not reachable from the app, so the
  // walk leaves them behind without having to name them.
  for (const name of ["workbook-import.js", "xlsx.js", "server.mjs", "stage-site.mjs"]) {
    assert.ok(!published.includes(name), `${name} must not be published`);
  }
});

test("a module that is imported but missing fails the build, loudly", () => {
  const files = { "app.js": 'import "./gone.js";' };
  assert.throws(
    () => moduleGraphFrom("app.js", (name) => {
      if (!(name in files)) throw new Error(`${name} is imported but does not exist`);
      return files[name];
    }),
    /gone\.js is imported but does not exist/,
  );
});

test("the never-publish list keeps the private files out", () => {
  for (const name of ["test", "server.mjs", "node_modules", ".git"]) assert.ok(NEVER_PUBLISH.includes(name));
  assert.equal(ENTRY_HTML, "index.html");
});

test("every asset the page names is published, without a list to keep", () => {
  // The modules are walked because a hand-written list went stale and the site
  // stopped booting. The assets are walked for the same reason: adding an icon
  // should not also mean remembering to add it to a list.
  const named = assetsReferencedBy(`
    <link rel="icon" href="favicon.svg" />
    <link rel="apple-touch-icon" href="./apple-touch-icon.png" />
    <link rel='manifest' href='manifest.webmanifest'>
    <link rel="stylesheet" href="styles.css" />
    <script type="module" src="app.js"></script>
    <a href="https://example.com/x.css">off-site</a>
    <a href="#/home">in-page</a>
    <img src="data:image/svg+xml;utf8,<svg/>" />
  `);
  assert.deepEqual(named, ["favicon.svg", "apple-touch-icon.png", "manifest.webmanifest", "styles.css", "app.js"]);

  // The manifest names icons the page never mentions.
  assert.deepEqual(
    manifestIcons('{"icons":[{"src":"icon-192.png"},{"src":"./icon-512.png"},{"src":""}]}'),
    ["icon-192.png", "icon-512.png"],
  );
  assert.throws(() => manifestIcons("not json"), /not valid JSON/);

  // End to end, off the real files: every icon the app ships is published.
  const published = staticAssetsFrom(read);
  for (const name of ["index.html", "styles.css", "favicon.svg", "manifest.webmanifest",
    "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
    assert.ok(published.includes(name), `${name} should be published`);
  }
});

test("the home-screen icon is drawn, not typed", () => {
  // A <text> icon renders in whatever font the device happens to have, so the
  // mark is rects. iOS also ignores both an SVG icon and the manifest's icons,
  // which is why the touch icon is its own PNG.
  const svg = read("favicon.svg");
  assert.doesNotMatch(svg, /<text|font-family/);
  assert.match(svg, /<rect/);
  const html = read(ENTRY_HTML);
  assert.match(html, /rel="apple-touch-icon" href="apple-touch-icon.png"/);
  assert.match(html, /name="apple-mobile-web-app-title" content="Tab"/);
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.name, "Tab");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512", "512x512"]);
  // Android crops an adaptive icon, so one of them has to be safe to crop.
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
});
