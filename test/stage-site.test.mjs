import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { entryModuleOf, moduleGraphFrom, relativeImportsOf, NEVER_PUBLISH, STATIC_ASSETS } from "../stage-site.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(root, name), "utf8");

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
  assert.deepEqual(STATIC_ASSETS, ["index.html", "styles.css", "favicon.svg", "manifest.webmanifest"]);
});
