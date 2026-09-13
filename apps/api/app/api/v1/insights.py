from __future__ import annotations

import csv
import io
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...core.money import to_rupees
from ...core.security import require_owner
from ...models import (
    Account,
    Allocation,
    Category,
    Client,
    Direction,
    Fund,
    FundKind,
    Project,
    Reconciliation,
    Transaction,
    TxnKind,
    TxnStatus,
)
from ...schemas import ReconciliationIn
from ...services import analytics, ledger

router = APIRouter(tags=["insights"], dependencies=[Depends(require_owner)])


# --------------------------------------------------------------------------
# dashboard & charts
# --------------------------------------------------------------------------

@router.get("/dashboard/summary")
def dashboard(as_of: date | None = None, db: Session = Depends(get_db)):
    return analytics.dashboard_summary(db, as_of)


@router.get("/charts/monthly-flows")
def monthly_flows(months: int = 12, db: Session = Depends(get_db)):
    return analytics.monthly_flows(db, months)


@router.get("/charts/balance-trend")
def balance_trend(days: int = 120, db: Session = Depends(get_db)):
    return analytics.balance_trend(db, days)


@router.get("/charts/category-breakdown")
def category_breakdown(
    scope: str = Query(default="project", pattern="^(project|personal)$"),
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
):
    return analytics.category_breakdown(db, scope=scope, since=date_from, until=date_to)


@router.get("/charts/client-payments")
def client_payments(project_id: int | None = None, db: Session = Depends(get_db)):
    return analytics.client_payment_timeline(db, project_id)


@router.get("/personal/summary")
def personal_summary(db: Session = Depends(get_db)):
    fund = ledger.personal_fund(db)
    today = date.today()
    month_start = today.replace(day=1)
    fy_start, fy_end = analytics.fiscal_year_bounds(today)

    return {
        "fund_id": fund.id,
        "balance": ledger.fund_balance(db, fund.id),
        "spent_this_month": analytics._fund_spend(db, fund.id, month_start, today),
        "spent_this_fy": analytics._fund_spend(db, fund.id, fy_start, today),
        "fiscal_year": {"start": fy_start.isoformat(), "end": fy_end.isoformat()},
        "breakdown": analytics.category_breakdown(db, scope="personal"),
        "monthly": analytics.monthly_flows(db, 12),
    }


# --------------------------------------------------------------------------
# integrity
# --------------------------------------------------------------------------

@router.get("/health/integrity")
def integrity(db: Session = Depends(get_db)):
    """If this ever fails, something wrote outside the ledger service."""
    return ledger.integrity_check(db)


# --------------------------------------------------------------------------
# reconciliation
# --------------------------------------------------------------------------

@router.get("/reconciliations")
def list_reconciliations(db: Session = Depends(get_db)):
    out = []
    for rec in db.scalars(select(Reconciliation).order_by(Reconciliation.id.desc())):
        account = db.get(Account, rec.account_id)
        out.append({
            "id": rec.id,
            "account_id": rec.account_id,
            "account_name": account.name if account else "?",
            "period_start": rec.period_start,
            "period_end": rec.period_end,
            "statement_closing_balance": rec.statement_closing_balance,
            "calculated_balance": rec.calculated_balance,
            "difference": rec.difference,
            "status": rec.status,
        })
    return out


@router.post("/reconciliations", status_code=201)
def start_reconciliation(body: ReconciliationIn, db: Session = Depends(get_db)):
    account = db.get(Account, body.account_id)
    if account is None:
        raise HTTPException(404, "No such account")

    calculated = ledger.account_balance(db, body.account_id, body.period_end)
    difference = body.statement_closing_balance - calculated

    rec = Reconciliation(
        account_id=body.account_id,
        period_start=body.period_start,
        period_end=body.period_end,
        statement_closing_balance=body.statement_closing_balance,
        calculated_balance=calculated,
        difference=difference,
    )
    db.add(rec)
    db.commit()

    return {
        "id": rec.id,
        "calculated_balance": calculated,
        "statement_closing_balance": body.statement_closing_balance,
        "difference": difference,
        "balanced": difference == 0,
        "suspects": _reconciliation_suspects(db, body, difference),
    }


