"""Staging, de-duplicating and committing a bank statement.

Nothing reaches the ledger until the user commits. Every import is reversible
as a unit. Duplicates are skipped, never deleted -- a false positive that
silently drops a real Rs 80,000 payment is far more damaging than a duplicate
the architect spots and removes.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from datetime import timedelta
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ingest.normalize import fingerprint, parse_narration
from ..ingest.parsers.statement import ParseResult, RawRow, parse_statement
from ..models import (
    Account,
    BatchStatus,
    Direction,
    ImportBatch,
    StagedRow,
    StagedState,
    Transaction,
    TxnKind,
    TxnStatus,
)
from . import ledger, rules

FUZZY_THRESHOLD = 0.85
FUZZY_WINDOW_DAYS = 3

#: A payment entered by hand is often dated the day you remembered it, not the
#: day it cleared, so matching manual entries needs a wider window than matching
#: two bank statements against each other.
MANUAL_WINDOW_DAYS = 4

#: Banks fill the reference column with placeholders on UPI and card rows --
#: "000000", "-", "NA". Treating those as identity makes every such row look
#: like a duplicate of the last one, silently dropping real transactions.
_PLACEHOLDER_REFS = {"na", "nil", "none", "null", "n/a", "0"}


def meaningful_ref(ref: str | None) -> str | None:
    """Return the reference only if it could actually identify one payment."""
    text = (ref or "").strip()
    if len(text) < 4:
        return None
    if text.lower() in _PLACEHOLDER_REFS:
        return None
    stripped = text.strip("0-_.* ")
    if not stripped:  # "000000", "------", "0000.00"
        return None
    if not any(character.isalnum() for character in text):
        return None
    return text


def file_digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def previous_import_of(db: Session, account_id: int, digest: str) -> ImportBatch | None:
    return db.scalar(
        select(ImportBatch).where(
            ImportBatch.account_id == account_id,
            ImportBatch.file_sha256 == digest,
            ImportBatch.status == BatchStatus.committed.value,
        )
    )


# ---------------------------------------------------------------------------
# staging
# ---------------------------------------------------------------------------

def stage_file(
    db: Session,
    *,
    account_id: int,
    filename: str,
    data: bytes,
    column_map: dict | None = None,
    header_row: int | None = None,
) -> tuple[ImportBatch, ParseResult]:
    result = parse_statement(
        data, filename,
        column_map={k: int(v) for k, v in column_map.items()} if column_map else None,
        header_row=header_row,
    )

    batch = ImportBatch(
        account_id=account_id,
        filename=filename,
        file_sha256=file_digest(data),
        row_count=len(result.rows),
        error_count=len(result.errors),
        period_start=min((r.value_date for r in result.rows), default=None),
        period_end=max((r.value_date for r in result.rows), default=None),
        status=BatchStatus.staged.value,
    )
    db.add(batch)
    db.flush()

    # Number identical rows within this file so two genuine Rs 500 fuel fills on
    # the same day both survive hard de-duplication.
    seen: Counter[tuple] = Counter()
    new = dupes = matched = 0

    for row in result.rows:
        parsed = parse_narration(row.description)
        signed = row.amount if row.direction == Direction.credit.value else -row.amount
        identity = (row.value_date, signed, parsed.normalised)
        occurrence = seen[identity]
        seen[identity] += 1

        fp = fingerprint(account_id, row.value_date, signed, parsed.normalised, occurrence)
        state, dup_of = _classify_duplicate(db, account_id, row, fp, parsed.normalised)

        suggestion = rules.classify(
            db,
            rules.Candidate(
                description_norm=parsed.normalised,
                direction=row.direction,
                amount=row.amount,
                vpa=parsed.vpa,
                raw=row.description,
            ),
        )

        if state == StagedState.new:
            new += 1
        elif state == StagedState.manual_match:
            matched += 1
        else:
            dupes += 1

        db.add(
            StagedRow(
                batch_id=batch.id,
                row_index=row.row_index,
                raw=row.source_cells,
                parsed={
                    "value_date": row.value_date.isoformat(),
                    "description": row.description,
                    "description_norm": parsed.normalised,
                    "vpa": parsed.vpa,
                    "direction": row.direction,
                    "amount": row.amount,
                    "balance": row.balance,
                    "reference": meaningful_ref(row.reference) or parsed.reference,
                    "occurrence_index": occurrence,
                },
                fingerprint=fp,
                dup_of_txn_id=dup_of,
                state=state.value,
                suggestion=suggestion.as_dict(),
                errors=[],
                include=state == StagedState.new,
            )
        )

    for error in result.errors:
        db.add(
            StagedRow(
                batch_id=batch.id,
                row_index=error["row_index"],
                raw={"text": error["text"]},
                parsed={},
                state=StagedState.error.value,
                errors=[error["error"]],
                include=False,
            )
        )

    batch.new_count = new
    batch.dup_count = dupes + matched
    batch.matched_count = matched
    db.flush()
    return batch, result


def _classify_duplicate(
    db: Session, account_id: int, row: RawRow, fp: str, norm: str
) -> tuple[StagedState, int | None]:
    exact = db.scalar(
        select(Transaction).where(
            Transaction.account_id == account_id, Transaction.fingerprint == fp
        )
    )
    if exact:
        return StagedState.duplicate, exact.id

    reference = meaningful_ref(row.reference)
    if reference:
        by_ref = db.scalar(
            select(Transaction).where(
                Transaction.account_id == account_id,
                Transaction.external_ref == reference,
            )
        )
        if by_ref:
            return StagedState.duplicate, by_ref.id

    window = list(db.scalars(
        select(Transaction).where(
            Transaction.account_id == account_id,
            Transaction.amount == row.amount,
            Transaction.direction == row.direction,
            Transaction.value_date >= row.value_date - timedelta(days=MANUAL_WINDOW_DAYS),
            Transaction.value_date <= row.value_date + timedelta(days=MANUAL_WINDOW_DAYS),
        )
    ))

    # A hand-entered row for the same real payment. The amount, direction and
    # date agreeing is strong evidence on its own -- the user typed "lunch"
    # where the bank says "Paid to Sandeep chat bhandar", so the descriptions
    # will not match and must not be required to.
    for candidate in window:
        if candidate.source != "manual":
            continue
        if abs((candidate.value_date - row.value_date).days) <= MANUAL_WINDOW_DAYS:
            return StagedState.manual_match, candidate.id

    for candidate in window:
        if abs((candidate.value_date - row.value_date).days) > FUZZY_WINDOW_DAYS:
            continue
        similarity = SequenceMatcher(
            None, (candidate.description_norm or "").upper(), norm.upper()
        ).ratio()
        if similarity >= FUZZY_THRESHOLD:
            return StagedState.possible_duplicate, candidate.id

    return StagedState.new, None


# ---------------------------------------------------------------------------
# preview and commit
# ---------------------------------------------------------------------------

def preview(db: Session, batch: ImportBatch) -> dict:
    rows = db.scalars(
        select(StagedRow).where(StagedRow.batch_id == batch.id).order_by(StagedRow.row_index)
    ).all()

    auto = sum(
        1 for r in rows
        if r.state == StagedState.new.value and (r.suggestion or {}).get("auto_apply")
    )
    needs_review = sum(
        1 for r in rows
        if r.state == StagedState.new.value and not (r.suggestion or {}).get("auto_apply")
    )

    matched = sum(1 for r in rows if r.state == StagedState.manual_match.value)
    return {
        "batch_id": batch.id,
        "filename": batch.filename,
        "status": batch.status,
        "account_id": batch.account_id,
        "period_start": batch.period_start.isoformat() if batch.period_start else None,
        "period_end": batch.period_end.isoformat() if batch.period_end else None,
        "counts": {
            "total": batch.row_count,
            "new": batch.new_count,
            "duplicates": batch.dup_count - matched,
            "matched_manually": matched,
            "errors": batch.error_count,
            "auto_categorised": auto,
            "needs_review": needs_review,
        },
        "rows": [
            {
                "id": r.id,
                "row_index": r.row_index,
                "state": r.state,
                "include": r.include,
                "dup_of_txn_id": r.dup_of_txn_id,
                "errors": r.errors,
                "suggestion": r.suggestion,
                **(r.parsed or {}),
            }
            for r in rows
        ],
    }


def commit(db: Session, batch: ImportBatch, *, actor_id: int | None = None) -> dict:
    if batch.status == BatchStatus.committed.value:
        raise ValueError("This import has already been committed.")

    rows = db.scalars(
        select(StagedRow).where(
            StagedRow.batch_id == batch.id, StagedRow.include.is_(True)
        ).order_by(StagedRow.row_index)
    ).all()

    created = 0
    auto_categorised = 0

    for row in rows:
        parsed = row.parsed or {}
        if not parsed:
            continue

        suggestion = row.suggestion or {}
        splits: list[ledger.Split] = []
        kind = TxnKind.uncategorised.value

        if suggestion.get("auto_apply") and suggestion.get("fund_id"):
            splits = [
                ledger.Split(
                    fund_id=int(suggestion["fund_id"]),
                    amount=int(parsed["amount"]),
                    category_id=suggestion.get("category_id"),
                    vendor_id=suggestion.get("vendor_id"),
                    confidence=float(suggestion.get("confidence", 0)),
                    applied_by="rule" if suggestion.get("rule_id") else "auto",
                    rule_id=suggestion.get("rule_id"),
                    reason=suggestion.get("reason"),
                )
            ]
            kind = suggestion.get("kind") or kind
            auto_categorised += 1

        from datetime import date as _date

        txn = ledger.record_transaction(
            db,
            account_id=batch.account_id,
            value_date=_date.fromisoformat(parsed["value_date"]),
            direction=parsed["direction"],
            amount=int(parsed["amount"]),
            kind=kind,
            description=parsed.get("description", ""),
            splits=splits,
            external_ref=parsed.get("reference"),
            running_balance=parsed.get("balance"),
            source="file",
            import_batch_id=batch.id,
            occurrence_index=int(parsed.get("occurrence_index", 0)),
            fingerprint_override=row.fingerprint,
            actor_id=actor_id,
        )
        row.state = StagedState.committed.value
        row.dup_of_txn_id = txn.id
        created += 1

    batch.status = BatchStatus.committed.value
    db.flush()

    return {
        "batch_id": batch.id,
        "created": created,
        "auto_categorised": auto_categorised,
        "needs_review": created - auto_categorised,
    }


def revert(db: Session, batch: ImportBatch) -> dict:
    """Undo an import, refusing if any of its rows have since been touched."""
    txns = db.scalars(
        select(Transaction).where(Transaction.import_batch_id == batch.id)
    ).all()

    blocked = []
    for txn in txns:
        account = db.get(Account, txn.account_id)
        if account and account.reconciled_through and txn.value_date <= account.reconciled_through:
            blocked.append({"id": txn.id, "why": "inside a reconciled period"})
            continue
        if any(a.applied_by == "user" for a in txn.allocations):
            blocked.append({"id": txn.id, "why": "you have since categorised it"})

    if blocked:
        return {"reverted": 0, "blocked": blocked}

    for txn in txns:
        db.delete(txn)
    batch.status = BatchStatus.reverted.value
    db.flush()
    return {"reverted": len(txns), "blocked": []}
