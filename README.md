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
    "perDiem": { "amountPence": 0 },
    "oneOffs": [],
    "exceptions": [],
    "fromSavings": [],
    "setAsides": [],
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

- **Home** — the month laid out the way the household is actually read: the source workbook's own Main Table, one row per category across its three columns — what the category does to **the month**, what the calendar lets the cards carry by today (**Allowed**), and what that category has actually put **on cards**. **The month column adds up.** Every row is signed, the over/underspend is a term in the sum rather than a note beside it, and the last line is what the month ends up with: Income, From savings, Cash out, Per diem, Credit card out, Weekly expenses, Monthly expenses, Exceptions, Set aside → **The plan saves**, then under a **What the cards actually say** caption the Pending and Credit cards figures typed off a statement, the over- or underspend against them, and **Ends up saving**.

  The row that used to break the column was Exceptions: a positive number the savings total stepped over, carrying an asterisk saying so. An exception is spending, so it is in Out like any other; what pays for it is **From savings**, the transfer in that every exception implies by definition. The two cancel exactly, the asterisk is gone, and anything typed on top of the exceptions — "the month does not reach, pull £1,000 in" — raises what the month ends up with by that much and nothing else: it is not spending money, so the cards are allowed no more than before. Because moving money in from savings is not money earned, a total that leans on one says so in the note beneath. Allowed and On cards are two different questions and were one figure until now: allowed is a matter of the calendar — a weekly slot dated the 20th is money the cards may carry from the 20th, a card monthly counts from its due date, the per diem counts a day at a time — and on-cards is a matter of what was recorded: the weeklies ticked, the planned bought. While allowed followed the ticks, ticking a weekly moved both sides at once and a month could never read as under on one. Both columns foot exactly to the figures under them, which is why the rows the cards really say are captioned off rather than mixed in. A rearrangement of the same figures was harder to trust than the layout it had been read in for years, so Home shows that layout. Above it sits the one thing the table does not say outright: what the month ends up saving, with **how far over or under plan today is as a chip** rather than a clause three sentences into a paragraph, and one sentence on what is still to come and where the month lands if it is held. "On track" is a claim about the plan, not about the sign of the number, so a month above what the plan allows reads "is set to save" over its green figure instead. Every figure in the table comes off the same `cashflowForMonth`, so the rows and the totals cannot drift apart; the statement holds no inputs of its own, so it re-renders whole on a keystroke rather than being patched cell by cell. **How this adds up** itemises both halves of Out — every cash monthly, the annual share, every card monthly with its due date, each weekly rule as one row showing its working (`Food shop · 4 × £400.00`), each planned one-off, and the per diem — with each half totalling to the figure on the statement. A saving that looks too good can be checked against its lines instead of trusted. How this adds up, Income, Cards, Pending, Exceptions, Don't spend this, Weeklies, and Planned are boxed accordions, all closed when Home opens so the statement reads first; open/closed then stays in the session, so a tick does not reset it. (An id missing from that list is dropped on read and never written back, which is how "How this adds up" quietly refused to stay open.) Income has a clear **Add payslip** button. Cards sit on Home with an inline balance. Pending is a small amount table, not named line-items, with **Clear all** for a fresh table. A refund or credit on the statement goes in as a minus and comes off the card side. A card can also carry its own typed pending figure, and both count toward the check — when a card has one, the Pending helper says so, so the same amount is not entered twice. Weeklies are ticked here (the sheet's untitled column Q). This month's planned items live in the Planned accordion and sit in Out whether or not they are purchased. A card with no balance recorded for the month on screen would read as £0 and report the whole allowance as underspend, so the check goes to `—` until a balance is in; a card carrying no figure at all reads as nothing on it, never as `£NaN`. Every change — ticks, table edits, and modal saves alike — flips in memory and writes to the gist in the background; a write that fails shows on the sync chip with a retry rather than holding a form open on the network.

