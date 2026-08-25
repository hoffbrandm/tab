# Tab

A tiny, mobile-first web app for keeping a running GBP balance with one friend at a time. It is a personal tracker for one person: Matthew.

Friends, 50/50 expenses with an optional share adjustment, transfers, and running balances are unchanged. The live tab is a JSON document with this shape:

```json
{ "version": 1, "friends": [], "transactions": [] }
```

That document is stored on GitHub as `data/tab.json`. The browser only keeps a short-lived sign-in cookie. After a browser reset, sign in again and the same friends and transactions come back.

## Why this is no longer on GitHub Pages

GitHub Pages from a private repository is not available on a free personal plan. This app is meant to keep the repository private, so it is built to run on **Vercel** (or any host that can run the `/api` routes against a private repo).

Do not put a GitHub token, passphrase, or session secret in client-side JavaScript.

## What you need

1. A **server-side GitHub token** that can read and write `data/tab.json` in this repository.
2. A way for **only you** to sign in:
   - **GitHub OAuth** (best on a phone — tap Sign in with GitHub), and/or
   - a **passphrase** (`TAB_PASSWORD`) if you have not created an OAuth App yet.
3. A long random `SESSION_SECRET`.

The API refuses unauthenticated reads and writes. Public, anonymous updates are not possible.

## GitHub token

Create a fine-grained personal access token:

1. [GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/personal-access-tokens)
2. Repository access: only `hoffbrandm/tab`
3. Permissions: **Contents: Read and write**
4. Paste it into Vercel as `GITHUB_TOKEN`

You can make the repository private afterwards. The token and Vercel Git integration both keep working.

Each save updates `data/tab.json` through the GitHub Contents API and uses a `[skip ci]` commit message so Vercel does not redeploy on every expense. Treat that file as live data: do not revert it in later pull requests.

## Sign in

### GitHub OAuth

1. [GitHub → Settings → Developer settings → OAuth Apps → New OAuth App](https://github.com/settings/developers)
2. Homepage URL: `https://YOUR_DOMAIN`
3. Authorization callback URL: `https://YOUR_DOMAIN/api/auth/callback`
4. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` on Vercel
5. Set `APP_BASE_URL` to the same `https://YOUR_DOMAIN`
6. Leave `ALLOWED_GITHUB_LOGIN=hoffbrandm`

The OAuth app only requests `read:user`. It proves you are you. The server token writes the file.

### Passphrase

Set `TAB_PASSWORD` on the server. The sign-in screen then shows a passphrase field. Use this for local development, or until the OAuth App exists.

## Deploy on Vercel

1. Import `hoffbrandm/tab` from GitHub. Framework preset can stay **Other**.
2. Add environment variables (Production, Preview, and Development):

| Name | Required | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | yes | At least 16 random characters |
| `GITHUB_TOKEN` | yes on Vercel | Fine-grained Contents read/write |
| `GITHUB_REPO` | no | Defaults to `hoffbrandm/tab` |
| `GITHUB_DATA_PATH` | no | Defaults to `data/tab.json` |
| `ALLOWED_GITHUB_LOGIN` | no | Defaults to `hoffbrandm` |
| `GITHUB_CLIENT_ID` | for GitHub sign-in | OAuth App |
| `GITHUB_CLIENT_SECRET` | for GitHub sign-in | OAuth App |
| `APP_BASE_URL` | for GitHub sign-in | Public site URL, no trailing slash |
| `TAB_PASSWORD` | for passphrase sign-in | Optional if OAuth is configured |

3. Deploy. Open the Vercel URL, sign in, add a friend, add an expense.
4. Then make the GitHub repository private. GitHub Pages will stop serving the old site; the Vercel URL keeps working.

Optional: in Vercel → Project Settings → Git → Ignored Build Step, ignore commits that only touch the data file:

```sh
git diff --quiet HEAD^ HEAD -- . ':!data/tab.json'
```

`data/` and `test/` are listed in `.vercelignore`, so the live JSON is never served as a public static file.

## Run it locally

Copy `.env.example` to `.env.local` and start with a file-backed store:

```sh
SESSION_SECRET=local-dev-session-secret
TAB_PASSWORD=choose-a-passphrase
STORE_DRIVER=file
ALLOWED_GITHUB_LOGIN=hoffbrandm
```

```sh
npm test
npm start
```

Then open `http://127.0.0.1:4173`. `STORE_DRIVER=file` writes `data/tab.json` on disk. Do not set `STORE_DRIVER=file` on Vercel.

To talk to GitHub from your laptop, omit `STORE_DRIVER` and set `GITHUB_TOKEN`.

## Product

- Friends and an optional email address
- 50/50 expenses, with a signed adjustment to your own share when needed
- Direct transfers, separate from shared expenses
- Integer pence throughout; balances are always recalculated from history
- Edit or delete friends and entries
- Hash routes (`#/home`, `#/friend/<id>`) so refresh and Back keep your place
- If this browser still has the old `localStorage` tab and GitHub is empty, you can import it once

## Tests

```sh
npm test
```

`test/calculations.test.mjs` still covers splits and balances. The new files cover store validation, signed sessions, the GitHub Contents adapter, the local file adapter, and the authenticated persistence API.