def _reconciliation_suspects(db: Session, body: ReconciliationIn, difference: int) -> list[dict]:
    """Don't just show a number -- show what probably caused it."""
    if difference == 0:
        return []

    suspects: list[dict] = []
    target = abs(difference)

    exact = db.scalars(
        select(Transaction).where(
            Transaction.account_id == body.account_id,
            Transaction.amount == target,
            Transaction.value_date >= body.period_start,
            Transaction.value_date <= body.period_end,
        )
    ).all()
    for txn in exact:
        suspects.append({
            "kind": "exact_match",
            "message": f"A transaction of exactly this amount exists on "
                       f"{txn.value_date.isoformat()} — check it is not duplicated "
                       f"or the wrong sign.",
            "transaction_id": txn.id,
        })

    cash_accounts = db.scalars(select(Account).where(Account.type == "cash")).all()
    if not cash_accounts:
        suspects.append({
            "kind": "no_cash_account",
            "message": "You have no Cash account. Money withdrawn from the bank and "
                       "spent in cash is a common cause of a gap like this.",
        })

    edges = db.scalars(
        select(Transaction).where(
            Transaction.account_id == body.account_id,
            Transaction.value_date.in_([body.period_start, body.period_end]),
        )
    ).all()
    if edges:
        suspects.append({
            "kind": "period_edge",
            "message": f"{len(edges)} transactions sit exactly on the period boundary. "
                       "Value date and posting date can straddle a month end.",
        })

    suspects.append({
        "kind": "missing_rows",
        "message": "Import the statement for this period if you have not — "
                   "unimported rows are the most common cause.",
    })
    return suspects


@router.post("/reconciliations/{rec_id}/close")
def close_reconciliation(rec_id: int, db: Session = Depends(get_db)):
    rec = db.get(Reconciliation, rec_id)
    if rec is None:
        raise HTTPException(404, "No such reconciliation")

    calculated = ledger.account_balance(db, rec.account_id, rec.period_end)
    if calculated != rec.statement_closing_balance:
        raise HTTPException(
            400,
            f"Still out by {to_rupees(rec.statement_closing_balance - calculated)}. "
            "Resolve the difference before closing the period.",
        )

    rec.status = "closed"
    rec.calculated_balance = calculated
    rec.difference = 0
    rec.closed_at = datetime.utcnow()

    account = db.get(Account, rec.account_id)
    account.reconciled_through = rec.period_end
    db.commit()
    return {
        "ok": True,
        "message": f"{account.name} locked through {rec.period_end.isoformat()}.",
    }


@router.post("/reconciliations/{rec_id}/reopen")
def reopen_reconciliation(rec_id: int, db: Session = Depends(get_db)):
    rec = db.get(Reconciliation, rec_id)
    if rec is None:
        raise HTTPException(404, "No such reconciliation")
    rec.status = "open"
    account = db.get(Account, rec.account_id)
    account.reconciled_through = None
    db.commit()
    return {"ok": True, "message": f"{account.name} unlocked. This is in the audit log."}


# --------------------------------------------------------------------------
# reports
# --------------------------------------------------------------------------

REPORTS = {
    "project_expenses": "Project expense statement",
    "project_summary": "Project financial summary",
    "client_payments": "Client payment ledger",
    "personal_expenses": "Personal expense report",
    "monthly_statement": "Monthly financial statement",
    "category_analysis": "Category analysis",
    "vendor_report": "Vendor report",
    "fund_statement": "Fund statement",
}


@router.get("/reports")
def list_reports():
    return [{"key": k, "title": v} for k, v in REPORTS.items()]


@router.get("/reports/{report_key}")
def run_report(
    report_key: str,
    db: Session = Depends(get_db),
    date_from: date | None = None,
    date_to: date | None = None,
    project_id: int | None = None,
    client_id: int | None = None,
    category_id: int | None = None,
    fund_id: int | None = None,
):
    if report_key not in REPORTS:
        raise HTTPException(404, f"No report called “{report_key}”")

    builder = {
        "project_expenses": _report_project_expenses,
        "project_summary": _report_project_summary,
        "client_payments": _report_client_payments,
        "personal_expenses": _report_personal_expenses,
        "monthly_statement": _report_monthly,
        "category_analysis": _report_category,
        "vendor_report": _report_vendor,
        "fund_statement": _report_fund_statement,
    }[report_key]

    columns, rows, totals = builder(
        db, date_from, date_to, project_id, client_id, category_id, fund_id
    )
    return {
        "key": report_key,
        "title": REPORTS[report_key],
        "generated_at": datetime.utcnow().isoformat(),
        "filters": {
            "date_from": date_from, "date_to": date_to, "project_id": project_id,
            "client_id": client_id, "category_id": category_id, "fund_id": fund_id,
        },
        "columns": columns,
        "rows": rows,
        "totals": totals,
    }


