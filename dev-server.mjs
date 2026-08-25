import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createApp } from "./api/_lib/app.js";

await loadEnvFile(new URL("./.env.local", import.meta.url));

const root = new URL(".", import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const types = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".html": "text/html",
};
const blocked = new Set(["data", "test", "api", ".git", ".env", ".env.local"]);
const handleApi = createApp({ env: process.env });

const server = createServer(async (incoming, response) => {
  try {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const request = await toRequest(incoming, url);
      const result = await handleApi(request);
      await sendResponse(response, result);
      return;
    }

    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const top = relative.split("/")[0];
    if (blocked.has(top) || relative.startsWith(".")) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }

    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`,
      "Cache-Control": "no-store",
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Tab is running at http://127.0.0.1:${port}`);
});

async function toRequest(incoming, url) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  const init = { method: incoming.method, headers };
  if (incoming.method !== "GET" && incoming.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    init.body = Buffer.concat(chunks);
  }
  return new Request(url, init);
}

async function sendResponse(response, result) {
  const headers = {};
  const cookies = [];
  result.headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie") cookies.push(value);
    else headers[name] = value;
  });
  if (cookies.length) headers["Set-Cookie"] = cookies;
  response.writeHead(result.status, headers);
  if (result.status === 204 || result.status === 304) {
    response.end();
    return;
  }
  response.end(Buffer.from(await result.arrayBuffer()));
}

async function loadEnvFile(url) {
  try {
    const text = await readFile(url, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* Local env file is optional. */
  }
}
