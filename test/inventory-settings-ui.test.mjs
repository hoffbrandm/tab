import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function contentType(path) {
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".webmanifest")) return "application/manifest+json";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "text/html; charset=utf-8";
}

function startStaticServer(dir, port) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = req.url?.split("?")[0] || "/";
      const file = path === "/" ? "/index.html" : path;
      try {
        const full = join(dir, decodeURIComponent(file));
        const body = readFileSync(full);
        res.writeHead(200, { "content-type": contentType(full), "cache-control": "no-cache" });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

test("WebKit: Smart understanding opens sheet (iPhone viewport)", async (t) => {
  let webkit;
  try {
    ({ webkit } = await import("playwright"));
  } catch {
    t.skip("playwright not installed");
    return;
  }
  const port = 0;
  const server = await startStaticServer(join(root, "_site"), port);
  const { port: boundPort } = server.address();
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openInventoryLocal(page, `http://127.0.0.1:${boundPort}`);
  await page.locator('[data-action="inv-ai-settings"]').first().click();
  await waitForModalSettled(page);
  const topmost = await assertTopmostInModal(page);
  assert.equal(topmost.key, true, "API key field must be topmost");
  assert.equal(topmost.testKey, true, "Test key must be topmost");
  const title = await page.locator("#modal-title").textContent();
  assert.match(title || "", /Smart understanding/i);
  const keyField = page.locator('input[name="apiKey"]');
  await keyField.fill("fake-test-key");
  assert.equal(await keyField.inputValue(), "fake-test-key");
  const mockGemini = async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"changes":[{"action":"add","item":"X","place":[],"stock":"plenty","note":""}]}' }] } }],
      }),
    });
  };
  await page.route(/generativelanguage\.googleapis\.com/, mockGemini);
  await page.getByRole("button", { name: "Test key" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Key works"), { timeout: 8000 });
  const shot = join(root, "test-artifacts", "inv-smart-understanding-webkit.png");
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();
  server.close();
  assert.equal(errors.length, 0, errors.join("; "));
});

async function openInventoryLocal(page, baseUrl) {
  await page.goto(`${baseUrl}/#/inventory`);
  const localBtn = page.getByRole("button", { name: /local workbook/i });
  if (await localBtn.isVisible().catch(() => false)) {
    await localBtn.click();
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('[data-action="inv-ai-settings"]', { timeout: 15_000 });
}

async function waitForModalSettled(page) {
  const modal = page.locator(".modal-layer .modal");
  await modal.waitFor({ state: "visible", timeout: 5000 });
  await modal.evaluate((node) =>
    new Promise((resolve) => {
      const finish = () => resolve();
      const name = getComputedStyle(node).animationName;
      if (!name || name === "none") {
        finish();
        return;
      }
      node.addEventListener("animationend", finish, { once: true });
      setTimeout(finish, 400);
    }),
  );
}

function assertTopmostInModal(page) {
  return page.evaluate(() => {
    const layer = document.querySelector(".modal-layer");
    if (!layer) return { ok: false, reason: "no modal layer" };
    function hitInModal(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const x = r.left + r.width / 2;
      const y = r.top + Math.min(r.height / 2, r.height - 4);
      const top = document.elementFromPoint(x, y);
      return top && layer.contains(top);
    }
    const key = document.querySelector('input[name="apiKey"]');
    const testBtn = [...document.querySelectorAll("button")].find((b) => b.dataset.action === "inv-ai-test-key");
    return { key: hitInModal(key), testKey: hitInModal(testBtn) };
  });
}

test("WebKit: stale cached app.js (pre-fix) then upgrade opens sheet", async (t) => {
  let webkit;
  try {
    ({ webkit } = await import("playwright"));
  } catch {
    t.skip("playwright not installed");
    return;
  }
  let oldApp;
  try {
    oldApp = execSync("git show f754c174460f0d1c191a49bb5655aa65391f686e:app.js", {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    t.skip("pre-fix app.js not available in git history");
    return;
  }
  const server = await startStaticServer(join(root, "_site"), 0);
  const boundPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${boundPort}`;
  const browser = await webkit.launch();
  const staleCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const stalePage = await staleCtx.newPage();
  await stalePage.route(`${baseUrl}/app.js`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: oldApp,
    });
  });
  await openInventoryLocal(stalePage, baseUrl);
  await stalePage.locator('[data-action="inv-ai-settings"]').first().click();
  assert.equal(await stalePage.locator(".modal-layer .modal").isVisible().catch(() => false), false);
  await staleCtx.close();

  const freshCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const freshPage = await freshCtx.newPage();
  await openInventoryLocal(freshPage, baseUrl);
  await freshPage.locator('[data-action="inv-ai-settings"]').first().click();
  await waitForModalSettled(freshPage);
  const top = await assertTopmostInModal(freshPage);
  assert.equal(top.key, true);
  await browser.close();
  server.close();
});