"""The single chokepoint for every mutation of money.

No router, no importer, no report writes to ``transaction`` or ``allocation``
directly. Everything goes through here, which is where the invariant is
enforced and the audit row is written. Without one chokepoint the invariant
will be violated by the third feature anyone adds.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.money import Paise
from ..ingest.normalize import fingerprint, parse_narration
from ..models import (
    Account,
    Allocation,
    AppliedBy,
    AuditLog,
    Direction,
    Fund,
    FundKind,
    FundTransfer,
    Transaction,
    TxnKind,
    TxnStatus,
)


class LedgerError(ValueError):
    """Raised when an operation would break the ledger's guarantees."""


@dataclass(slots=True)
class Split:
    """One slice of a transaction, destined for one fund."""

    fund_id: int
    amount: Paise
    category_id: int | None = None
    vendor_id: int | None = None
    note: str | None = None
    confidence: float = 0.0
    applied_by: str = AppliedBy.user.value
    rule_id: int | None = None
    reason: str | None = None


# ---------------------------------------------------------------------------
# funds
# ---------------------------------------------------------------------------

def unassigned_fund(db: Session) -> Fund:
    fund = db.scalar(select(Fund).where(Fund.kind == FundKind.unassigned.value))
    if fund is None:
        fund = Fund(kind=FundKind.unassigned.value, name="Unassigned", is_system=True)
        db.add(fund)
        db.flush()
    return fund


def personal_fund(db: Session) -> Fund:
    fund = db.scalar(select(Fund).where(Fund.kind == FundKind.personal.value))
    if fund is None:
        fund = Fund(kind=FundKind.personal.value, name="Personal", is_system=True)
        db.add(fund)
        db.flush()
    return fund


def fund_for_goal(db: Session, goal_id: int, name: str) -> Fund:
    """Savings goals own a fund, exactly as projects do."""
    from ..models import SavingsGoal

    goal = db.get(SavingsGoal, goal_id)
    if goal is not None and goal.fund_id:
        return db.get(Fund, goal.fund_id)
    fund = Fund(kind=FundKind.savings.value, name=name)
    db.add(fund)
    db.flush()
    return fund


def funds_of_kind(db: Session, kind: str) -> list[Fund]:
    return list(db.scalars(select(Fund).where(Fund.kind == kind).order_by(Fund.sort_order, Fund.id)))


def fund_for_project(db: Session, project_id: int, name: str) -> Fund:
    fund = db.scalar(select(Fund).where(Fund.project_id == project_id))
    if fund is None:
        fund = Fund(kind=FundKind.project.value, name=name, project_id=project_id)
        db.add(fund)
        db.flush()
    return fund


# ---------------------------------------------------------------------------
# balances
# ---------------------------------------------------------------------------

def account_balance(db: Session, account_id: int, as_of: date | None = None) -> Paise:
    """Sum of posted transactions. Nothing else.

    An account's opening balance is itself a transaction (kind
    ``opening_balance``), allocated to a fund like any other money. That is what
    keeps sum(funds) == sum(accounts) true -- a bare opening_balance column
    would be cash with no attribution, and the invariant would fail on day one.
    """
    if db.get(Account, account_id) is None:
        raise LedgerError(f"no account {account_id}")

    q = select(Transaction).where(
        Transaction.account_id == account_id,
        Transaction.status == TxnStatus.posted.value,
    )
    if as_of is not None:
        q = q.where(Transaction.value_date <= as_of)
    return sum(t.signed_amount for t in db.scalars(q))


def total_cash(db: Session, as_of: date | None = None) -> Paise:
    return sum(
        account_balance(db, a.id, as_of)
        for a in db.scalars(select(Account).where(Account.is_archived.is_(False)))
    )


