import { createStoreFromEnv } from "./create-store.js";
import { HttpError } from "./http-error.js";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  clearCookie,
  createSessionToken,
  parseCookies,
  passwordsMatch,
  randomState,
  readSession,
  requireSessionSecret,
  serializeCookie,
} from "./session.js";

export function createApp({
  env = process.env,
  storeDriver,
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  return async function handleRequest(request) {
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(error.status, { error: error.message, ...error.extra });
      }
      console.error(error);
      return json(500, { error: "Something went wrong." });
    }
  };

  async function route(request) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (path === "/api/auth/me" && request.method === "GET") return me(request);
    if (path === "/api/auth/login" && request.method === "GET") return startGithub(request);
    if (path === "/api/auth/login" && request.method === "POST") return passwordLogin(request);
    if (path === "/api/auth/callback" && request.method === "GET") return githubCallback(request);
    if (path === "/api/auth/logout" && request.method === "POST") return logout(request);
    if (path === "/api/store" && request.method === "GET") return readStore(request);
    if (path === "/api/store" && request.method === "PUT") return writeStore(request);
    return json(404, { error: "Not found." });
  }

  function methods() {
    return {
      github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      password: Boolean(env.TAB_PASSWORD),
    };
  }

  function allowedLogin() {
    return String(env.ALLOWED_GITHUB_LOGIN || "hoffbrandm").trim().toLowerCase();
  }

  function requestOrigin(request) {
    if (env.APP_BASE_URL) return env.APP_BASE_URL.replace(/\/$/, "");
    return new URL(request.url).origin;
  }

  function isSecure(request) {
    return new URL(request.url).protocol === "https:";
  }

  function sessionFrom(request) {
    const secret = requireSessionSecret(env.SESSION_SECRET);
    const cookies = parseCookies(request.headers.get("cookie"));
    const session = readSession(cookies[SESSION_COOKIE], secret, now());
    if (!session) throw new HttpError(401, "Sign in required.");
    return session;
  }

  function assertSameOrigin(request) {
    if (request.method === "GET" || request.method === "HEAD") return;
    const origin = request.headers.get("origin");
    if (!origin) return;
    if (origin !== requestOrigin(request) && origin !== new URL(request.url).origin) {
      throw new HttpError(403, "Cross-origin request blocked.");
    }
  }

  function driver() {
    return storeDriver || createStoreFromEnv(env, { fetchImpl });
  }

  async function me(request) {
    const available = methods();
    try {
      const session = sessionFrom(request);
      return json(200, { authenticated: true, login: session.login, methods: available });
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        return json(401, { authenticated: false, methods: available });
      }
      throw error;
    }
  }

  async function startGithub(request) {
    if (!methods().github) {
      throw new HttpError(503, "GitHub sign-in is not configured.");
    }
    requireSessionSecret(env.SESSION_SECRET);
    const state = randomState();
    const redirectUri = `${requestOrigin(request)}/api/auth/callback`;
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("scope", "read:user");
    authorize.searchParams.set("state", state);
    return redirect(authorize.toString(), [
      serializeCookie(OAUTH_STATE_COOKIE, state, { secure: isSecure(request), maxAgeSec: 600 }),
    ]);
  }

  async function githubCallback(request) {
    if (!methods().github) {
      throw new HttpError(503, "GitHub sign-in is not configured.");
    }
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(request.headers.get("cookie"));
    const expected = cookies[OAUTH_STATE_COOKIE];
    const origin = requestOrigin(request);
    const clearState = clearCookie(OAUTH_STATE_COOKIE, { secure: isSecure(request) });

    if (!code || !state || !expected || state !== expected) {
      return redirect(`${origin}/?error=oauth`, [clearState]);
    }

    const tokenResponse = await fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${origin}/api/auth/callback`,
      }),
    });
    if (!tokenResponse.ok) {
      return redirect(`${origin}/?error=oauth`, [clearState]);
    }
    const tokenPayload = await tokenResponse.json();
    if (!tokenPayload.access_token) {
      return redirect(`${origin}/?error=oauth`, [clearState]);
    }

    const userResponse = await fetchImpl("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "tab-personal-expense-tracker",
      },
    });
    if (!userResponse.ok) {
      return redirect(`${origin}/?error=oauth`, [clearState]);
    }
    const user = await userResponse.json();
    const login = String(user.login || "").toLowerCase();
    if (login !== allowedLogin()) {
      return redirect(`${origin}/?error=forbidden`, [clearState]);
    }

    const token = createSessionToken({
      login: user.login,
      secret: env.SESSION_SECRET,
      now: now(),
    });
    return redirect(`${origin}/`, [
      clearState,
      serializeCookie(SESSION_COOKIE, token, {
        secure: isSecure(request),
        maxAgeSec: SESSION_MAX_AGE_MS / 1000,
      }),
    ]);
  }

  async function passwordLogin(request) {
    assertSameOrigin(request);
    if (!methods().password) {
      throw new HttpError(503, "Passphrase sign-in is not configured.");
    }
    let body;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Send a JSON body with a password.");
    }
    if (!passwordsMatch(body.password, env.TAB_PASSWORD)) {
      throw new HttpError(401, "That passphrase is not right.");
    }
    const login = env.ALLOWED_GITHUB_LOGIN || "hoffbrandm";
    const token = createSessionToken({ login, secret: env.SESSION_SECRET, now: now() });
    return json(
      200,
      { ok: true, login },
      [
        serializeCookie(SESSION_COOKIE, token, {
          secure: isSecure(request),
          maxAgeSec: SESSION_MAX_AGE_MS / 1000,
        }),
      ],
    );
  }

  async function logout(request) {
    assertSameOrigin(request);
    return json(200, { ok: true }, [clearCookie(SESSION_COOKIE, { secure: isSecure(request) })]);
  }

  async function readStore(request) {
    sessionFrom(request);
    return json(200, await driver().read());
  }

  async function writeStore(request) {
    assertSameOrigin(request);
    sessionFrom(request);
    let body;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Send a JSON body with the store.");
    }
    return json(200, await driver().write(body.store, body.sha));
  }
}

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function json(status, data, setCookies = []) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

function redirect(location, setCookies = []) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
  });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}
