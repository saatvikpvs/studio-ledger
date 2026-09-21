"""Create a real, empty ledger for the studio.

Not demo data. This lays out the structure — owner, accounts, categories, a
starting balance — and leaves the transactions to you.

The owner's real email and password are read from the environment, never
hardcoded here — this file is committed to git, and a real credential baked
into source is readable by anyone who can see the repo, forever, even after
it's changed (it stays in history). Set OWNER_EMAIL and OWNER_PASSWORD before
running this, or you'll get the obvious local-only placeholder below, which
is fine for a laptop but should never be the real login for a deployed copy.

    OWNER_EMAIL="you@example.com" OWNER_PASSWORD="something-long" \
        python -m app.setup_studio --reset --opening "0"
"""

from __future__ import annotations

import argparse
import os
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.db import Base, SessionLocal, engine
from .core.money import format_inr, to_paise
from .core.security import hash_password
from .models import Account, AccountType, Category, Owner, TxnKind
from .services import ledger

EMAIL = os.environ.get("OWNER_EMAIL", "kartikpvss@gmail.com")
PASSWORD = os.environ.get("OWNER_PASSWORD", "Kartikp1234")

# Personal categories — everyday life.
PERSONAL = [
    ("Food & dining", "#A24A32"), ("Groceries", "#8A6A2E"), ("Transport", "#2B4A7A"),
    ("Rent", "#4A3F52"), ("Bills & utilities", "#3A5A6B"), ("Shopping", "#7A4A5C"),
    ("Health", "#46695C"), ("Subscriptions", "#5A5A66"), ("Entertainment", "#8A5A3A"),
    ("Family", "#6B4A3A"), ("Education", "#3F5A46"), ("Personal — other", "#7A7A80"),
]

# Professional categories — running the studio and its projects.
PROFESSIONAL = [
    ("Materials", "#8A5A2E", True), ("Labour", "#46695C", True),
    ("Contractor", "#6B3A2E", True), ("Site expenses", "#5A6B3A", True),
    ("Travel — site", "#2B4A7A", True), ("Consultant", "#7A4A5C", False),
    ("Government fees", "#4A4A52", True), ("Printing & plotting", "#8A6A2E", False),
    ("Software & licences", "#4A3F6B", False), ("Studio rent", "#3A3A42", False),
    ("Equipment", "#3F5A6B", False), ("Furniture", "#7A5A3A", True),
    ("Electrical", "#8A7A2E", True), ("Plumbing", "#3A5A7A", True),
    ("Studio — other", "#7A7A80", False),
]

def reset_database() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def setup(db: Session, opening_balance: str = "0") -> dict:
    if db.scalar(select(Owner)):
        return {"skipped": "already set up"}

    db.add(Owner(
        email=EMAIL.lower(),
        password_hash=hash_password(PASSWORD),
        display_name="Kartik",
        practice_name="Spatial Anthology",
        fiscal_year_start_month=4,
    ))

    for order, (name, colour) in enumerate(PERSONAL):
        db.add(Category(name=name, scope="personal", colour=colour,
                        is_system=True, sort_order=order))
    for order, (name, colour, reimbursable) in enumerate(PROFESSIONAL):
        db.add(Category(name=name, scope="project", colour=colour, is_system=True,
                        sort_order=100 + order, reimbursable=reimbursable))
    db.flush()

    bank = Account(name="Bank account", type=AccountType.bank.value,
                   opening_balance=to_paise(opening_balance),
                   opening_date=date.today().replace(day=1))
    upi = Account(name="UPI / PhonePe", type=AccountType.bank.value,
                  opening_balance=0, opening_date=date.today().replace(day=1))
    cash = Account(name="Cash in hand", type=AccountType.cash.value,
                   opening_balance=0, opening_date=date.today().replace(day=1))
    db.add_all([bank, upi, cash])
    db.flush()

    personal = ledger.personal_fund(db)
    ledger.unassigned_fund(db)

    if bank.opening_balance:
        ledger.record_transaction(
            db, account_id=bank.id, value_date=bank.opening_date, direction="credit",
            amount=bank.opening_balance, kind=TxnKind.opening_balance.value,
            description="Opening balance",
            splits=[ledger.Split(fund_id=personal.id, amount=bank.opening_balance,
                                 reason="Opening balance")],
        )

    ledger.savings_fund(db)  # pre-create it, so it shows up before first use

    db.commit()
    report = ledger.integrity_check(db)
    return {
        "email": EMAIL,
        "password": PASSWORD,
        "practice": "Spatial Anthology",
        "opening_balance": format_inr(bank.opening_balance),
        "accounts": 3,
        "categories": len(PERSONAL) + len(PROFESSIONAL),
        "integrity_ok": report["ok"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Set up the Spatial Anthology ledger")
    parser.add_argument("--reset", action="store_true", help="drop every table first")
    parser.add_argument("--opening", default="0",
                        help="your current bank balance, e.g. 1,20,000")
    args = parser.parse_args()

    if args.reset:
        reset_database()
    else:
        Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        result = setup(db, args.opening)

    print()
    for key, value in result.items():
        print(f"  {key:>16}: {value}")
    print()


if __name__ == "__main__":
    main()