@router.get("/reports/{report_key}/export")
def export_report(
    report_key: str,
    format: str = Query(default="csv", pattern="^(csv|xlsx)$"),
    db: Session = Depends(get_db),
    date_from: date | None = None,
    date_to: date | None = None,
    project_id: int | None = None,
    client_id: int | None = None,
    category_id: int | None = None,
    fund_id: int | None = None,
):
    report = run_report(report_key, db, date_from, date_to, project_id,
                        client_id, category_id, fund_id)
    columns = report["columns"]
    stamp = date.today().isoformat()
    filename = f"{report_key}-{stamp}.{format}"

    if format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow([c["label"] for c in columns])
        for row in report["rows"]:
            writer.writerow([_cell_value(row, c) for c in columns])
        return Response(
            buffer.getvalue().encode("utf-8-sig"),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return _xlsx_response(report, columns, filename)


def _xlsx_response(report: dict, columns: list[dict], filename: str) -> Response:
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError as exc:  # pragma: no cover
        raise HTTPException(500, "openpyxl is not installed") from exc

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = report["key"][:31]

    sheet.append([report["title"]])
    sheet["A1"].font = Font(size=14, bold=True)
    sheet.append([f"Generated {report['generated_at'][:10]}"])
    sheet.append([])

    header_row = 4
    sheet.append([c["label"] for c in columns])
    for index in range(1, len(columns) + 1):
        cell = sheet.cell(row=header_row, column=index)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1D5478")
        cell.alignment = Alignment(horizontal="center")

    for row in report["rows"]:
        sheet.append([_cell_value(row, c, numeric=True) for c in columns])

    for index, column in enumerate(columns, start=1):
        letter = get_column_letter(index)
        sheet.column_dimensions[letter].width = max(14, len(column["label"]) + 4)
        if column.get("type") == "money":
            for row_index in range(header_row + 1, sheet.max_row + 1):
                sheet.cell(row=row_index, column=index).number_format = '#,##0.00'

    sheet.freeze_panes = sheet.cell(row=header_row + 1, column=1)

    buffer = io.BytesIO()
    workbook.save(buffer)
    return Response(
        buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _cell_value(row: dict, column: dict, numeric: bool = False):
    value = row.get(column["key"])
    if column.get("type") == "money" and isinstance(value, int):
        rupees = to_rupees(value)
        return float(rupees) if numeric else str(rupees)
    return value


# --------------------------------------------------------------------------
# report builders
# --------------------------------------------------------------------------

MONEY = "money"


def _txn_rows(db: Session, *, fund_ids: list[int] | None, date_from, date_to,
              category_id=None, direction=None):
    q = select(Allocation, Transaction).join(
        Transaction, Allocation.transaction_id == Transaction.id
    ).where(Transaction.status == TxnStatus.posted.value)

    if fund_ids is not None:
        q = q.where(Allocation.fund_id.in_(fund_ids))
    if date_from:
        q = q.where(Transaction.value_date >= date_from)
    if date_to:
        q = q.where(Transaction.value_date <= date_to)
    if category_id:
        q = q.where(Allocation.category_id == category_id)
    if direction:
        q = q.where(Transaction.direction == direction)

    return list(db.execute(q.order_by(Transaction.value_date)))


def _report_project_expenses(db, date_from, date_to, project_id, client_id,
                             category_id, fund_id):
    columns = [
        {"key": "date", "label": "Date"},
        {"key": "project", "label": "Project"},
        {"key": "category", "label": "Category"},
        {"key": "description", "label": "Description"},
        {"key": "reference", "label": "Reference"},
        {"key": "amount", "label": "Amount", "type": MONEY},
    ]

    if project_id:
        project = db.get(Project, project_id)
        fund_ids = [ledger.fund_for_project(db, project.id, project.name).id]
    else:
        fund_ids = [f.id for f in db.scalars(
            select(Fund).where(Fund.kind == FundKind.project.value))]

    rows = []
    total = 0
    for alloc, txn in _txn_rows(db, fund_ids=fund_ids, date_from=date_from,
                                date_to=date_to, category_id=category_id,
                                direction=Direction.debit.value):
        fund = db.get(Fund, alloc.fund_id)
        project = db.get(Project, fund.project_id) if fund and fund.project_id else None
        category = db.get(Category, alloc.category_id) if alloc.category_id else None
        rows.append({
            "date": txn.value_date.isoformat(),
            "project": project.name if project else "",
            "category": category.name if category else "Uncategorised",
            "description": txn.description_raw or txn.description_norm,
            "reference": txn.external_ref or "",
            "amount": alloc.amount,
        })
        total += alloc.amount

    return columns, rows, {"amount": total, "count": len(rows)}


def _report_project_summary(db, date_from, date_to, project_id, client_id,
                            category_id, fund_id):
    columns = [
        {"key": "name", "label": "Project"},
        {"key": "client_name", "label": "Client"},
        {"key": "status", "label": "Status"},
        {"key": "received", "label": "Received", "type": MONEY},
        {"key": "spent", "label": "Spent", "type": MONEY},
        {"key": "in_hand", "label": "In hand", "type": MONEY},
        {"key": "budget", "label": "Budget", "type": MONEY},
        {"key": "headroom", "label": "Budget headroom", "type": MONEY},
        {"key": "receivable", "label": "Receivable", "type": MONEY},
        {"key": "fee_earned", "label": "Fee earned", "type": MONEY},
        {"key": "margin", "label": "Margin", "type": MONEY},
    ]

    q = select(Project).order_by(Project.name)
    if project_id:
        q = q.where(Project.id == project_id)
    if client_id:
        q = q.where(Project.client_id == client_id)

    rows = []
    totals = {k["key"]: 0 for k in columns if k.get("type") == MONEY}
    for project in db.scalars(q):
        summary = analytics.project_summary(db, project)
        row = {
            "name": summary.name, "client_name": summary.client_name,
            "status": summary.status, "received": summary.received,
            "spent": summary.spent, "in_hand": summary.in_hand,
            "budget": summary.budget, "headroom": summary.headroom,
            "receivable": summary.receivable, "fee_earned": summary.fee_earned,
            "margin": summary.margin,
        }
        rows.append(row)
        for key in totals:
            totals[key] += row[key]

    return columns, rows, totals


def _report_client_payments(db, date_from, date_to, project_id, client_id,
                            category_id, fund_id):
    columns = [
        {"key": "date", "label": "Date"},
        {"key": "client", "label": "Client"},
        {"key": "project", "label": "Project"},
        {"key": "reference", "label": "Reference / UTR"},
        {"key": "description", "label": "Description"},
        {"key": "amount", "label": "Amount", "type": MONEY},
    ]

    rows = []
    total = 0
    q = select(Transaction).where(
        Transaction.kind == TxnKind.client_payment.value,
        Transaction.status == TxnStatus.posted.value,
    )
    if date_from:
        q = q.where(Transaction.value_date >= date_from)
    if date_to:
        q = q.where(Transaction.value_date <= date_to)

    for txn in db.scalars(q.order_by(Transaction.value_date)):
        for alloc in txn.allocations:
            fund = db.get(Fund, alloc.fund_id)
            if not fund or fund.project_id is None:
                continue
            project = db.get(Project, fund.project_id)
            if project_id and project.id != project_id:
                continue
            if client_id and project.client_id != client_id:
                continue
            rows.append({
                "date": txn.value_date.isoformat(),
                "client": project.client.name if project.client else "",
                "project": project.name,
                "reference": txn.external_ref or "",
                "description": txn.description_raw,
                "amount": alloc.amount,
            })
            total += alloc.amount

    return columns, rows, {"amount": total, "count": len(rows)}


def _report_personal_expenses(db, date_from, date_to, project_id, client_id,
                              category_id, fund_id):
    columns = [
        {"key": "date", "label": "Date"},
        {"key": "category", "label": "Category"},
        {"key": "description", "label": "Description"},
        {"key": "amount", "label": "Amount", "type": MONEY},
    ]

    fund = ledger.personal_fund(db)
    rows = []
    total = 0
    for alloc, txn in _txn_rows(db, fund_ids=[fund.id], date_from=date_from,
                                date_to=date_to, category_id=category_id,
                                direction=Direction.debit.value):
        category = db.get(Category, alloc.category_id) if alloc.category_id else None
        rows.append({
            "date": txn.value_date.isoformat(),
            "category": category.name if category else "Uncategorised",
            "description": txn.description_raw or txn.description_norm,
            "amount": alloc.amount,
        })
        total += alloc.amount

    return columns, rows, {"amount": total, "count": len(rows)}


def _report_monthly(db, date_from, date_to, project_id, client_id,
                    category_id, fund_id):
    columns = [
        {"key": "month", "label": "Month"},
        {"key": "cash_in", "label": "Cash in", "type": MONEY},
        {"key": "cash_out", "label": "Cash out", "type": MONEY},
        {"key": "net", "label": "Net", "type": MONEY},
    ]
    rows = analytics.monthly_flows(db, 12, date_to)
    totals = {
        "cash_in": sum(r["cash_in"] for r in rows),
        "cash_out": sum(r["cash_out"] for r in rows),
        "net": sum(r["net"] for r in rows),
    }
    return columns, rows, totals


def _report_category(db, date_from, date_to, project_id, client_id,
                     category_id, fund_id):
    columns = [
        {"key": "category", "label": "Category"},
        {"key": "count", "label": "Transactions"},
        {"key": "amount", "label": "Total", "type": MONEY},
    ]
    project_rows = analytics.category_breakdown(db, scope="project",
                                                since=date_from, until=date_to)
    personal_rows = analytics.category_breakdown(db, scope="personal",
                                                 since=date_from, until=date_to)
    merged: dict[str, dict] = {}
    for row in project_rows + personal_rows:
        entry = merged.setdefault(row["category"],
                                  {"category": row["category"], "count": 0, "amount": 0})
        entry["count"] += row["count"]
        entry["amount"] += row["amount"]
    rows = sorted(merged.values(), key=lambda r: r["amount"], reverse=True)
    return columns, rows, {"amount": sum(r["amount"] for r in rows),
                           "count": sum(r["count"] for r in rows)}


def _report_vendor(db, date_from, date_to, project_id, client_id,
                   category_id, fund_id):
    columns = [
        {"key": "vendor", "label": "Vendor"},
        {"key": "count", "label": "Payments"},
        {"key": "amount", "label": "Total paid", "type": MONEY},
    ]

    totals: dict[str, dict] = {}
    for alloc, txn in _txn_rows(db, fund_ids=None, date_from=date_from,
                                date_to=date_to, direction=Direction.debit.value):
        name = txn.counterparty or txn.description_norm or "Unknown"
        entry = totals.setdefault(name, {"vendor": name, "count": 0, "amount": 0})
        entry["count"] += 1
        entry["amount"] += alloc.amount

    rows = sorted(totals.values(), key=lambda r: r["amount"], reverse=True)
    return columns, rows, {"amount": sum(r["amount"] for r in rows),
                           "count": sum(r["count"] for r in rows)}


def _report_fund_statement(db, date_from, date_to, project_id, client_id,
                           category_id, fund_id):
    columns = [
        {"key": "date", "label": "Date"},
        {"key": "description", "label": "Description"},
        {"key": "kind", "label": "Kind"},
        {"key": "inflow", "label": "In", "type": MONEY},
        {"key": "outflow", "label": "Out", "type": MONEY},
        {"key": "balance", "label": "Fund balance", "type": MONEY},
    ]

    if not fund_id:
        fund_id = ledger.personal_fund(db).id

    running = 0
    rows = []
    for alloc, txn in _txn_rows(db, fund_ids=[fund_id], date_from=date_from,
                                date_to=date_to):
        inflow = alloc.amount if txn.direction == Direction.credit.value else 0
        outflow = alloc.amount if txn.direction == Direction.debit.value else 0
        running += inflow - outflow
        rows.append({
            "date": txn.value_date.isoformat(),
            "description": txn.description_raw or txn.description_norm,
            "kind": txn.kind.replace("_", " "),
            "inflow": inflow,
            "outflow": outflow,
            "balance": running,
        })

    return columns, rows, {
        "inflow": sum(r["inflow"] for r in rows),
        "outflow": sum(r["outflow"] for r in rows),
        "balance": running,
    }