- **Weeklies** — the rules that make the slots; the slots themselves are ticked on Home, so ticking lives in one place. Each rule is entered once: name, typical amount (required), and cadence (**N times a month**, or **every week on a chosen weekday**). N=1 is once a month. Slots for a weekday rule are the count of that weekday in the month being viewed (four Tuesdays → four slots). **Every slot falls due on a day of the month, and that date is what allows it on the cards** — whether or not it has been ticked. A weekday rule says its own dates; an N-times-a-month rule has none, so its slots are spread evenly and each falls due at the start of its own slice (four in a 31-day month: the 1st, 8th, 16th and 24th), which is the week-by-week shape the rule stands in for. The room lists those days beside each rule and Home labels a slot the month has not reached yet. An extra occurrence can be added for that month only; an extra was added because it happened, so it is due at once. A new month starts unticked; old months keep their ticks. Missing paid-from defaults to card; a cash weekly still counts in the card allowance when ticked.
- **Monthlies** — standing bills: name, amount, due day, cash or card. Two due rules: on the calendar day, or that day rolled to the next working day. (“First working day of the month” was only ever day 1 rolled forward — the same rule — so it is gone, and an older record is stored as the rule it always meant.) Config only — no ticks (the sheet never ticked cash bills or card subs). Cash and card lines count in Out for the whole viewed month. Cash lines (mortgage, council tax) never enter the card allowance. Card lines enter it on the effective due date, with no tick. **Per diem** is the month's spending money, and it is a figure of its own rather than a line in a list — one amount for the whole month, changed in one place. It is divided by the days in the month to give a daily rate (the form shows the rate as the amount is typed: £930 over 31 days is the £30 a day the sheet calls it), and the days gone by decide how much of it the cards are allowed to carry — on the 10th of a 30-day month, ten days of it. It is spent on the cards, so it sits on the card side of Out in full and pro-rates into the allowance by day-of-month, as the sheet's column L does. It was one row in a "cash in reserve" list that mixed two different things: the day money, and standing cash costs like a cleaner or nails that never touched a card — pro-rating those two put the allowance about £197 over the sheet's on day 26 of 31. Reading an older gist splits that list back apart: the day money becomes the per diem, and the standing costs are read as the cash monthlies they always were, which leaves Out exactly where it was. Insurance saving is the Annual total ÷ 12.
- **Exceptions** — spending that came out of another pot, not the normal amount: item, month, amount. Travel insurance at £560 in August lets the card carry £560 more before it reads as overspend, and leaves Savings alone. They only count in the month they are recorded against, and the section says how many sit in other months.
- **From savings** — money drawn in to cover the month: the exceptions, which came out of another pot by definition and are carried in on their own, plus anything typed on top. It raises what the month ends up with, never what the cards may carry.
- **Don't spend this** — the mirror of an exception, and the only thing that takes the card allowance *down*: name, month, amount. An exception is paid from another pot, so the cards may carry that much more; a set-aside is money decided against, so they may carry that much less. Nothing is spent and neither the plan nor Savings moves — holding it is what turns it into a saving, through the underspend. Like an exception it belongs to one month, because "last month was dear, don't spend this £500" is a decision about a month.
- **Planned** — item, month, estimate, purchased. A one-off is planned for a month rather than for a day of it, so the whole month is when it may be bought: it is allowed on the cards from the first, and ticking it records that it landed. The current month’s rows also sit on Home. This screen is the viewed month's list over an **Every month ahead** table — this month and every month ahead that has something in it, with a bar for relative size — so a month quietly filling up is visible before it arrives. Tap a month to open it. (The room used to list the other months' items underneath as well, which showed December's total twice on one screen.)
- **Annual** — yearly bills. Total ÷ 12 is a cash line in Out every month. Edit here; do not type it twice.
- **Pots** — named pots with dated monthly snapshots and a simple graphic of values over time. A quiet line reminds you to log this calendar month if it is missing. Optional pension *names and status* only.
- **Payslips** — per person, per UK tax year: pay period, salary, gross, note, month the money lands. The list shows **net** as its figure, because net is what the month is built on; gross sits in the line beneath it. A **funded cashplan** is two lines on the slip — added to the payments and taken straight back off — so it is two categories that cancel, rather than something to net off by hand. Categories start from the sheet’s fixed column set (bonus through jury service, plus parental-pay columns) and live under More. The slip picks categories and amounts. A new slip copies last month’s used categories for that person. Forecast rows are labelled and not treated as confirmed for the £100k helper. Home In uses the calculated net for slips that land in the viewed month.

  Net follows the payslip’s own arithmetic: **Net pay = Total gross pay − Total deductions**. `Gross` is the Payments total, so it already carries basic, bonus, and any parental pay — none of those is added again. A **taxable benefit** is taxable either way, so it always counts for the £100k line. Whether it is *also* money depends on the slip — a car allowance is paid, private medical is not — and that is not a question anyone should have to answer in payroll vocabulary to enter their own pay. There is one **Benefits** category, the payslip's own word, and `benefitsPaid` says whether it reaches the bank. **The net printed on the payslip settles it**, along with every other reading, so nothing has to be chosen. A **salary sacrifice** is not an employee deduction — the employee gives up contractual pay and the employer pays the pension, so gross is already reduced by it; a slip that shows gross before the sacrifice ticks **Gross is before salary sacrifice** and only then does it come off. A **relief-at-source pension** is the opposite: it is paid out of pay, so it *is* a deduction, and for adjusted net income it comes off grossed up by 100/80. The two are separate categories — the old single “Pensions” category said nothing about which.

  How a slip writes `Gross`, and whether a benefit is money, are facts about the payslip rather than things to have to know, so the form does not ask. **Type the net the payslip prints and the app works the rest out**: it applies the one reading that lands on that figure and says what it concluded in plain words. That reading is not only applied while the form is open — a slip carrying its own net is read that way *wherever* it is used, so Home's income and the £100k line are right without the slip being reopened, and a slip saved before the net settled it corrects itself — “Read as: the gross you typed is what the slip pays, the benefit is money you actually receive.” The list of readings — the Payments total, before the sacrifice, basic pay with the bonus on top, the benefit paid or not — is the fallback for when the typed net matches nothing, or matches more than one. Type the optional **Net on the payslip** and the matching reading is marked for you. Picking one only says how to read Gross; it never changes a typed figure.

  When a stated net matches nothing, the form names the likely cause: a gap that is exactly the sacrifice, exactly the bonus, or exactly the benefit is called out, and anything else points at a missing deduction. A benefit-sized gap the *other* way says the slip pays it in cash and points at Cash allowance. One check does not wait for a stated net at all: **Gross typed as salary ÷ 12 is the contractual figure, before any salary sacrifice**. That is a fact about the number rather than a guess about the slip, so with no net typed it is applied rather than only warned about — left alone it overstates net by the whole sacrifice every month, and nothing else would catch it. An imported workbook carries the sheet’s own `Net` column in as the stated net, so an import says where the sheet and the app disagree instead of hiding it.
