# Tab
 
A mobile-first UK household workbook for one signed-in person. The live site is static GitHub Pages: https://hoffbrandm.github.io/tab/

Friend tabs are still here: 50/50 expenses, transfers, running balances. The rest is household money — a month statement on Home, planned one-offs, an annual sinking fund, pots, payslips, a £100k adjusted-net-income helper for childcare, and giving.

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
    "monthlies": [],
    "weeklyRules": [],
    "weeklyExtras": [],
    "cards": [],
    "cardSubs": [],
    "pendings": [],
    "reserves": [],
    "oneOffs": [],
    "exceptions": [],
    "annualBills": [],
    "pots": [],
    "pensions": [],
    "payslips": [],
    "payslipCategories": [],
    "donations": [],
    "includeGiftAidInAni": true
  }
}
```

An older gist with only `friends` and `transactions` still loads. The household object is added on read. Amounts are integer pence. UK tax years start on 6 April. Gift Aid is 25%.

## Product

- **Home** — the month in three parts, in the order the questions actually come. First **what the month ends up saving**: the plan’s saving carried forward with however far ahead or behind today already is — the sheet footer’s `Savings 2761` + `299 Underspend` = `Total Savings 3060`, stated once as the headline instead of as a bottom line to add up. Under it, one sentence says how today stands against the plan, how much of the plan is left to spend (and roughly what that is a day), and what the month lands on if the rest of it goes to plan. Then **the plan for the month**: **In** (calculated payslip net for slips that land), **Out** split by where the money actually leaves: **Out of the bank** (standing cash monthlies + the monthly share of the annual bills + any reserve line spent in cash) and **On to the cards** (card monthlies + this month’s planned + all weekly slots + the reserve lines spent on a card). The reserve — the £30 a day — is spent on the cards, so it sits on the card side; it used to sit on the cash side while pro-rating into the card allowance, which was the same £1,000 counted as bank money in the plan and as card money in the check, and **Planned saving**, which is In − Out. A tick does not move In or Out. Then **where you are**, on the day of the month it is: **Plan allows by today** (ticked weeklies this month + card monthlies whose due date has arrived + purchased one-offs + this month’s exceptions + the day-by-day share of cash in reserve) against what is really **on the cards now** (balances + pending), the **ahead of / behind plan** gap between the two, and what is still to come, split in two. **Still to be paid** is the weeklies, card monthlies and planned one-offs not yet ticked or due: they are expected to be paid, so they are never offered as room to spend. **Day money left** is the rest of the reserve — the half that is actually chosen day by day, and the only half with a per-day figure against it. The two add back to the whole remaining plan (card plan + reserve + exceptions, less the allowance so far). One row called “left to spend”, with a per-day rate over the lot, said a committed food shop was money you could decide not to spend. The plan’s card half and the live card balance used to sit in one column, where “On to the card” read as though it might be a card balance; they are separate blocks now, and both sides of the check are rows rather than one row and a note. A small note still says what the allowance is made of, and where the cards finish if the rest of the plan is spent. A card with no balance recorded for the month on screen would read as £0 and report the whole allowance as underspend, so the check goes to `—` and the month-end saving falls back to In − Out until a balance is in; a card carrying no figure at all reads as nothing on it, never as `£NaN`. A month that has not started has no “so far”, so it shows the plan alone. So a card balance you type lowers the month-end saving pound for pound, and it never touches Planned saving. The month-end saving already assumes everything still planned gets paid: a card monthly due later in the month is not counted as saved just because it has not landed yet. **How this adds up** itemises both halves of Out — every cash monthly, the annual share, every card monthly with its due date, each weekly rule as one row showing its working (`Food shop · 4 × £400.00`), each planned one-off, and the reserve — with each half totalling to the figure on the statement. A saving that looks too good can be checked against its lines instead of trusted. How this adds up, Income, Cards, Pending, Exceptions, Weeklies, and Planned are boxed accordions, all closed when Home opens so the statement reads first; open/closed then stays in the session, so a tick does not reset it. Income has a clear **Add payslip** button. Cards sit on Home with an inline balance. Pending is a small amount table, not named line-items, with **Clear all** for a fresh table. A refund or credit on the statement goes in as a minus and comes off the card side. A card can also carry its own typed pending figure, and both count toward the check — when a card has one, the Pending helper says so, so the same amount is not entered twice. Weeklies are ticked here (the sheet’s untitled column Q). Ticking Amazon £100 with cards unchanged raises the month-end saving by £100 and takes £100 off what is left to spend. This month’s planned items live in the Planned accordion and sit in Out whether or not they are purchased; purchasing one raises the month-end saving by the estimate. Every change — ticks, table edits, and modal saves alike — flips in memory and writes to the gist in the background; a write that fails shows on the sync chip with a retry rather than holding a form open on the network.
- **Weeklies** — the rules that make the slots; the slots themselves are ticked on Home, so ticking lives in one place. Each rule is entered once: name, typical amount (required), and cadence (**N times a month**, or **every week on a chosen weekday**). N=1 is once a month. Slots for a weekday rule are the count of that weekday in the month being viewed (four Tuesdays → four slots). An extra occurrence can be added for that month only. A new month starts unticked; old months keep their ticks. Missing paid-from defaults to card; a cash weekly still counts in the card allowance when ticked.
- **Monthlies** — standing bills: name, amount, due day, cash or card. Two due rules: on the calendar day, or that day rolled to the next working day. (“First working day of the month” was only ever day 1 rolled forward — the same rule — so it is gone, and an older record is stored as the rule it always meant.) Config only — no ticks (the sheet never ticked cash bills or card subs). Cash and card lines count in Out for the whole viewed month. Cash lines (mortgage, council tax) never enter the card allowance. Card lines enter it on the effective due date, with no tick. **Cash in reserve** is typed monthly envelopes. The daily envelope / monthly thousand is one line (the sheet’s “£30 a day”), not a second feature; the amount lives in the gist. Cleaner and nails sit beside it. Each reserve line says where it is spent, the same way a monthly does, and **only the ones spent on a card enter the card allowance**. The sheet pro-rates its “£30 a day” row into Allowed Expenses and leaves cleaner and nails out, because those are not card spending; pro-rating all three put the allowance about £197 over the sheet’s on day 26 of 31. The daily envelope is the month’s spending money — “roughly £30 a day” — so it sits on the card side of Out in full and pro-rates into the allowance by day-of-month, as the sheet’s column L does. A line with no `paidFrom` is read from its name: the daily envelope is card spending, and a cleaner or a set of nails is not — which is exactly how the sheet pro-rates only its “£30 a day” row. Saving a line makes the choice explicit, an explicit choice always beats the guess, and both the reserve list and the Out breakdown show which side each line landed on. Insurance saving is the Annual total ÷ 12.
- **Exceptions** — spending that came out of another pot, not the normal amount: item, month, amount. Travel insurance at £560 in August lets the card carry £560 more before it reads as overspend, and leaves Savings alone. They only count in the month they are recorded against, and the section says how many sit in other months.
- **Planned** — item, month, estimate, purchased. The current month’s rows also sit on Home. This screen is the list across months, over a **Planned per month** table — this month and every month ahead that has something in it, with a bar for relative size — so a month quietly filling up is visible before it arrives.
- **Annual** — yearly bills. Total ÷ 12 is the monthly reserve in Out. Edit here; do not type it twice.
- **Pots** — named pots with dated monthly snapshots and a simple graphic of values over time. A quiet line reminds you to log this calendar month if it is missing. Optional pension *names and status* only.
- **Payslips** — per person, per UK tax year: pay period, salary, gross, note, month the money lands. Categories start from the sheet’s fixed column set (bonus through jury service, plus parental-pay columns) and live in Account. The slip picks categories and amounts. A new slip copies last month’s used categories for that person. Forecast rows are labelled and not treated as confirmed for the £100k helper. Home In uses the calculated net for slips that land in the viewed month.

  Net follows the payslip’s own arithmetic: **Net pay = Total gross pay − Total deductions**. `Gross` is the Payments total, so it already carries basic, bonus, and any parental pay — none of those is added again. A **taxable benefit** is notional: it is taxed but never paid, so it stays out of net and counts only for the £100k line. A **cash allowance** is the other thing a “Benefits” column can mean — a car allowance reaches the bank *and* is taxable — so it is its own category and counts in both. One column for both is how an allowance ends up either missing from net or missing from adjusted net income. A **salary sacrifice** is not an employee deduction — the employee gives up contractual pay and the employer pays the pension, so gross is already reduced by it; a slip that shows gross before the sacrifice ticks **Gross is before salary sacrifice** and only then does it come off. A **relief-at-source pension** is the opposite: it is paid out of pay, so it *is* a deduction, and for adjusted net income it comes off grossed up by 100/80. The two are separate categories — the old single “Pensions” category said nothing about which.

  How a slip writes `Gross` is a fact about the payslip, not something to have to know, so the form does not ask. It shows its working (gross paid, deductions, net) and lists **every reading of Gross with its own net** — the Payments total, before the sacrifice, basic pay with the bonus on top, or both — and the one matching the payslip is picked by eye. Type the optional **Net on the payslip** and the matching reading is marked for you. Picking one only says how to read Gross; it never changes a typed figure.

  When a stated net matches nothing, the form names the likely cause: a gap that is exactly the sacrifice, exactly the bonus, or exactly the benefit is called out, and anything else points at a missing deduction. A benefit-sized gap the *other* way says the slip pays it in cash and points at Cash allowance. One check does not wait for a stated net at all: **Gross typed as salary ÷ 12 is the contractual figure, before any salary sacrifice**, so an untaken sacrifice on such a slip is called out on sight — left alone it overstates net by the whole sacrifice every month, and nothing else would catch it. An imported workbook carries the sheet’s own `Net` column in as the stated net, so an import says where the sheet and the app disagree instead of hiding it.
- **£100k helper** — YTD from confirmed payslips, remaining months at the last confirmed run-rate, extra salary-sacrifice needed to stay at or under £100,000 adjusted net income — as a pounds amount and as a percentage of remaining projected pay. Grossed-up Gift Aid from giving in that tax year is deducted automatically: adjusted net income is net income less the gross donation (ITA 2007 s58), so £80 given with Gift Aid takes £100 off.
- **Giving** — who, charity, date, amount, Gift Aid, gross, tax year.
- **Friend tabs** — friends, 50/50 expenses with an optional share adjustment, transfers, running balances.

Hash routes keep refresh and Back in the same place (`#/home`, `#/weeklies`, `#/monthlies`, `#/planned`, `#/annual`, `#/pots`, `#/payslips`, `#/ani`, `#/giving`, `#/tabs`, `#/friend/<id>`, `#/more`). The bar lists every destination. Account is sign-in, gist status, and payslip category names.

