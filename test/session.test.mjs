import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionToken,
  parseCookies,
  passwordsMatch,
  readSession,
  serializeCookie,
  verify,
} from "../api/_lib/session.js";

const secret = "test-session-secret";

test("session tokens round-trip the GitHub login", () => {
  const now = 1_000_000;
  const token = createSessionToken({ login: "hoffbrandm", secret, now, maxAgeMs: 60_000 });
  assert.deepEqual(readSession(token, secret, now + 10), { login: "hoffbrandm", exp: now + 60_000 });
});

test("expired or tampered sessions are rejected", () => {
  const now = 1_000_000;
  const token = createSessionToken({ login: "hoffbrandm", secret, now, maxAgeMs: 60_000 });
  assert.equal(readSession(token, secret, now + 60_001), null);
  assert.equal(readSession(`${token}x`, secret, now), null);
  assert.equal(readSession(token, "other-session-secret", now), null);
});

test("passwords are compared in constant-length buffers", () => {
  assert.equal(passwordsMatch("secret", "secret"), true);
  assert.equal(passwordsMatch("secret", "Secret"), false);
  assert.equal(passwordsMatch("nope", "secret"), false);
  assert.equal(passwordsMatch("secret", ""), false);
});

test("cookies are httpOnly, lax, and optionally secure", () => {
  const cookie = serializeCookie("tab_session", "abc", { secure: true, maxAgeSec: 120 });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.deepEqual(parseCookies("tab_session=abc; other=1"), { tab_session: "abc", other: "1" });
});

test("signed payloads reject a swapped signature", () => {
  const token = createSessionToken({ login: "hoffbrandm", secret, now: 1 });
  const [body] = token.split(".");
  assert.throws(() => verify(`${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, secret));
});
