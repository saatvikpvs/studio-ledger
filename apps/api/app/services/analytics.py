"""Every figure the dashboard, the charts and the reports show.

These derivations live here and nowhere else. If a KPI is computed in a router
or in the browser, the same number exists twice and the two will eventually
disagree -- which in financial software is indistinguishable from a bug you
cannot see.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.money import Paise, format_inr
from ..models import (
    NEUTRAL_KINDS,
    SPEND_KINDS,
    Account,
    Allocation,
    Category,
    Client,
    FeeModel,
    Fund,
    FundKind,
    FundTransfer,
    Project,
    ProjectStatus,
    Direction,
    Transaction,
    TxnKind,
    TxnStatus,
)
from . import ledger


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _posted(q):
    return q.where(Transaction.status == TxnStatus.posted.value)


def _fund_rows(db: Session, fund_id: int, since: date | None = None,
               until: date | None = None):
    q = _posted(
        select(Allocation, Transaction)
        .join(Transaction, Allocation.transaction_id == Transaction.id)
        .where(Allocation.fund_id == fund_id)
    )
    if since:
        q = q.where(Transaction.value_date >= since)
    if until:
        q = q.where(Transaction.value_date <= until)
    return list(db.execute(q))


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def fiscal_year_bounds(on: date, start_month: int = settings.fiscal_year_start_month
                       ) -> tuple[date, date]:
    """Indian FY runs April to March. Hardcoding January is a recurring annoyance."""
    year = on.year if on.month >= start_month else on.year - 1
    start = date(year, start_month, 1)
    end = date(year + 1, start_month, 1) - timedelta(days=1)
    return start, end


# ---------------------------------------------------------------------------
# projects
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class ProjectSummary:
    project_id: int
    name: str
    client_name: str
    location: str | None
    project_type: str | None
    status: str

    received: Paise          # client money in
    spent: Paise             # money out against this project
    in_hand: Paise           # fund balance -- cash still available
    budget: Paise
    headroom: Paise          # budget - spent
    expected_total: Paise
    receivable: Paise        # expected - received

    fee_earned: Paise
    own_costs: Paise         # non-reimbursable spend the practice bears
    margin: Paise            # fee_earned - own_costs
    drawn: Paise             # fee already moved to Personal

    percent_of_received: float
    percent_of_budget: float
    alert: str | None        # None | "warning" | "critical"


def project_summary(db: Session, project: Project, as_of: date | None = None
                    ) -> ProjectSummary:
    fund = ledger.fund_for_project(db, project.id, project.name)
    rows = _fund_rows(db, fund.id, until=as_of)

    received = sum(
        a.amount for a, t in rows
        if t.direction == Direction.credit.value and t.kind == TxnKind.client_payment.value
    )
    refunded_out = sum(
        a.amount for a, t in rows
        if t.direction == Direction.debit.value and t.kind == TxnKind.refund_out.value
    )
    received -= refunded_out

    spent = sum(
        a.amount for a, t in rows
        if t.direction == Direction.debit.value and t.kind in {k.value for k in SPEND_KINDS}
    )
    # A vendor refund reduces project spend; it is not income.
    spent -= sum(
        a.amount for a, t in rows
        if t.direction == Direction.credit.value and t.kind == TxnKind.refund_in.value
    )

    own_costs = 0
    for alloc, txn in rows:
        if txn.direction != Direction.debit.value:
            continue
        if alloc.category_id is None:
            continue
        category = db.get(Category, alloc.category_id)
        if category and not category.reimbursable:
            own_costs += alloc.amount

    in_hand = ledger.fund_balance(db, fund.id, as_of)
    headroom = project.budget - spent
    receivable = max(project.expected_total - received, 0)

    if project.fee_model == FeeModel.percent_of_cost.value:
        fee_earned = int(round(spent * project.fee_percent / 100))
    elif project.fee_model == FeeModel.lump_sum.value:
        progress = min(1.0, spent / project.budget) if project.budget else 0.0
        fee_earned = int(round(project.fee_lump_sum * progress))
    else:
        fee_earned = 0

    drawn = ledger._transfer_sum(db, FundTransfer.from_fund_id, fund.id, as_of)

    pct_received = (spent / received * 100) if received else 0.0
    pct_budget = (spent / project.budget * 100) if project.budget else 0.0

    alert = None
    if in_hand < 0:
        alert = "critical"
    elif received and spent / received >= settings.project_warn_ratio:
        alert = "warning"
    elif project.budget and spent > project.budget:
        alert = "warning"

    return ProjectSummary(
        project_id=project.id,
        name=project.name,
        client_name=project.client.name if project.client else "",
        location=project.location,
        project_type=project.project_type,
        status=project.status,
        received=received,
        spent=spent,
        in_hand=in_hand,
        budget=project.budget,
        headroom=headroom,
        expected_total=project.expected_total,
        receivable=receivable,
        fee_earned=fee_earned,
        own_costs=own_costs,
        margin=fee_earned - own_costs,
        drawn=drawn,
        percent_of_received=round(pct_received, 1),
        percent_of_budget=round(pct_budget, 1),
        alert=alert,
    )


def project_breakdown(db: Session, project: Project) -> list[dict]:
    """Where the money went, by category. Powers the horizontal bar chart."""
    fund = ledger.fund_for_project(db, project.id, project.name)
    totals: dict[str, dict] = {}

    for alloc, txn in _fund_rows(db, fund.id):
        if txn.direction != Direction.debit.value:
            continue
        if txn.kind not in {k.value for k in SPEND_KINDS}:
            continue
        category = db.get(Category, alloc.category_id) if alloc.category_id else None
        name = category.name if category else "Uncategorised"
        entry = totals.setdefault(
            name, {"category": name, "colour": category.colour if category else "#94a3b8",
                   "amount": 0, "count": 0}
        )
        entry["amount"] += alloc.amount
        entry["count"] += 1

    return sorted(totals.values(), key=lambda r: r["amount"], reverse=True)


# ---------------------------------------------------------------------------
# dashboard
# ---------------------------------------------------------------------------

def dashboard_summary(db: Session, as_of: date | None = None) -> dict:
    today = as_of or date.today()
    month_start = today.replace(day=1)

    bank_balance = ledger.total_cash(db, today)
    unassigned = ledger.unassigned_fund(db)
    personal = ledger.personal_fund(db)

    projects = list(
        db.scalars(
            select(Project).where(
                Project.status.in_([ProjectStatus.active.value, ProjectStatus.on_hold.value])
            )
        )
    )
    summaries = [project_summary(db, p, today) for p in projects]

    client_money_held = sum(max(s.in_hand, 0) for s in summaries)
    total_received = sum(s.received for s in summaries)
    total_project_spend = sum(s.spent for s in summaries)

    personal_balance = ledger.fund_balance(db, personal.id, today)
    personal_spend_month = _fund_spend(db, personal.id, month_start, today)

    cash_in, cash_out, earned = _month_flows(db, month_start, today)

    review_count = db.scalar(
        select(Allocation.id).where(Allocation.fund_id == unassigned.id).limit(1)
    )
    review_total = len(
        db.scalars(select(Allocation.id).where(Allocation.fund_id == unassigned.id)).all()
    )

    alerts = []
    for s in summaries:
        if s.alert == "critical":
            alerts.append({
                "severity": "critical",
                "title": f"{s.name} is short",
                "detail": (
                    f"Spent {format_inr(s.spent)} against {format_inr(s.received)} "
                    "received. Effectively funded from another fund."
                ),
                "href": f"/projects/{s.project_id}",
            })
        elif s.alert == "warning":
            alerts.append({
                "severity": "warning",
                # floor(x + 0.5) matches JS Math.round, so the alert and the
                # project card never disagree on the same percentage.
                "title": (
                    f"{s.name} at {math.floor(s.percent_of_received + 0.5)}% of received"
                ),
                "detail": f"{format_inr(s.in_hand)} still in hand.",
                "href": f"/projects/{s.project_id}",
            })
    if review_total:
        alerts.append({
            "severity": "info",
            "title": f"{review_total} transactions need review",
            "detail": "Sitting in the Unassigned fund until you classify them.",
            "href": "/review",
        })

    for account in db.scalars(select(Account).where(Account.is_archived.is_(False))):
        if account.reconciled_through is None:
            continue
        stale = (today - account.reconciled_through).days
        if stale > 40:
            alerts.append({
                "severity": "warning",
                "title": f"{account.name} unreconciled for {stale} days",
                "detail": f"Last reconciled {account.reconciled_through.isoformat()}.",
                "href": "/settings/reconciliation",
            })

    return {
        "as_of": today.isoformat(),
        "bank_balance": bank_balance,
        "client_money_held": client_money_held,
        "personal_available": personal_balance,
        "unassigned": ledger.fund_balance(db, unassigned.id, today),
        "total_received": total_received,
        "project_spend": total_project_spend,
        "personal_spend_month": personal_spend_month,
        "cash_in_month": cash_in,
        "cash_out_month": cash_out,
        "net_cash_month": cash_in - cash_out,
        "earned_month": earned,
        "review_count": review_total,
        "projects": [asdict(s) for s in summaries],
        "alerts": alerts,
        "fund_allocation": fund_allocation(db, today),
    }


def _fund_spend(db: Session, fund_id: int, since: date, until: date) -> Paise:
    return sum(
        a.amount for a, t in _fund_rows(db, fund_id, since, until)
        if t.direction == Direction.debit.value
        and t.kind not in {k.value for k in NEUTRAL_KINDS}
    )


def _month_flows(db: Session, since: date, until: date) -> tuple[Paise, Paise, Paise]:
    """Cash in, cash out, and *earned* -- which are not the same thing.

    Cash in includes client advances, because they really are cash arriving.
    Earned excludes them, because they are money held, not money made. The gap
    between the two is itself useful: it is how much client money he is sitting on.
    """
    cash_in = cash_out = 0
    q = _posted(
        select(Transaction).where(
            Transaction.value_date >= since, Transaction.value_date <= until
        )
    )
    for txn in db.scalars(q):
        if txn.kind in {k.value for k in NEUTRAL_KINDS}:
            continue
        if txn.direction == Direction.credit.value:
            cash_in += txn.amount
        else:
            cash_out += txn.amount

    earned = 0
    for txn in db.scalars(q):
        if txn.direction == Direction.credit.value and txn.kind in {
            TxnKind.personal_income.value, TxnKind.interest.value
        }:
            earned += txn.amount

    for project in db.scalars(select(Project)):
        full = project_summary(db, project, until).fee_earned
        prior = project_summary(db, project, since - timedelta(days=1)).fee_earned
        earned += max(full - prior, 0)

    return cash_in, cash_out, earned


def fund_allocation(db: Session, as_of: date | None = None) -> list[dict]:
    """How today's bank balance divides across funds.

    One stacked bar of this is the clearest possible statement of the model.
    """
    out = []
    for fund in db.scalars(select(Fund)):
        balance = ledger.fund_balance(db, fund.id, as_of)
        if balance == 0 and fund.kind == FundKind.unassigned.value:
            continue
        out.append({
            "fund_id": fund.id,
            "name": fund.name,
            "kind": fund.kind,
            "balance": balance,
        })
    return sorted(out, key=lambda r: r["balance"], reverse=True)


# ---------------------------------------------------------------------------
# series
# ---------------------------------------------------------------------------

def monthly_flows(db: Session, months: int = 12, until: date | None = None) -> list[dict]:
    until = until or date.today()
    start = (until.replace(day=1) - timedelta(days=31 * (months - 1))).replace(day=1)

    buckets: dict[str, dict] = {}
    cursor = start
    while cursor <= until:
        buckets[month_key(cursor)] = {
            "month": month_key(cursor), "cash_in": 0, "cash_out": 0, "net": 0
        }
        cursor = (cursor.replace(day=28) + timedelta(days=8)).replace(day=1)

    q = _posted(
        select(Transaction).where(
            Transaction.value_date >= start, Transaction.value_date <= until
        )
    )
    for txn in db.scalars(q):
        if txn.kind in {k.value for k in NEUTRAL_KINDS}:
            continue
        bucket = buckets.get(month_key(txn.value_date))
        if bucket is None:
            continue
        if txn.direction == Direction.credit.value:
            bucket["cash_in"] += txn.amount
        else:
            bucket["cash_out"] += txn.amount

    for bucket in buckets.values():
        bucket["net"] = bucket["cash_in"] - bucket["cash_out"]
    return list(buckets.values())


def balance_trend(db: Session, days: int = 120, until: date | None = None) -> list[dict]:
    until = until or date.today()
    start = until - timedelta(days=days)

    running = 0
    per_day: dict[date, int] = defaultdict(int)

    for txn in db.scalars(_posted(select(Transaction))):
        if txn.value_date < start:
            running += txn.signed_amount
        else:
            per_day[txn.value_date] += txn.signed_amount

    out = []
    cursor = start
    while cursor <= until:
        running += per_day.get(cursor, 0)
        out.append({"date": cursor.isoformat(), "balance": running})
        cursor += timedelta(days=1)
    return out


def category_breakdown(db: Session, *, scope: str, since: date | None = None,
                       until: date | None = None) -> list[dict]:
    """``scope`` is 'project' or 'personal'."""
    if scope == "personal":
        fund_ids = [ledger.personal_fund(db).id]
    else:
        fund_ids = [f.id for f in db.scalars(
            select(Fund).where(Fund.kind == FundKind.project.value))]

    totals: dict[str, dict] = {}
    for fund_id in fund_ids:
        for alloc, txn in _fund_rows(db, fund_id, since, until):
            if txn.direction != Direction.debit.value:
                continue
            if txn.kind in {k.value for k in NEUTRAL_KINDS}:
                continue
            category = db.get(Category, alloc.category_id) if alloc.category_id else None
            name = category.name if category else "Uncategorised"
            entry = totals.setdefault(name, {
                "category": name,
                "colour": category.colour if category else "#94a3b8",
                "amount": 0,
                "count": 0,
            })
            entry["amount"] += alloc.amount
            entry["count"] += 1

    return sorted(totals.values(), key=lambda r: r["amount"], reverse=True)


def client_payment_timeline(db: Session, project_id: int | None = None) -> list[dict]:
    q = _posted(
        select(Transaction).where(Transaction.kind == TxnKind.client_payment.value)
    ).order_by(Transaction.value_date)

    out = []
    for txn in db.scalars(q):
        for alloc in txn.allocations:
            fund = db.get(Fund, alloc.fund_id)
            if fund is None or fund.project_id is None:
                continue
            if project_id and fund.project_id != project_id:
                continue
            project = db.get(Project, fund.project_id)
            out.append({
                "date": txn.value_date.isoformat(),
                "amount": alloc.amount,
                "project": project.name if project else "",
                "project_id": fund.project_id,
                "reference": txn.external_ref,
                "description": txn.description_raw,
            })
    return out