Month labels use the month or tax year on the record. “This month” is only for the current calendar month. The jump control on another month says “Back to August”, never “This month”. The public repo never contains a real workbook or personal figures. A teammate can seed the private gist separately.

## Run it locally

This project has no third-party dependencies.

```sh
npm test
npm start
```

Then open `http://127.0.0.1:4173`. On that local address you can open a session-only workbook without a token (nothing is written to a gist or to `localStorage`). Production is the same static files on GitHub Pages and always uses the private gist.

## What gets published

`npm run stage` writes the public site into `_site/`, which is what the Pages workflow deploys. The file list is **walked from `index.html`'s entry module**, not written by hand: the four assets `index.html` names, then every module reachable by relative import from `app.js`.

This is not a style preference. The list used to be typed into the workflow, and it went stale every time a module was added — `home-sections.js`, `persist-queue.js` and `swipe-row.js` were all imported by the deployed `app.js` and none was ever copied, so the module graph could not resolve and the published site rendered a blank page while the deploy reported success. Walking the graph publishes a new module with the app that imports it, and leaves behind anything the app does not import: `workbook-import.js` and `xlsx.js` are test-only, `server.mjs` and `stage-site.mjs` are build- and dev-only, and none of them reaches `_site`.

Staging fails the build rather than shipping a broken site if a module is imported but missing, if a published module imports something that was not published, or if a private file reaches `_site`. The workflow runs `npm test` before staging, so a red test never deploys.

