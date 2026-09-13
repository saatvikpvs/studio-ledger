from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...core.security import require_owner
from ...models import (
    Account,
    Category,
    Client,
    Direction,
    Fund,
    Project,
    Transaction,
    TxnKind,
    TxnStatus,
    Vendor,
)
from ...schemas import (
    AccountIn,
    AccountOut,
    CategoryIn,
    CategoryOut,
    ClientIn,
    ClientOut,
    FundOut,
    VendorIn,
    VendorOut,
)
from ...services import ledger

router = APIRouter(tags=["reference"], dependencies=[Depends(require_owner)])


# --------------------------------------------------------------------------
# accounts
# --------------------------------------------------------------------------

@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(db: Session = Depends(get_db)):
    out = []
    for account in db.scalars(select(Account).where(Account.is_archived.is_(False))):
        data = AccountOut.model_validate(account)
        data.balance = ledger.account_balance(db, account.id)
        out.append(data)
    return out


@router.post("/accounts", response_model=AccountOut, status_code=201)
def create_account(body: AccountIn, db: Session = Depends(get_db)):
    account = Account(**body.model_dump())
    db.add(account)
    db.flush()

    # The opening balance becomes a real transaction, attributed to Personal.
    # Money with no attribution would break sum(funds) == sum(accounts).
    if body.opening_balance:
        ledger.record_transaction(
            db,
            account_id=account.id,
            value_date=body.opening_date,
            direction="credit" if body.opening_balance > 0 else "debit",
            amount=abs(body.opening_balance),
            kind=TxnKind.opening_balance.value,
            description=f"Opening balance — {account.name}",
            splits=[ledger.Split(
                fund_id=ledger.personal_fund(db).id,
                amount=abs(body.opening_balance),
                reason="Opening balance",
            )],
        )
    db.commit()
    data = AccountOut.model_validate(account)
    data.balance = ledger.account_balance(db, account.id)
    return data


# --------------------------------------------------------------------------
# clients
# --------------------------------------------------------------------------

@router.get("/clients", response_model=list[ClientOut])
def list_clients(db: Session = Depends(get_db)):
    out = []
    for client in db.scalars(select(Client).order_by(Client.name)):
        data = ClientOut.model_validate(client)
        data.project_count = len(client.projects)
        data.total_received = _client_received(db, client)
        out.append(data)
    return out


def _client_received(db: Session, client: Client) -> int:
    total = 0
    for project in client.projects:
        fund = db.scalar(select(Fund).where(Fund.project_id == project.id))
        if fund is None:
            continue
        rows = db.execute(
            select(Transaction)
            .join(Transaction.allocations)
            .where(
                Transaction.kind == TxnKind.client_payment.value,
                Transaction.direction == Direction.credit.value,
                Transaction.status == TxnStatus.posted.value,
            )
        )
        for (txn,) in rows:
            total += sum(a.amount for a in txn.allocations if a.fund_id == fund.id)
    return total


@router.post("/clients", response_model=ClientOut, status_code=201)
def create_client(body: ClientIn, db: Session = Depends(get_db)):
    client = Client(**body.model_dump())
    db.add(client)
    db.commit()
    return ClientOut.model_validate(client)


@router.patch("/clients/{client_id}", response_model=ClientOut)
def update_client(client_id: int, body: ClientIn, db: Session = Depends(get_db)):
    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(404, "No such client")
    for key, value in body.model_dump().items():
        setattr(client, key, value)
    db.commit()
    return ClientOut.model_validate(client)


# --------------------------------------------------------------------------
# vendors
# --------------------------------------------------------------------------

@router.get("/vendors", response_model=list[VendorOut])
def list_vendors(db: Session = Depends(get_db)):
    return list(db.scalars(select(Vendor).order_by(Vendor.name)))


@router.post("/vendors", response_model=VendorOut, status_code=201)
def create_vendor(body: VendorIn, db: Session = Depends(get_db)):
    vendor = Vendor(**body.model_dump())
    db.add(vendor)
    db.commit()
    return vendor


@router.patch("/vendors/{vendor_id}", response_model=VendorOut)
def update_vendor(vendor_id: int, body: VendorIn, db: Session = Depends(get_db)):
    vendor = db.get(Vendor, vendor_id)
    if vendor is None:
        raise HTTPException(404, "No such vendor")
    for key, value in body.model_dump().items():
        setattr(vendor, key, value)
    db.commit()
    return vendor


# --------------------------------------------------------------------------
# categories & funds
# --------------------------------------------------------------------------

@router.get("/categories", response_model=list[CategoryOut])
def list_categories(scope: str | None = None, db: Session = Depends(get_db)):
    q = select(Category).order_by(Category.sort_order, Category.name)
    if scope:
        q = q.where(Category.scope.in_([scope, "both"]))
    return list(db.scalars(q))


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryIn, db: Session = Depends(get_db)):
    existing = db.scalar(
        select(Category).where(Category.name == body.name, Category.scope == body.scope)
    )
    if existing:
        raise HTTPException(409, f"“{body.name}” already exists in that scope")
    category = Category(**body.model_dump())
    db.add(category)
    db.commit()
    return category


@router.get("/funds", response_model=list[FundOut])
def list_funds(db: Session = Depends(get_db)):
    out = []
    for fund in db.scalars(select(Fund)):
        data = FundOut.model_validate(fund)
        data.balance = ledger.fund_balance(db, fund.id)
        out.append(data)
    return sorted(out, key=lambda f: (f.kind != "project", f.name))


@router.get("/funds/{fund_id}/ledger")
def fund_ledger(fund_id: int, db: Session = Depends(get_db)):
    """The 'prove it' view behind every dashboard number."""
    from ._serial import serialise_transaction

    fund = db.get(Fund, fund_id)
    if fund is None:
        raise HTTPException(404, "No such fund")

    rows = db.execute(
        select(Transaction)
        .join(Transaction.allocations)
        .where(Transaction.status == TxnStatus.posted.value)
        .order_by(Transaction.value_date.desc())
    ).unique()

    entries = []
    for (txn,) in rows:
        share = sum(a.amount for a in txn.allocations if a.fund_id == fund_id)
        if share:
            entries.append(
                {**serialise_transaction(db, txn), "fund_share": share}
            )

    return {
        "fund": FundOut.model_validate(fund).model_dump()
        | {"balance": ledger.fund_balance(db, fund_id)},
        "entries": entries,
    }
