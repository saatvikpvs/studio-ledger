from __future__ import annotations

from sqlalchemy.orm import Session

from ...models import Account, Category, Fund, FundKind, Transaction


def serialise_transaction(db: Session, txn: Transaction, suggestion: dict | None = None) -> dict:
    account = db.get(Account, txn.account_id)
    allocations = []
    needs_review = False

    for alloc in txn.allocations:
        fund = db.get(Fund, alloc.fund_id)
        category = db.get(Category, alloc.category_id) if alloc.category_id else None
        if fund and fund.kind == FundKind.unassigned.value:
            needs_review = True
        allocations.append(
            {
                "id": alloc.id,
                "fund_id": alloc.fund_id,
                "fund_name": fund.name if fund else "?",
                "fund_kind": fund.kind if fund else "unassigned",
                "category_id": alloc.category_id,
                "category_name": category.name if category else None,
                "amount": alloc.amount,
                "confidence": alloc.confidence,
                "applied_by": alloc.applied_by,
                "reason": alloc.reason,
            }
        )

    return {
        "id": txn.id,
        "account_id": txn.account_id,
        "account_name": account.name if account else "?",
        "value_date": txn.value_date,
        "direction": txn.direction,
        "amount": txn.amount,
        "signed_amount": txn.signed_amount,
        "kind": txn.kind,
        "description_raw": txn.description_raw,
        "description_norm": txn.description_norm,
        "counterparty": txn.counterparty,
        "external_ref": txn.external_ref,
        "source": txn.source,
        "status": txn.status,
        "needs_review": needs_review,
        "allocations": allocations,
        "suggestion": suggestion,
    }