## Tests

```sh
npm test
```

`test/calculations.test.mjs` covers friend-tab splits and balances. `test/household.test.mjs` covers In/Out as the month plan, Savings as In−Out, the month-end saving as Savings plus the under/overspend, the whole month's allowance and what is left of it, that what is left splits exactly into what is owed and the day money that is chosen, a weekly not yet ticked counting as owed rather than as room to spend, a weekly tick coming off what is left pound for pound, the month phase (a month gone has nothing still to come; one ahead has all of it), a card carrying no figure reading as nothing rather than NaN, a card balance lowering the month-end saving pound for pound, exceptions raising the card allowance without moving Savings, the card check as allowance-so-far minus cards, income from payslips, card and cash monthlies in Out, weeklies and purchased one-offs not moving In or Out, a £100 weekly tick raising savings while cards stay put, a card monthly due on the 6th staying out of spent-so-far on the 5th, cash in reserve allowed a day at a time, Out splitting by where the money leaves, only a card-spent reserve entering the card allowance (with an absent `paidFrom` read from the line's name, and an explicit choice always winning), a cash allowance counting in net and in adjusted net income while a benefit in kind counts only in the latter, a gross typed as salary ÷ 12 with an untaken sacrifice being called out, the Out breakdown naming every line on the side it is spent from and tying to the totals, planned totals per month ahead, first-working-day being day 1 rolled forward, the card check going unknown when a card has no balance for the month on screen, grossed-up Gift Aid coming off adjusted net income, a standing cash mortgage never entering spent-so-far, purchasing a planned one-off raising savings, future-month dues staying at 0 with no “this month” verdict, no paidMonths ticks on bills, month labels (September is not “this month” in August), payslip net as gross paid less deductions, benefits staying out of net but in ANI, salary sacrifice not double-counted, a relief-at-source pension grossed up for ANI, the stated-net check and its hints, every reading of Gross offered with its own net, new-slip category defaults, the pending table total, clear-all pending, weekly cadence (N times + every week on a weekday; N=1 is once), a required typical amount, and one-offs for the viewed month sitting in Out. `test/home-sections.test.mjs` keeps accordion open/closed across ticks. `test/ui.test.mjs` checks the £ prefix class, Home hooks, the statement's three blocks — the headline saving and its sentence, the plan, and the live position — that the plan's card half and the live card balance no longer sit in one column, that the month-end figure is stated once rather than repeated as a footer row, that what is still to come is two rows — what is owed and the day money that is chosen — rather than one "left to spend", that the close only says "hold that" when there is day money to hold to, that a finished month drops those rows and a month not started drops the whole live block, the Exceptions section, that typing a card balance or a pending amount repaints every part of the statement with no refresh, and that standing monthlies have no tick control. `test/persist-queue.test.mjs` covers flipping a tick before the gist write, and a failed write neither escaping the debounce timer nor stopping the next change from writing. `test/workbook-import.test.mjs` keeps a synthetic workbook mapper for tests only — there is no import button in the app. `test/stage-site.test.mjs` covers what gets published: the entry module read off `index.html`, every shape of relative import, a transitive graph that survives a cycle, the real app's nine modules (the three that were missing named explicitly), test-only and server-only files staying out, and a missing module failing the build. The other tests cover store validation, the session credential, and the private-gist persistence layer.
