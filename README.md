# Tab

A mobile-first UK household workbook for one signed-in person. The live site is static GitHub Pages: https://hoffbrandm.github.io/tab/

Friend tabs are still here: 50/50 expenses, transfers, running balances. The rest is household money — this-month cashflow, planned one-offs, an annual sinking fund, pots, payslips, a £100k adjusted-net-income helper for childcare, and giving.

The live document is JSON in a **private GitHub gist**, not in this public repository and not in the browser. After a browser reset, paste the same GitHub token and the same household and tabs come back.

## Why the repo stays public

GitHub Pages from a private repository needs a paid plan. This app stays on free Pages, so the **code** is public. The **household** is not: it lives in a private gist that only your token can read or write.

The public site never sees a baked-in secret. Anyone can open the Pages URL; without your token they only see the sign-in screen.

## Sign in

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens).
2. Repository access can be **None**.
3. Account permissions: **Gists → Read and write**. Nothing else.
4. Open the Pages site (or `npm start` locally), paste the token, and sign in.

A password manager can store the token against this site, which is the comfortable option on a phone. The token is kept in `sessionStorage` for this browser session only. It is not the household, and it is not written to `localStorage`.

On first sign-in the app looks for a gist whose description is `tab.personal.v1`. If none exists it creates a private one. GitHub's gist list does not include file bodies, so after finding (or creating) that gist the app loads `tab.json` with `GET /gists/{id}` — or the file `raw_url` when the body is truncated. A fresh browser does not need a gist id.

If more than one `tab.personal.v1` gist exists, the app uses the newest one that actually has household lines, friends, or expenses.

A classic personal access token with only the `gist` scope also works.

## What the public repo does not contain

- No friends, expenses, pay, pots, or donations
- No gist id
- No token
- No bank feeds, paid APIs, or extra host
- No NI numbers, policy numbers, or real spreadsheet figures

If this browser still has the old `localStorage` copy (`tab.personal.v1`) and the gist has no friends or expenses, you can import that leftover once. After that, the live household is only in the gist.

## Store shape

One versioned JSON document in `tab.json`:

```json
{
  "version": 1,
  "friends": [],
  "transactions": [],
  "household": {
    "people": [{ "id": "person-you", "name": "You" }, { "id": "person-partner", "name": "Partner" }],
    "incomes": [],
    "bills": [],
    "envelopes": [],
    "cards": [],
    "cardSubs": [],
    "oneOffs": [],
    "annualBills": [],
    "pots": [],
    "pensions": [],
    "payslips": [],
    "donations": [],
    "includeGiftAidInAni": false
  }
}
```

An older gist with only `friends` and `transactions` still loads. The household object is added on read. Amounts are integer pence. UK tax years start on 6 April. Gift Aid is 25%.

## Product

- **Home cashflow** — typed take-home, monthly bills and weekly slots you can add and tick, card balances plus pending amounts, card subscriptions, this month’s planned one-offs, and the annual reserve. In / out / left, then one line for under or over and whether you are saving. **Reset this month’s ticks** clears paid/happened marks for the month on screen.
- **Planned** — item, month, estimate, purchased. Current month rows appear on Home by a plain filter.
- **Annual** — yearly bills. Total ÷ 12 is the monthly reserve on cashflow.
- **Pots** — named pots with a dated snapshot. Optional pension *names and status* only.
- **Payslips** — per person, per UK tax year: pay period, salary, gross, addable bonus/benefits/salary-sacrifice/other deductions, tax, NI amount, net, note, month the money lands. Forecast rows are labelled and not treated as confirmed.
- **£100k helper** — YTD from confirmed payslips, remaining months at the last confirmed run-rate, extra salary-sacrifice needed to stay at or under £100,000 adjusted net income. Gift Aid from the giving log is off unless you turn it on.
- **Giving** — who, charity, date, amount, Gift Aid, gross, tax year.
- **Friend tabs** — friends, 50/50 expenses with an optional share adjustment, transfers, running balances.

Hash routes keep refresh and Back in the same place (`#/home`, `#/planned`, `#/tabs`, `#/friend/<id>`, and the rest under More).

On More you can upload a Numbers/Excel `.xlsx` once. It maps the Main / Payslips / Annually / Where’s the money / Charity sheets into the household document and writes that to the private gist. Friend tabs are left alone. If household lines already exist, the import asks before replacing them. The public repo never contains your workbook.

## Run it locally

This project has no third-party dependencies.

```sh
npm test
npm start
```

Then open `http://127.0.0.1:4173`. On that local address you can open a session-only workbook without a token (nothing is written to a gist or to `localStorage`). Production is the same static files on GitHub Pages and always uses the private gist.

## Tests

```sh
npm test
```

`test/calculations.test.mjs` covers friend-tab splits and balances. `test/household.test.mjs` covers cashflow totals, the daily pro-rate, UK tax years, Gift Aid, and the £100k remaining-sacrifice helper. The other tests cover store validation, the session credential, and the private-gist persistence layer.
