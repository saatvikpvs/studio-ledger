from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...core.security import require_owner
from ...models import (
    Allocation,
    Fund,
    FundKind,
    Rule,
    Transaction,
    TxnStatus,
)
from ...schemas import (
    BulkCategoriseIn,
    FundTransferIn,
    RecategoriseIn,
    RuleIn,
    RuleOut,
    TransactionIn,
    TransactionPage,
)
from ...services import ledger, rules
from ._serial import serialise_transaction

router = APIRouter(tags=["transactions"], dependencies=[Depends(require_owner)])


# --------------------------------------------------------------------------
# listing
# --------------------------------------------------------------------------

@router.get("/transactions", response_model=TransactionPage)
def list_transactions(
    db: Session = Depends(get_db),
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    fund_id: int | None = None,
    fund_kind: str | None = None,
    category_id: int | None = None,
    direction: str | None = None,
    kind: str | None = None,
    q: str | None = None,
    needs_review: bool = False,
    include_void: bool = False,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
):
    query = select(Transaction)
    if not include_void:
        query = query.where(Transaction.status == TxnStatus.posted.value)
    if date_from:
        query = query.where(Transaction.value_date >= date_from)
    if date_to:
        query = query.where(Transaction.value_date <= date_to)
    if account_id:
        query = query.where(Transaction.account_id == account_id)
    if direction:
        query = query.where(Transaction.direction == direction)
    if kind:
        query = query.where(Transaction.kind == kind)
    if q:
        needle = f"%{q.upper()}%"
        query = query.where(
            or_(
                func.upper(Transaction.description_raw).like(needle),
                func.upper(Transaction.description_norm).like(needle),
                func.upper(func.coalesce(Transaction.external_ref, "")).like(needle),
            )
        )

    if needs_review:
        unassigned = ledger.unassigned_fund(db)
        query = query.where(
            Transaction.id.in_(
                select(Allocation.transaction_id).where(Allocation.fund_id == unassigned.id)
            )
        )
    if fund_id:
        query = query.where(
            Transaction.id.in_(
                select(Allocation.transaction_id).where(Allocation.fund_id == fund_id)
            )
        )
    if fund_kind:
        fund_ids = [f.id for f in db.scalars(select(Fund).where(Fund.kind == fund_kind))]
        query = query.where(
            Transaction.id.in_(
                select(Allocation.transaction_id).where(Allocation.fund_id.in_(fund_ids))
            )
        )
    if category_id:
        query = query.where(
            Transaction.id.in_(
                select(Allocation.transaction_id).where(
                    Allocation.category_id == category_id
                )
            )
        )

    all_rows = list(db.scalars(query.order_by(Transaction.value_date.desc(),
                                             Transaction.id.desc())))
    total = len(all_rows)
    page = all_rows[offset: offset + limit]

    items = []
    for txn in page:
        suggestion = None
        if any(
            db.get(Fund, a.fund_id).kind == FundKind.unassigned.value
            for a in txn.allocations
        ):
            suggestion = rules.classify(
                db,
                rules.Candidate(
                    description_norm=txn.description_norm,
                    direction=txn.direction,
                    amount=txn.amount,
                    vpa=txn.vpa,
                    raw=txn.description_raw,
                ),
            ).as_dict()
        items.append(serialise_transaction(db, txn, suggestion))

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "sum_credit": sum(t.amount for t in all_rows if t.direction == "credit"),
        "sum_debit": sum(t.amount for t in all_rows if t.direction == "debit"),
    }


@router.get("/transactions/{transaction_id}")
def get_transaction(transaction_id: int, db: Session = Depends(get_db)):
    txn = db.get(Transaction, transaction_id)
    if txn is None:
        raise HTTPException(404, "No such transaction")
    return serialise_transaction(db, txn)


# --------------------------------------------------------------------------
# writing
# --------------------------------------------------------------------------

@router.post("/transactions", status_code=201)
def create_transaction(
    body: TransactionIn,
    db: Session = Depends(get_db),
    owner_id: int = Depends(require_owner),
):
    try:
        txn = ledger.record_transaction(
            db,
            account_id=body.account_id,
            value_date=body.value_date,
            direction=body.direction,
            amount=body.amount,
            kind=body.kind,
            description=body.description,
            external_ref=body.external_ref,
            notes=body.notes,
            splits=[ledger.Split(**s.model_dump()) for s in body.splits],
            actor_id=owner_id,
        )
    except ledger.LedgerError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.commit()
    return serialise_transaction(db, txn)


@router.patch("/transactions/{transaction_id}")
def recategorise(
    transaction_id: int,
    body: RecategoriseIn,
    db: Session = Depends(get_db),
    owner_id: int = Depends(require_owner),
):
    """Re-attribute a transaction. The cash plane is never touched here."""
    txn = db.get(Transaction, transaction_id)
    if txn is None:
        raise HTTPException(404, "No such transaction")

    allocated = sum(s.amount for s in body.splits)
    if allocated > txn.amount:
        raise HTTPException(
            400,
            f"Splits come to {allocated / 100:,.2f} but the transaction is "
            f"{txn.amount / 100:,.2f}. Reduce a split or add the rest.",
        )

    try:
        ledger.set_allocations(
            db, txn, [ledger.Split(**s.model_dump()) for s in body.splits],
            actor_id=owner_id,
        )
    except ledger.LedgerError as exc:
        raise HTTPException(400, str(exc)) from exc

    if body.kind:
        txn.kind = body.kind
    db.commit()
    return serialise_transaction(db, txn)


