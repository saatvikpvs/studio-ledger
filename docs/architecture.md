# Architecture

The full design document — financial model, database design, import pipeline,
Account Aggregator path, phasing, and the edge cases this model is built to
survive — is published at:

<https://claude.ai/code/artifact/54dfbed3-2f1e-4afb-8006-1fa16e7aa62e>

This file records where the built system **deviates** from that document, and
why. Those deviations are deliberate; the document was written before any code
existed and reality moved a few things.

## Deviations from the plan

**Money is `BIGINT` paise, not `NUMERIC(16,2)`.** The plan specified `NUMERIC` in
Postgres with `Decimal` in Python. Integer minor units are portable across SQLite
and Postgres identically, and they remove float risk structurally rather than by
discipline. `apps/api/app/core/money.py` is the only place rupees exist.

**Integer paise on the wire, not decimal strings.** The plan called for strings
out of caution. JavaScript integers are exact to 2^53 — about 90 trillion rupees
— so integers are lossless here and simpler at both ends.

**SQLite by default, not Postgres.** "One real practice" means it has to start
with one command and no infrastructure. `DATABASE_URL` switches to Postgres and
the models are unchanged.

**No Alembic yet.** The app uses `create_all`. This is the most significant
shortcut and the first thing to fix before any schema change lands against real
data.

**The invariant is enforced in the service layer, not by a database trigger.**
The plan argued hard for a trigger, on the grounds that application checks get
bypassed. That argument still stands. What exists instead is a single chokepoint
(`services/ledger.py`), a `/health/integrity` endpoint, and property-style tests
that assert the invariant after every step of a randomised operation sequence.
Add the trigger when moving to Postgres.

**Opening balance is a transaction, not a column.** The plan left
`account.opening_balance` as a plain figure. That is cash with no attribution, so
`sum(funds) == sum(accounts)` would have failed on day one. Creating an account
now posts an `opening_balance` transaction allocated to Personal; the column is
kept only as the figure that was entered.

**PDF export is the browser's print dialog.** WeasyPrint needs GTK on Windows.
CSV and Excel are generated server-side.

**Fuzzy duplicate matching uses `difflib`, not `rapidfuzz`.** One fewer
dependency; the threshold is advisory anyway and never auto-deletes.

## Bugs the tests and a real statement caught

Recorded because each represents a class of failure worth remembering.

**A lying header column.** A PhonePe statement has a column named
`Credit/debit instrument` whose contents are text like
`Credited to 6272XXXXXXXX1009`. Header matching on the word "credit" mapped it as
the deposit-amount column, and the number extractor pulled `6272` out of the
masked card digits. All 182 rows parsed as a ₹6,272 credit, with **no error
raised**. The fix — `verify_numeric_columns` — samples the data under any
candidate money column and drops the mapping if the values do not parse as
amounts. Header text cannot be trusted; the data underneath can.

**Placeholder references treated as identity.** Banks write `000000` in the
reference column on UPI rows. Matching on it made every later UPI row look like a
duplicate of the first, silently dropping real transactions. `meaningful_ref`
now rejects placeholder references.

**`Rs. 35,000` parsed as 35 paise.** Stripping non-numeric characters left the
dot from "Rs." attached to the number. Extracting the first number-shaped run
beats deleting everything around it.

**A per-process JWT secret.** `secrets.token_urlsafe()` as a field default meant
a new signing key on every restart, silently invalidating all sessions and
breaking multi-worker deployments outright. Now generated once and persisted.

All four are covered by regression tests in `apps/api/tests/`.

## The seams that matter later

**`StatementSource`** — manual, file, and (later) Account Aggregator all produce
the same `RawTransaction` and feed the same fingerprint → dedupe → classify →
stage pipeline. Adding AA is a new adapter, not a refactor.

**`services/ledger.py`** — the only module that writes to `transaction` or
`allocation`. Keep it that way; the invariant depends on it.

**`services/analytics.py`** — every KPI derivation. If a figure is computed
anywhere else, the same number exists twice and the two will eventually disagree.