def fund_balance(db: Session, fund_id: int, as_of: date | None = None) -> Paise:
    """What this bucket holds: its allocations, plus transfers in, minus out."""
    alloc_q = (
        select(Allocation, Transaction)
        .join(Transaction, Allocation.transaction_id == Transaction.id)
        .where(
            Allocation.fund_id == fund_id,
            Transaction.status == TxnStatus.posted.value,
        )
    )
    if as_of is not None:
        alloc_q = alloc_q.where(Transaction.value_date <= as_of)

    total = 0
    for alloc, txn in db.execute(alloc_q):
        total += alloc.amount if txn.direction == Direction.credit.value else -alloc.amount

    total += _transfer_sum(db, FundTransfer.to_fund_id, fund_id, as_of)
    total -= _transfer_sum(db, FundTransfer.from_fund_id, fund_id, as_of)
    return total


def _transfer_sum(db: Session, column, fund_id: int, as_of: date | None) -> Paise:
    q = select(func.coalesce(func.sum(FundTransfer.amount), 0)).where(column == fund_id)
    if as_of is not None:
        q = q.where(FundTransfer.date <= as_of)
    return db.scalar(q) or 0


def opening_balance_fund_id(db: Session) -> int:
    """Opening balances land in Personal -- the practice's own starting money."""
    return personal_fund(db).id


# ---------------------------------------------------------------------------
# recording
# ---------------------------------------------------------------------------

def record_transaction(
    db: Session,
    *,
    account_id: int,
    value_date: date,
    direction: str,
    amount: Paise,
    kind: str = TxnKind.uncategorised.value,
    description: str = "",
    splits: list[Split] | None = None,
    external_ref: str | None = None,
    running_balance: Paise | None = None,
    source: str = "manual",
    import_batch_id: int | None = None,
    occurrence_index: int = 0,
    fingerprint_override: str | None = None,
    posted_date: date | None = None,
    notes: str | None = None,
    actor_id: int | None = None,
) -> Transaction:
    """Create one cash-plane row and its attribution.

    Any amount the caller has not allocated goes to the Unassigned fund. Never
    to a NULL -- that is precisely what keeps sum(funds) == sum(accounts) true.
    """
    if amount <= 0:
        raise LedgerError("amount must be positive; sign comes from direction")
    if direction not in (Direction.credit.value, Direction.debit.value):
        raise LedgerError(f"bad direction {direction!r}")

    account = db.get(Account, account_id)
    if account is None:
        raise LedgerError(f"no account {account_id}")
    if (
        account.reconciled_through
        and value_date <= account.reconciled_through
        and kind != TxnKind.opening_balance.value
    ):
        raise LedgerError(
            f"{value_date} falls in a period reconciled through "
            f"{account.reconciled_through}. Reopen that period to post here."
        )

    parsed = parse_narration(description)
    signed = amount if direction == Direction.credit.value else -amount
    fp = fingerprint_override or fingerprint(
        account_id, value_date, signed, parsed.normalised, occurrence_index
    )

    txn = Transaction(
        account_id=account_id,
        value_date=value_date,
        posted_date=posted_date,
        direction=direction,
        amount=amount,
        kind=kind,
        description_raw=description,
        description_norm=parsed.normalised,
        counterparty=parsed.counterparty,
        vpa=parsed.vpa,
        external_ref=external_ref or parsed.reference,
        running_balance=running_balance,
        source=source,
        import_batch_id=import_batch_id,
        fingerprint=fp,
        notes=notes,
    )
    db.add(txn)
    db.flush()

    _write_allocations(db, txn, splits or [])
    _audit(db, actor_id, "transaction", txn.id, "create",
           {"amount": amount, "direction": direction, "kind": kind})
    return txn


def set_allocations(
    db: Session,
    txn: Transaction,
    splits: list[Split],
    *,
    actor_id: int | None = None,
) -> Transaction:
    """Re-attribute a transaction. Never touches the cash plane.

    This is why re-categorising six months of history is safe: the bank
    reconciliation cannot be affected by anything done here.
    """
    for alloc in list(txn.allocations):
        db.delete(alloc)
    db.flush()
    _write_allocations(db, txn, splits)
    _audit(db, actor_id, "transaction", txn.id, "recategorise",
           {"splits": [(s.fund_id, s.amount) for s in splits]})
    return txn


