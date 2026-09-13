# Studio Ledger

Project-fund accounting for an architectural practice that runs client money and
personal money through a single bank account.

Client advances arrive in the same current account as the grocery money. The bank
cannot tell them apart. This does — in software, without pretending the money was
ever physically separated.

---

## The one idea

Two planes over one account:

**The cash plane** is what the bank actually did. Every credit and debit, signed,
dated, immutable once reconciled. Sum it and you get the real bank balance. It has
no opinion about projects.

**The attribution plane** is what that money *meant*. Every rupee is attributed to
exactly one fund — a project, Personal, or the system fund `Unassigned`. Sum a
fund and you get that project's remaining money.

The link is an **allocation**: "₹35,000 of this ₹35,000 debit belongs to Rao
Residence, category Materials." One transaction can carry several, which is how a
₹50,000 hardware bill splits across two projects.

Anything you haven't classified goes to `Unassigned` — never to a null. That gives
one permanent guarantee:

```
sum(all fund balances) == sum(all account balances)      always, no exceptions
```

`GET /api/v1/health/integrity` checks it. So do the tests, after every operation
in a randomised 60-step sequence. If it ever fails, something wrote to the
database outside `services/ledger.py`.

### What this buys you

- "Needs review" is not a special query — it is the contents of the Unassigned fund.
- Re-categorising six months of history can never affect the bank reconciliation.
- A project *can* go negative. Money is fungible; if Rao's advance paid for
  groceries, the fund shows −₹42,000 and the dashboard says so. The software warns
  loudly and blocks nothing, because the bank didn't block it either.
- A **fee draw** (project → Personal) moves no cash and is neither income nor
  expense. Counting it either way corrupts both figures.

---

## Running it

Requires Python 3.11+ and Node 20+. No Docker, no Postgres needed.

```bash
cd apps/api && pip install -r requirements.txt
```

```bash
cd apps/api && python -m app.seed --reset
```

That creates `studio_ledger.db` with four projects and about ninety transactions
across eighteen months, and prints the demo login.

```bash
cd apps/web && npm install && npm run build
```

```bash
cd apps/api && python -m uvicorn app.main:app --port 8000
```

Open <http://127.0.0.1:8000>. The API serves the built frontend, so that is the
only process you need.

**Demo login:** `ananya@iyerassociates.in` / `studioledger2026`

### Developing

Run the two separately for hot reload — Vite proxies `/api` to port 8000:

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

82 tests. The valuable ones are in `tests/test_ledger.py`: they assert the
invariant after every step of a randomised sequence of records, re-categorisations,
transfers and voids. Those catch the class of bug that costs the most — a refactor
that quietly breaks attribution in one code path.

---

## Layout

```
apps/api/app/
  core/        money (integer paise), config, db, security
  models/      the schema — cash plane, attribution plane, ingest, assurance
  services/
    ledger.py     the single chokepoint for every mutation of money
    analytics.py  every KPI derivation, in one place
    rules.py      five-layer classifier
    importer.py   staging, three-tier dedupe, commit, revert
  ingest/      narration normaliser, CSV/XLSX parser, bank profiles
  api/v1/      six routers — thin, no business logic
apps/web/src/
  components/  UI kit, shell, charts
  pages/       dashboard, review, projects, transactions, import, reports…
  lib/         api client, money formatting, types
```

**Money** is an integer count of paise everywhere — `BIGINT` in the database,
`int` in Python, integer paise in JSON. No float touches a monetary value at any
layer. JavaScript integers are exact to 2^53, about 90 trillion rupees, so the
wire format is lossless.

**The chokepoint rule:** no router, importer or report writes to `transaction` or
`allocation` directly. Everything goes through `services/ledger.py`, which is
where the invariant is enforced and the audit row is written.

---

## What it does

- **Dashboard** — bank balance, client money held, personal available, net cash;
  how the balance divides across funds; per-project cards with the three different
  "remaining" figures; cash-flow, category and balance-trend charts.
