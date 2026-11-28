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
        const types = {
          ".js": "application/javascript",
          ".css": "text/css",
          ".html": "text/html",
        };
        res.writeHead(200, { "content-type": types[ext] || "text/plain" });
        res.end(readFileSync(full));
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

test("WebKit: inventory shows inline update box at top", async (t) => {
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
  await page.goto(`http://127.0.0.1:${port}/#/inventory`);
  const localBtn = page.getByRole("button", { name: /local workbook/i });
  if (await localBtn.isVisible().catch(() => false)) await localBtn.click();
  const input = page.locator("#inv-quick-said");
  await input.waitFor({ state: "visible", timeout: 15000 });
  const placeholder = await input.getAttribute("placeholder");
  assert.match(placeholder || "", /filament/i);
  await page.screenshot({ path: "/opt/cursor/artifacts/inv-inline-empty-webkit.png" });
  await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
    if (route.request().url().includes("generateContent")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  changes: [{
                    action: "add",
                    item: "3D printer filament",
                    place: ["Office"],
                    stock: "out",
                    note: "",
                  }],
                }),
              }],
            },
          }],
        }),
      });
    } else await route.fulfill({ status: 200, body: '{"models":[]}' });
  });
  await input.fill("3D printer filament is out, office");
  await page.locator(".inv-quick-send").click();
  await page.waitForSelector("#inv-quick-confirm-form", { timeout: 10000 });
  await page.waitForSelector('#inv-quick-confirm-form input[name="name"]', { timeout: 5000 });
  const name = await page.inputValue('#inv-quick-confirm-form input[name="name"]');
  assert.match(name, /filament/i);
  await page.screenshot({ path: "/opt/cursor/artifacts/inv-inline-confirm-webkit.png" });
  await browser.close();
  server.close();
});