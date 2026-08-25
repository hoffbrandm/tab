import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http-error.js";

export const SESSION_COOKIE = "tab_session";
export const OAUTH_STATE_COOKIE = "tab_oauth_state";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function requireSessionSecret(secret) {
  if (!secret || String(secret).length < 16) {
    throw new HttpError(503, "SESSION_SECRET is not configured.");
  }
  return String(secret);
}

export function createSessionToken({ login, secret, now = Date.now(), maxAgeMs = SESSION_MAX_AGE_MS }) {
  return sign({ login, exp: now + maxAgeMs }, requireSessionSecret(secret));
}

export function readSession(token, secret, now = Date.now()) {
  try {
    const payload = verify(token, requireSessionSecret(secret));
    if (!payload?.login || typeof payload.login !== "string" || payload.exp <= now) return null;
    return { login: payload.login, exp: payload.exp };
  } catch {
    return null;
  }
}

export function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify(token, secret) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) throw new Error("Malformed token.");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(mac, expected)) throw new Error("Invalid signature.");
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

export function randomState() {
  return randomBytes(24).toString("base64url");
}

export function passwordsMatch(provided, expected) {
  if (typeof expected !== "string" || expected.length === 0) return false;
  const left = Buffer.from(String(provided ?? ""));
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

export function serializeCookie(name, value, { secure, maxAgeSec, httpOnly = true } = {}) {
  const parts = [`${name}=${value}`, "Path=/", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name, { secure } = {}) {
  return serializeCookie(name, "", { secure, maxAgeSec: 0 });
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
