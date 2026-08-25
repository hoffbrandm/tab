export const SESSION_KEY = "tab.session.v1";

export function createSession({ storage }) {
  if (!storage) throw new Error("Session storage is required.");

  return {
    read() {
      try {
        const saved = JSON.parse(storage.getItem(SESSION_KEY));
        if (saved?.token && typeof saved.token === "string") {
          return { token: saved.token, login: saved.login || "" };
        }
      } catch { /* Ignore a corrupt session. */ }
      return null;
    },
    write({ token, login }) {
      if (!token) throw new Error("A token is required to sign in.");
      storage.setItem(SESSION_KEY, JSON.stringify({ token, login: login || "" }));
    },
    clear() {
      storage.removeItem(SESSION_KEY);
    },
  };
}
