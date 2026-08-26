# Tab

A tiny, mobile-first web app for keeping a running GBP balance with one friend at a time. It is a personal tracker for one person: Matthew.

The live site is static GitHub Pages: https://hoffbrandm.github.io/tab/

Friends, 50/50 expenses with an optional share adjustment, transfers, and running balances are unchanged. The live tab is a JSON document with this shape:

```json
{ "version": 1, "friends": [], "transactions": [] }
```

That document is stored in a **private GitHub gist**, not in this public repository and not in the browser. After a browser reset, paste the same GitHub token and the same friends and transactions come back.

## Why the repo stays public

GitHub Pages from a private repository needs a paid plan. This app stays on free Pages, so the **code** is public. The **tab** is not: it lives in a private gist that only your token can read or write.

The public site never sees a baked-in secret. Anyone can open the Pages URL; without your token they only see the sign-in screen.

## Sign in

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens).
2. Repository access can be **None**.
3. Account permissions: **Gists → Read and write**. Nothing else.
4. Open the Pages site (or `npm start` locally), paste the token, and sign in.

A password manager can store the token against this site, which is the comfortable option on a phone. The token is kept in `sessionStorage` for this browser session only. It is not the tab, and it is not written to `localStorage`.

On first sign-in the app looks for a gist whose description is `tab.personal.v1`. If none exists it creates a private one. GitHub's gist list does not include file bodies, so after finding (or creating) that gist the app loads `tab.json` with `GET /gists/{id}` — or the file `raw_url` when the body is truncated. A fresh browser does not need a gist id.

If more than one `tab.personal.v1` gist exists, the app uses the newest one that actually has friends or expenses.

A classic personal access token with only the `gist` scope also works.

## What the public repo does not contain

- No friends or expenses
- No gist id
- No token
- No server, API routes, env vars, or extra host

If this browser still has the old `localStorage` copy (`tab.personal.v1`) and the gist is empty, you can import it once. After that, the live tab is only in the gist.

## Run it locally

This project has no third-party dependencies.

```sh
npm test
npm start
```

Then open `http://127.0.0.1:4173`. Production is the same static files on GitHub Pages.

## Product

- Friends and an optional email address
- 50/50 expenses, with a signed adjustment to your own share when needed
- Direct transfers, separate from shared expenses
- Integer pence throughout; balances are always recalculated from history
- Edit or delete friends and entries
- Hash routes (`#/home`, `#/friend/<id>`) so refresh and Back keep your place

## Tests

```sh
npm test
```

`test/calculations.test.mjs` covers splits and balances. The other tests cover store validation, the session credential, and the private-gist persistence layer.