- **£100k helper** — YTD from confirmed payslips, remaining months at the last confirmed run-rate, extra salary-sacrifice needed to stay at or under £100,000 adjusted net income — as a pounds amount and as a percentage of remaining projected pay. Grossed-up Gift Aid from giving in that tax year is deducted automatically: adjusted net income is net income less the gross donation (ITA 2007 s58), so £80 given with Gift Aid takes £100 off.
- **Giving** — who, charity, date, amount, Gift Aid, gross, tax year.
- **Friend tabs** — friends, 50/50 expenses with an optional share adjustment, transfers, running balances.

Hash routes keep refresh and Back in the same place (`#/home`, `#/weeklies`, `#/monthlies`, `#/planned`, `#/annual`, `#/pots`, `#/payslips`, `#/ani`, `#/giving`, `#/tabs`, `#/friend/<id>`, `#/more`). **The bar carries four: Home, Planned, Tabs, More.** It listed all eleven, which wrapped to three rows, took a third of a phone screen, and made every page clear 240px of padding to get past it; of the five that replaced them, Weeklies and Monthlies are config that barely changes once it is right. The bar is the rooms the month runs through — home, what is coming, who owes what. The rest are places you visit now and then, so More lists them with a line each saying what they are for, then sign-in, gist status, people, and payslip category names.

Every room and every sheet opens with **one title** — a room's is named the way its tab is — one short line, and the detail folded behind **How this works**. Both used to lead with an eyebrow, a title that mostly repeated it ("NEW MONTHLY" over "Add a monthly"), and a paragraph of documentation read once and then re-read on every visit for ever. The only eyebrow left is on the front door, where it is the product's name rather than a repeat of the heading below it.

A `label` was a grid, so an inline `optional` marker became a row of its own: every optional field stood 23px taller than it needed to and the marker read as a field in its own right. Labels are blocks, controls are block-level children of them, and a narrow control — a day, a month — still starts its own line. An empty amount was set in the same bold as a typed one, so a placeholder `0.00` read as a figure someone had entered; placeholders are muted now.

**Sync status is status, not reassurance.** "Saved to a private gist" took a row of its own on every screen to report that nothing had happened. At rest it is a quiet word in the top bar — *Saved*, or *Local* for a local workbook — and it only grows into a chip when a write is in flight or has failed, where the failed one is still the retry button.

**A household with nothing in it** used to get a full statement of em-dashes under "on track to save £0.00" — a confident answer to a question nobody had asked. It gets **Start here** instead: a payslip, the standing bills, the per diem, each opening its own sheet.

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

