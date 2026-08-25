# Tab

A tiny, mobile-first web app for keeping a running balance with one friend at a time.

## What it does

- Keeps friends and an optional email address.
- Records 50/50 expenses, with a small signed adjustment to your own share when needed.
- Records direct transfers separately from shared expenses.
- Calculates each balance from transaction history, using integer pence throughout.
- Lets you edit or delete friends and entries.
- Persists the data in the browser's `localStorage` under `tab.personal.v1`.

## Run it locally

This project intentionally has no third-party dependencies. From this folder:

```sh
/Users/rancher/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/*.test.mjs
/Users/rancher/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.mjs
```

Then open `http://127.0.0.1:4173`.

## Persistence and deployment

The current MVP is a static browser app. Data survives refreshes and reopening the same browser on the same deployed URL, but it is deliberately private to that browser and device. A later database-backed version can replace `loadStore` and `persist` in `app.js` without changing the calculation model.

To make it publicly accessible, deploy the contents of this folder to any static host. A host connection is not available in this current UK-based Codex session, so no public URL has been created here.
