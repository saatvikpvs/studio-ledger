from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...core.security import require_owner
from ...models import Fund, FundKind, SavingsGoal, TransferReason
from ...services import ledger

router = APIRouter(prefix="/savings", tags=["savings"],
                   dependencies=[Depends(require_owner)])


class GoalIn(BaseModel):
    name: str
    target_amount: int = 0
    target_date: date | None = None
    note: str | None = None


class ContributionIn(BaseModel):
    goal_id: int
    amount: int = Field(gt=0)
    date: date
    from_fund_id: int | None = None
    note: str | None = None


class WithdrawalIn(BaseModel):
    goal_id: int
    amount: int = Field(gt=0)
    date: date
    to_fund_id: int | None = None
    note: str | None = None


def _goal_dict(db: Session, goal: SavingsGoal, as_of: date | None = None) -> dict:
    balance = ledger.fund_balance(db, goal.fund_id, as_of)
    return {
        "id": goal.id,
        "fund_id": goal.fund_id,
        "name": goal.name,
        "balance": balance,
        "target_amount": goal.target_amount,
        "target_date": goal.target_date,
        "note": goal.note,
        "percent": round(balance / goal.target_amount * 100, 1)
        if goal.target_amount else 0.0,
        "remaining": max(goal.target_amount - balance, 0),
        "is_archived": goal.is_archived,
    }


@router.get("/goals")
def list_goals(include_archived: bool = False, db: Session = Depends(get_db)):
    q = select(SavingsGoal).order_by(SavingsGoal.sort_order, SavingsGoal.id)
    if not include_archived:
        q = q.where(SavingsGoal.is_archived.is_(False))
    return [_goal_dict(db, goal) for goal in db.scalars(q)]


@router.post("/goals", status_code=201)
def create_goal(body: GoalIn, db: Session = Depends(get_db)):
    existing = db.scalar(select(SavingsGoal).where(SavingsGoal.name == body.name))
    if existing:
        raise HTTPException(409, f"You already have a goal called “{body.name}”")

    # The goal owns a fund, exactly as a project does.
    fund = Fund(kind=FundKind.savings.value, name=body.name)
    db.add(fund)
    db.flush()

    goal = SavingsGoal(
        name=body.name,
        fund_id=fund.id,
        target_amount=body.target_amount,
        target_date=body.target_date,
        note=body.note,
    )
    db.add(goal)
    db.commit()
    return _goal_dict(db, goal)


@router.patch("/goals/{goal_id}")
def update_goal(goal_id: int, body: GoalIn, db: Session = Depends(get_db)):
    goal = db.get(SavingsGoal, goal_id)
    if goal is None:
        raise HTTPException(404, "No such goal")

    goal.name = body.name
    goal.target_amount = body.target_amount
    goal.target_date = body.target_date
    goal.note = body.note

    fund = db.get(Fund, goal.fund_id)
    if fund:
        fund.name = body.name
    db.commit()
    return _goal_dict(db, goal)


@router.delete("/goals/{goal_id}")
def archive_goal(goal_id: int, db: Session = Depends(get_db)):
    """Goals are archived, never deleted — money really moved through them."""
    goal = db.get(SavingsGoal, goal_id)
    if goal is None:
        raise HTTPException(404, "No such goal")
    goal.is_archived = True
    db.commit()
    return {"ok": True, "message": f"{goal.name} archived. Its history is intact."}


@router.post("/contribute", status_code=201)
def contribute(
    body: ContributionIn,
    db: Session = Depends(get_db),
    owner_id: int = Depends(require_owner),
):
    """Move money into a savings goal.

    This is a fund transfer, not a bank transaction: the money is already in the
    account, you are simply setting it aside. Recording it as a transaction
    would invent cash that never moved.
    """
    goal = db.get(SavingsGoal, body.goal_id)
    if goal is None:
        raise HTTPException(404, "No such goal")

    source = body.from_fund_id or ledger.personal_fund(db).id
    try:
        ledger.create_fund_transfer(
            db,
            from_fund_id=source,
            to_fund_id=goal.fund_id,
            amount=body.amount,
            on=body.date,
            reason=TransferReason.savings_contribution.value,
            note=body.note,
            actor_id=owner_id,
        )
    except ledger.LedgerError as exc:
        raise HTTPException(400, str(exc)) from exc

    db.commit()
    return {
        "goal": _goal_dict(db, goal),
        "message": f"Set aside for {goal.name}. No bank transaction was created.",
    }


@router.post("/withdraw", status_code=201)
def withdraw(
    body: WithdrawalIn,
    db: Session = Depends(get_db),
    owner_id: int = Depends(require_owner),
):
    goal = db.get(SavingsGoal, body.goal_id)
    if goal is None:
        raise HTTPException(404, "No such goal")

    target = body.to_fund_id or ledger.personal_fund(db).id
    try:
        ledger.create_fund_transfer(
            db,
            from_fund_id=goal.fund_id,
            to_fund_id=target,
            amount=body.amount,
            on=body.date,
            reason=TransferReason.savings_withdrawal.value,
            note=body.note,
            actor_id=owner_id,
        )
    except ledger.LedgerError as exc:
        raise HTTPException(400, str(exc)) from exc

    db.commit()
    return {"goal": _goal_dict(db, goal), "message": f"Taken back out of {goal.name}."}