`test/calculations.test.mjs` covers friend-tab splits and balances. `test/household.test.mjs` covers In/Out as the month plan, Savings as In−Out, the month-end saving as Savings plus the under/overspend, the whole month's allowance and what is left of it, that what is left splits exactly into what is owed and the per diem that is chosen, a weekly not yet ticked counting as owed rather than as room to spend, a weekly tick coming off what is left pound for pound, the month phase (a month gone has nothing still to come; one ahead has all of it), a card carrying no figure reading as nothing rather than NaN, a card balance lowering the month-end saving pound for pound, exceptions raising the card allowance without moving Savings, the card check as allowance-so-far minus cards, income from payslips, card and cash monthlies in Out, weeklies and purchased one-offs not moving In or Out, a £100 weekly tick raising savings while cards stay put, a card monthly due on the 6th staying out of spent-so-far on the 5th, the per diem allowed a day at a time and spread over the days in the month, a weekly slot's due day (its own date for a weekday rule, an even spread for an N-times-a-month one) and that date rather than the tick being what allows it and what takes it off what is left to spend, a planned one-off allowed for the whole month it is planned in, money held back taking the card allowance down without moving the plan or Savings, an exception being spending funded by a transfer in of the same size so the saving does not move, money drawn in from savings raising what the month ends up with but never the card allowance, all three of the statement's columns footing to their own totals, Out splitting by where the money leaves, the per diem being card money while standing cash costs are not, a benefit counting in adjusted net income either way and in net unless the slip says it is notional, the payslip's own net resolving every reading at once and resolving to nothing rather than guessing when it matches none, a stored slip saved with the wrong flag being read correctly from its net without being reopened, a gross typed as salary ÷ 12 being read as the before-sacrifice figure it is, with no net typed, the Out breakdown naming every line on the side it is spent from and tying to the totals, planned totals per month ahead, first-working-day being day 1 rolled forward, the card check going unknown when a card has no balance for the month on screen, grossed-up Gift Aid coming off adjusted net income, a standing cash mortgage never entering spent-so-far, purchasing a planned one-off raising savings, future-month dues staying at 0 with no “this month” verdict, no paidMonths ticks on bills, month labels (September is not “this month” in August), payslip net as gross paid less deductions, a notional benefit staying out of net but in ANI, salary sacrifice not double-counted, a relief-at-source pension grossed up for ANI, the stated-net check and its hints, every reading of Gross offered with its own net, new-slip category defaults, the pending table total, clear-all pending, weekly cadence (N times + every week on a weekday; N=1 is once), a required typical amount, and one-offs for the viewed month sitting in Out. `test/home-sections.test.mjs` keeps accordion open/closed across ticks. `test/ui.test.mjs` checks the £ prefix class, Home hooks, the statement's three blocks — the headline saving and its sentence, the plan, and the live position — that the plan's card half and the live card balance no longer sit in one column, that the month-end figure is stated once rather than repeated as a footer row, that what is still to come is two rows — what is owed and the per diem that is chosen — rather than one "left to spend", that the close only says "hold that" when there is per diem to hold to, that a finished month drops those rows and a month not started drops the whole live block, the Exceptions section, that typing a card balance or a pending amount repaints every part of the statement with no refresh, that standing monthlies have no tick control, that the per diem is one editable figure rather than a list, that the bar carries Home, Planned and Tabs with More listing the rest, that money can be drawn in from savings and the exceptions come with it, that a room opens with one title and folds its documentation away, that a weekly says which day of the month allows it, that a sheet does the same and keeps its one eyebrow on the front door alone, that an optional field is one line and an empty amount looks empty, that sync status sits in the top bar, that an empty household is asked for what a month needs, and that a friend's running balance is a total rather than the row's own sentence again. `test/store.test.mjs` covers an older gist's "cash in reserve" list splitting into the per diem and cash monthlies, money held back and money drawn in from savings each being one month's line like an exception, and all of them surviving a round-trip. `test/persist-queue.test.mjs` covers flipping a tick before the gist write, and a failed write neither escaping the debounce timer nor stopping the next change from writing. `test/workbook-import.test.mjs` keeps a synthetic workbook mapper for tests only — there is no import button in the app. `test/stage-site.test.mjs` covers that every published module parses — the rest of the suite reads `app.js` as text, so a module that does not parse passed every test and failed only in the browser — and what gets published: the entry module read off `index.html`, every shape of relative import, a transitive graph that survives a cycle, the real app's nine modules (the three that were missing named explicitly), test-only and server-only files staying out, and a missing module failing the build. The other tests cover store validation, the session credential, and the private-gist persistence layer.