@router.post("/transactions/bulk-categorise")
def bulk_categorise(
    body: BulkCategoriseIn,
    db: Session = Depends(get_db),
    owner_id: int = Depends(require_owner),
):
    """Assign many rows at once -- the whole point of the review screen."""
    updated = 0
    for transaction_id in body.transaction_ids:
        txn = db.get(Transaction, transaction_id)
        if txn is None:
            continue
        ledger.set_allocations(
            db, txn,
            [ledger.Split(
                fund_id=body.fund_id,
                amount=txn.amount,
                category_id=body.category_id,
            )],
            actor_id=owner_id,
        )
        if body.kind:
            txn.kind = body.kind
        updated += 1
    db.commit()
    return {"updated": updated}


@router.post("/transactions/{transaction_id}/void")
def void(
    transaction_id: int,
    reason: str = "",
    db: Session = Depends(get_db),
    owner_id: int = Depends(require_owner),
):
    txn = db.get(Transaction, transaction_id)
    if txn is None:
        raise HTTPException(404, "No such transaction")
    try:
        ledger.void_transaction(db, txn, actor_id=owner_id, reason=reason)
    except ledger.LedgerError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.commit()
    return serialise_transaction(db, txn)


# --------------------------------------------------------------------------
# fund transfers -- the attribution plane only
# --------------------------------------------------------------------------

@router.post("/fund-transfers", status_code=201)
def create_fund_transfer(
    body: FundTransferIn,
    db: Session = Depends(get_db),
    owner_id: int = Depends(require_owner),
):
    try:
        transfer = ledger.create_fund_transfer(
            db,
            from_fund_id=body.from_fund_id,
            to_fund_id=body.to_fund_id,
            amount=body.amount,
            on=body.date,
            reason=body.reason,
            note=body.note,
            actor_id=owner_id,
        )
    except ledger.LedgerError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.commit()
    return {
        "id": transfer.id,
        "amount": transfer.amount,
        "date": transfer.date,
        "reason": transfer.reason,
        "message": "Moved between funds. No bank transaction was created.",
    }


@router.get("/fund-transfers")
def list_fund_transfers(db: Session = Depends(get_db)):
    from ...models import FundTransfer

    out = []
    for transfer in db.scalars(select(FundTransfer).order_by(FundTransfer.date.desc())):
        source = db.get(Fund, transfer.from_fund_id)
        target = db.get(Fund, transfer.to_fund_id)
        out.append({
            "id": transfer.id,
            "date": transfer.date,
            "amount": transfer.amount,
            "reason": transfer.reason,
            "note": transfer.note,
            "from_fund": source.name if source else "?",
            "to_fund": target.name if target else "?",
        })
    return out


# --------------------------------------------------------------------------
# rules
# --------------------------------------------------------------------------

@router.get("/rules", response_model=list[RuleOut])
def list_rules(db: Session = Depends(get_db)):
    return list(db.scalars(select(Rule).order_by(Rule.priority, Rule.id)))


@router.post("/rules", response_model=RuleOut, status_code=201)
def create_rule(body: RuleIn, db: Session = Depends(get_db)):
    if not body.conditions:
        raise HTTPException(400, "A rule needs at least one condition")
    rule = Rule(**body.model_dump())
    db.add(rule)
    db.commit()
    return rule


@router.patch("/rules/{rule_id}", response_model=RuleOut)
def update_rule(rule_id: int, body: RuleIn, db: Session = Depends(get_db)):
    rule = db.get(Rule, rule_id)
    if rule is None:
        raise HTTPException(404, "No such rule")
    for key, value in body.model_dump().items():
        setattr(rule, key, value)
    db.commit()
    return rule


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.get(Rule, rule_id)
    if rule is None:
        raise HTTPException(404, "No such rule")
    db.delete(rule)
    db.commit()
    return {"ok": True}


@router.get("/rules/{rule_id}/matches")
def rule_matches(rule_id: int, db: Session = Depends(get_db)):
    """'This matches 23 past transactions -- apply to those too?'"""
    rule = db.get(Rule, rule_id)
    if rule is None:
        raise HTTPException(404, "No such rule")
    matches = rules.matching_transactions(db, rule)
    return {
        "count": len(matches),
        "transactions": [serialise_transaction(db, t) for t in matches[:50]],
    }


@router.post("/rules/{rule_id}/apply-retroactive")
def apply_retroactive(
    rule_id: int,
    db: Session = Depends(get_db),
    owner_id: int = Depends(require_owner),
):
    rule = db.get(Rule, rule_id)
    if rule is None:
        raise HTTPException(404, "No such rule")

    actions = rule.actions or {}
    fund_id = actions.get("fund_id")
    if not fund_id:
        raise HTTPException(400, "This rule does not set a fund, so it cannot be applied")

    applied = 0
    for txn in rules.matching_transactions(db, rule):
        ledger.set_allocations(
            db, txn,
            [ledger.Split(
                fund_id=int(fund_id),
                amount=txn.amount,
                category_id=actions.get("category_id"),
                vendor_id=actions.get("vendor_id"),
                confidence=1.0,
                applied_by="rule",
                rule_id=rule.id,
                reason=f"Rule “{rule.name}” applied to past transactions",
            )],
            actor_id=owner_id,
        )
        if actions.get("kind"):
            txn.kind = actions["kind"]
        applied += 1

    db.commit()
    return {"applied": applied}
