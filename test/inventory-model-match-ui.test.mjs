import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function startStaticServer(dir, port) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = req.url?.split("?")[0] || "/";
      const file = path === "/" ? "/index.html" : path;
      try {
        const full = join(dir, decodeURIComponent(file));
        const ext = full.slice(full.lastIndexOf("."));
        const types = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html" };
        res.writeHead(200, { "content-type": types[ext] || "text/plain" });
        res.end(readFileSync(full));
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

test("WebKit: 2016 batteries confirm shows picker vs CR2032 at 390px", async (t) => {
  let webkit;
  try {
    ({ webkit } = await import("playwright"));
  } catch {
    t.skip("playwright not installed");
    return;
  }
  const server = await startStaticServer(join(root, "_site"), 0);
  const port = server.address().port;
  const browser = await webkit.launch();
  const page = await (await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })).newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('[data-action="local-workbook"]', { timeout: 15000 });
  await page.click('[data-action="local-workbook"]');
  await page.goto(`http://127.0.0.1:${port}/#/inventory`);
  await page.waitForFunction(
    () => document.querySelector("#inv-quick-said") && !document.querySelector("#inv-quick-said").disabled,
    null,
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: /add by hand/i }).click();
  await page.fill('#modal-root input[name="name"]', "CR2032 batteries");
  await page.fill('#modal-root input[name="location"]', "Kitchen drawer");
  await page.locator('#modal-root button[type="submit"]').click();
  await page.locator("#inv-item-form").waitFor({ state: "detached", timeout: 10000 });
  await page.getByRole("button", { name: /CR2032 batteries/i }).first().waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#inv-quick-said").fill("2016 batteries in the upstairs cupboard");
  await page.locator(".inv-quick-send").click();
  await page.waitForSelector(".inv-pick-row.on", { timeout: 10000 });
  const name = await page.inputValue('#inv-quick-confirm-form input[name="name"]');
  assert.match(name, /2016/i);
  const selected = await page.locator(".inv-pick-row.on").innerText();
  assert.match(selected, /New item/i);
  await page.screenshot({ path: "/opt/cursor/artifacts/inv-2016-vs-2032-confirm-390.png", fullPage: true });
  await browser.close();
  server.close();
});