def _write_allocations(db: Session, txn: Transaction, splits: list[Split]) -> None:
    allocated = sum(s.amount for s in splits)
    if allocated > txn.amount:
        raise LedgerError(
            f"allocations ({allocated}) exceed transaction amount ({txn.amount})"
        )
    if any(s.amount <= 0 for s in splits):
        raise LedgerError("allocation amounts must be positive")

    for split in splits:
        db.add(
            Allocation(
                transaction_id=txn.id,
                fund_id=split.fund_id,
                category_id=split.category_id,
                vendor_id=split.vendor_id,
                amount=split.amount,
                note=split.note,
                confidence=split.confidence,
                applied_by=split.applied_by,
                rule_id=split.rule_id,
                reason=split.reason,
            )
        )

    remainder = txn.amount - allocated
    if remainder > 0:
        db.add(
            Allocation(
                transaction_id=txn.id,
                fund_id=unassigned_fund(db).id,
                amount=remainder,
                applied_by=AppliedBy.system.value,
                reason="Awaiting review",
            )
        )
    db.flush()
    db.refresh(txn)


def void_transaction(
    db: Session, txn: Transaction, *, actor_id: int | None = None, reason: str = ""
) -> Transaction:
    """Void rather than delete. History stays reproducible."""
    account = db.get(Account, txn.account_id)
    if account and account.reconciled_through and txn.value_date <= account.reconciled_through:
        raise LedgerError("cannot void a transaction inside a reconciled period")
    txn.status = TxnStatus.void.value
    txn.notes = f"{txn.notes or ''}\nVoided: {reason}".strip()
    db.flush()
    _audit(db, actor_id, "transaction", txn.id, "void", {"reason": reason})
    return txn


def create_fund_transfer(
    db: Session,
    *,
    from_fund_id: int,
    to_fund_id: int,
    amount: Paise,
    on: date,
    reason: str,
    note: str | None = None,
    actor_id: int | None = None,
) -> FundTransfer:
    """Move money between buckets. No cash event -- the bank never sees this.

    A fee draw is the canonical case: project fund -> personal fund. Counting it
    as income or as expense corrupts both figures, so it is neither.
    """
    if amount <= 0:
        raise LedgerError("transfer amount must be positive")
    if from_fund_id == to_fund_id:
        raise LedgerError("cannot transfer a fund to itself")
    if db.get(Fund, from_fund_id) is None or db.get(Fund, to_fund_id) is None:
        raise LedgerError("unknown fund")

    transfer = FundTransfer(
        from_fund_id=from_fund_id,
        to_fund_id=to_fund_id,
        amount=amount,
        date=on,
        reason=reason,
        note=note,
    )
    db.add(transfer)
    db.flush()
    _audit(db, actor_id, "fund_transfer", transfer.id, "create",
           {"from": from_fund_id, "to": to_fund_id, "amount": amount})
    return transfer


# ---------------------------------------------------------------------------
# integrity
# ---------------------------------------------------------------------------

def integrity_check(db: Session) -> dict:
    """The check most expense trackers cannot make.

    If this ever fails, something wrote to the database outside this module.
    """
    problems: list[dict] = []

    for txn in db.scalars(select(Transaction)):
        allocated = sum(a.amount for a in txn.allocations)
        if allocated != txn.amount:
            problems.append(
                {
                    "type": "allocation_mismatch",
                    "transaction_id": txn.id,
                    "expected": txn.amount,
                    "found": allocated,
                }
            )

    cash = total_cash(db)
    funds = sum(fund_balance(db, f.id) for f in db.scalars(select(Fund)))
    if cash != funds:
        problems.append(
            {"type": "plane_divergence", "cash": cash, "funds": funds, "delta": cash - funds}
        )

    transfers_in = db.scalar(select(func.coalesce(func.sum(FundTransfer.amount), 0)))
    return {
        "ok": not problems,
        "cash_balance": cash,
        "fund_total": funds,
        "transfer_volume": transfers_in or 0,
        "problems": problems,
    }


def _audit(db: Session, actor_id: int | None, entity: str, entity_id: int,
           action: str, detail: dict) -> None:
    db.add(
        AuditLog(
            actor_id=actor_id,
            entity=entity,
            entity_id=entity_id,
            action=action,
            detail=detail,
        )
    )
