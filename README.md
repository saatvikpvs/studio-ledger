# Spatial Anthology — Ledger

A personal and studio ledger for one architect and one bank account.

Client advances arrive in the same current account as the grocery money, and the
bank cannot tell them apart. This does — in software, without pretending the
money was ever physically separated.

---

## Three areas, one account

Everything is organised around three areas, and they always add up:

```
Personal  +  Professional  +  Savings  +  Unfiled  ==  the money in the bank
```

**Personal** is your own money. **Professional** is Spatial Anthology — client
money held against the project it was paid for. **Savings** is money you have
set aside, still in the same account but reserved so the rest of the dashboard
stops counting it as spendable. **Unfiled** is anything imported but not yet
assigned; it is a real bucket, never a null, which is what makes the sum above
hold at every instant.

`GET /api/v1/health/integrity` checks it, and so does the test suite after every
step of a randomised sequence of entries, re-filings, transfers and voids.

### What follows from that

- Re-filing six months of history can never affect the bank reconciliation.
- A project *can* go negative. Money is fungible; if a client advance paid for
  groceries, the project shows short and the dashboard says so. It warns loudly
  and blocks nothing, because the bank didn't block it either.
- **Setting money aside creates no bank transaction.** It moves between your own
  envelopes, so it is neither income nor expense.
- A **fee draw** (project → Personal) works the same way and for the same reason.

---

## Daily use

**Record an expense** with the strip at the top of every page. Amount, a word
about what it was, which area — about five seconds. It is a strip and not a
dialog on purpose: a modal you have to open, fill and dismiss is the difference
between recording an expense and not bothering.

`E` starts an expense, `M` money received, `Enter` records it.

**Once a month**, upload the UPI statement under **Reconcile**. It is a check on
what you already entered, not the main way data gets in:

- rows you already typed in yourself are recognised and *not* imported again
- rows already imported are recognised as duplicates
- everything genuinely new lands in Unfiled for you to assign
- repeat payees are grouped, so twenty-two payments to one place are one decision

---

## Running it

Python 3.11+ and Node 20+. No Docker, no Postgres.

```bash
cd apps/api && pip install -r requirements.txt
```

```bash
cd apps/api && python -m app.setup_studio --reset --opening "0"
```

Pass your real current bank balance to `--opening` — that is the one figure the
ledger cannot work out for itself.

```bash
cd apps/web && npm install && npm run build
```

```bash
cd apps/api && python -m uvicorn app.main:app --port 8000
```

Open <http://127.0.0.1:8000>. The API serves the built frontend, so that is the
only process you need.

**Sign in:** `studio@spatialanthology.in` / `spatialanthology` — change the
password in `app/setup_studio.py` before using this for real.

### Developing

```bash
cd apps/api && python -m uvicorn app.main:app --port 8000 --reload
```

```bash
cd apps/web && npm run dev
```

### Tests

```bash
cd apps/api && python -m pytest
```

97 tests. The ones that matter are in `tests/test_ledger.py` and
`tests/test_areas.py`: they assert that the areas sum to the bank balance after
every step of a randomised operation sequence, and that a statement row matching
a hand-entered payment is never imported twice.

---

## Design

The interface is a drawing sheet, not a dashboard. Sections are divided by
hairlines with their label in the left gutter, the way a plan is keyed; nothing
floats in a card; nothing is rounded.

Colour is material — paper, graphite, blueprint ink, patina, oxide — and is
spent on keylines and marks rather than fills. The three areas are told apart by
a 2px rule, not by a tinted panel:

| | |
|---|---|
| Personal | graphite `#3A3A42` |
| Professional | blueprint `#2B4A7A` |
| Savings | patina `#46695C` |
| Money out / warnings | oxide `#A24A32` |
| Money in | sap `#4A6B3F` |

Two typefaces: **Instrument Serif** for the wordmark, section titles and
headline figures; **Archivo** for data, controls and tracked-caps annotation.

There is one graphic on the overview — a **section through the money**, the bank
balance cut open with each area drawn as poché and a dimension string beneath.
It replaces four tiles and a pie chart with one drawing that states the model
outright. The two smaller drawings (category rules, the month strip) are
hand-set rather than pulled from a charting library, which is also why there is
no charting dependency: a library would have brought rounded bars, a legend and
a default palette — the generic look this interface exists to avoid.

---

## Layout

```
apps/api/app/
  core/        money (integer paise), config, db, security
  models/      cash plane, attribution plane, savings goals, ingest, assurance
  services/
    ledger.py     the single chokepoint for every mutation of money
    analytics.py  every figure the dashboard shows, in one place
    rules.py      five-layer explainable classifier
    importer.py   staging, duplicate and manual-entry matching, commit, revert
  ingest/      narration normaliser, CSV/XLSX parser, column mapping
  api/v1/      auth · reference · projects · transactions · import · savings · insights
apps/web/src/
  components/  ui kit, shell, quick entry, section bar, hand-set graphs
  pages/       overview · personal · studio · savings · reconcile · entries · reports · settings
```

**Money** is an integer count of paise everywhere — `BIGINT` in the database,
`int` in Python, integer paise in JSON. No float touches a monetary value.

**The chokepoint rule:** no router, importer or report writes to `transaction`
or `allocation` directly. Everything goes through `services/ledger.py`, which is
where the invariant is enforced and the audit row is written.

---

## Security

The application **never asks for, accepts, logs or stores** a bank password,
net-banking login, UPI PIN, card PIN, CVV or OTP. This is enforced in code: a
middleware and a validator reject any field named like a credential. It only
reads statements you download yourself, and accounts store at most the last four
digits.

Passwords are Argon2id; the session is a JWT in an `httpOnly; SameSite=Strict`
cookie; the signing key is generated once and persisted to `.secret_key`
(gitignored). Set `COOKIE_SECURE=true` behind HTTPS.

---

## Known gaps

1. **No Alembic.** `create_all` is fine until the first schema change against
   real data. Add migrations before that.
2. **No PDF import.** CSV and Excel work; most Indian banks also offer a
   password-protected PDF, which is the next import job.
3. **PDF export is browser print.** CSV and Excel are generated server-side.
4. **No 2FA.** Fields exist on the owner model; the flow is not built.
5. **Savings assumes one account.** If you move savings to a genuinely separate
   bank account, record that as a transfer between accounts as well.

Architecture notes and the bugs this project has already survived are in
[`docs/architecture.md`](docs/architecture.md).