- **Review** — keyboard-driven triage of unclassified rows (`J`/`K` move, `X`
  select, `E` personal, `Enter` confirm), bulk assignment, grouping by merchant.
- **Projects** — own fund each, budget vs actual, category breakdown, payment
  timeline, fee model and margin, one-click fee draw.
- **Import** — CSV/Excel from any bank, header detection with a mapping fallback,
  three-tier duplicate detection, preview before commit, undo as a unit.
- **Reports** — eight reports, filterable, exportable to CSV and Excel.
- **Reconciliation** — check against a statement, see ranked likely causes of any
  difference, lock the period when it balances.

### Classification

Layered and explainable — the UI always shows *why*:

| Layer | Signal | Confidence |
|---|---|---|
| 1 | Your explicit rules | 1.00 |
| 2 | How you classified this merchant before | 0.80–0.95 |
| 3 | Known vendor match patterns | 0.85 |
| 4 | Seed dictionary (Swiggy→Food, cement→Materials) | 0.60 |
| 5 | Shape heuristics (large round credit → client payment) | 0.40 |

One deliberate asymmetry: it fills in **category** confidently but is conservative
about **fund**, because the same cement supplier serves every site. Getting a
project wrong corrupts a client-facing number.

### Duplicate detection

| Tier | Test | Action |
|---|---|---|
| File | `sha256` already imported | Warn before parsing |
| Hard | Reference (UTR/cheque) already present | Skip, reversible |
| Hard | Fingerprint collision | Skip, reversible |
| Fuzzy | Same amount ±3 days, description ≥ 0.85 similar | **Flag only** |

Two ₹500 fuel fills at the same pump on the same day are legitimately identical
and both real, so identical rows within a file are numbered and that counter is
folded into the fingerprint. Placeholder references (`000000`, `-`, `NA`) are
ignored — banks write them on every UPI row, and treating them as identity
silently drops real transactions.

Nothing is ever auto-deleted.

---

## Security

The application **never asks for, accepts, logs or stores** a bank password,
net-banking login, UPI PIN, card PIN, CVV or OTP. This is enforced in code, not
just in policy: a middleware and a validator reject any field named like a
credential. It only reads statements you download yourself. Accounts store the
last four digits and nothing more.

Passwords are Argon2id. The session is a JWT in an `httpOnly; SameSite=Strict`
cookie. The signing key is generated once and persisted to `.secret_key`
(gitignored) — a per-process random key would sign everyone out on every restart.

Set `COOKIE_SECURE=true` behind HTTPS.

---

## Deploying

Point `DATABASE_URL` at Postgres (`postgresql+psycopg://…`) — the models are
portable, money is `BIGINT` rather than `NUMERIC` precisely so both engines behave
identically. Set `SECRET_KEY` and `COOKIE_SECURE=true` in the environment.

---

## Known gaps

Deliberate, in priority order:

1. **No Alembic.** The app uses `create_all`, which is fine until the first schema
   change against real data. Add migrations before that happens.
2. **No PDF import.** Most Indian banks hand out password-protected PDFs; CSV and
   Excel work today. `pdfplumber` with per-bank templates is the next import job.
3. **PDF export is browser print.** CSV and Excel are generated server-side;
   "Print / PDF" uses the browser. WeasyPrint needs GTK on Windows.
4. **No 2FA yet.** TOTP fields exist on the owner model; the flow is not built.
5. **No Account Aggregator.** The `StatementSource` seam is in place so adding it
   is a new adapter, not a refactor.
6. **GST/TDS fields exist, reports do not.** GSTIN on client and vendor; no
   tax-year summary yet.
7. **One JS bundle, 744 KB.** Fine for one user on a desktop; code-split before
   this becomes multi-tenant.

## Architecture notes

The full design document — the financial model, database design, the Account
Aggregator path, phasing, and the edge cases this model is built to survive — is
in [`docs/architecture.md`](docs/architecture.md).
