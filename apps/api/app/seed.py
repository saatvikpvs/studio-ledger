"""Demo dataset.

Four projects across eighteen months, with the awkward cases deliberately baked
in: a project running short, a cash withdrawal paid out in cash, a vendor
refund, a fee draw, and a handful of rows left uncategorised so the review
screen has something to do.

Run with::

    python -m app.seed --reset
"""

from __future__ import annotations

import argparse
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.db import Base, SessionLocal, engine
from .core.money import format_inr, to_paise
from .core.security import hash_password
from .models import (
    Account,
    AccountType,
    Category,
    Client,
    FeeModel,
    Owner,
    Project,
    ProjectStatus,
    Rule,
    TransferReason,
    TxnKind,
    Vendor,
)
from .services import ledger

DEMO_EMAIL = "ananya@iyerassociates.in"
DEMO_PASSWORD = "studioledger2026"

PROJECT_CATEGORIES = [
    ("Materials", "#B45309", True), ("Labour", "#0F766E", True),
    ("Contractor", "#7C2D12", True), ("Furniture", "#9333EA", True),
    ("Electrical", "#CA8A04", True), ("Plumbing", "#0284C7", True),
    ("Travel", "#4F46E5", True), ("Site expenses", "#65A30D", True),
    ("Consultant", "#DB2777", False), ("Government fees", "#475569", True),
    ("Equipment", "#0891B2", True), ("Software", "#7C3AED", False),
    ("Printing", "#A16207", False), ("Miscellaneous", "#64748B", True),
]

PERSONAL_CATEGORIES = [
    ("Food", "#EA580C"), ("Shopping", "#DB2777"), ("Travel", "#4F46E5"),
    ("Rent", "#B91C1C"), ("Bills", "#0369A1"), ("Entertainment", "#9333EA"),
    ("Education", "#15803D"), ("Subscriptions", "#7C3AED"),
    ("Family", "#BE123C"), ("Bank charges", "#64748B"),
    ("Interest", "#059669"), ("Other", "#94A3B8"),
]


def reset_database() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def seed(db: Session) -> dict:
    if db.scalar(select(Owner)):
        return {"skipped": "already seeded"}

    db.add(Owner(
        email=DEMO_EMAIL,
        password_hash=hash_password(DEMO_PASSWORD),
        display_name="Ananya Iyer",
        practice_name="Iyer & Associates, Architects",
        gstin="29ABCDE1234F1Z5",
        fiscal_year_start_month=4,
    ))

    categories: dict[str, Category] = {}
    for order, (name, colour, reimbursable) in enumerate(PROJECT_CATEGORIES):
        category = Category(name=name, scope="project", colour=colour,
                            is_system=True, sort_order=order,
                            reimbursable=reimbursable)
        db.add(category)
        categories[name] = category
    for order, (name, colour) in enumerate(PERSONAL_CATEGORIES):
        category = Category(name=name, scope="personal", colour=colour,
                            is_system=True, sort_order=100 + order)
        db.add(category)
        categories["p:" + name] = category
    db.flush()

    bank = Account(name="HDFC Current", type=AccountType.bank.value,
                   bank_name="HDFC Bank", last4="4417",
                   opening_balance=to_paise("1,20,000"), opening_date=date(2025, 4, 1))
    cash = Account(name="Cash in hand", type=AccountType.cash.value,
                   opening_balance=0, opening_date=date(2025, 4, 1))
    db.add_all([bank, cash])
    db.flush()

    personal = ledger.personal_fund(db)
    ledger.unassigned_fund(db)

    # Opening balance is a real transaction, not a bare column.
    ledger.record_transaction(
        db, account_id=bank.id, value_date=date(2025, 4, 1), direction="credit",
        amount=bank.opening_balance, kind=TxnKind.opening_balance.value,
        description="Opening balance — HDFC Current",
        splits=[ledger.Split(fund_id=personal.id, amount=bank.opening_balance,
                             reason="Opening balance")],
    )

    clients = {}
    for name, phone, place in [
        ("Rao Sudhir", "+91 98450 11223", "Jayanagar, Bengaluru"),
        ("Sharma Holdings", "+91 98860 44551", "Gachibowli, Hyderabad"),
        ("Kumar Prasad", "+91 94480 77219", "Vijayanagar, Mysuru"),
        ("Meridian Offices", "+91 80456 33110", "Whitefield, Bengaluru"),
    ]:
        client = Client(name=name, phone=phone, address=place)
        db.add(client)
        clients[name] = client
    db.flush()

    projects = {}
    specs = [
        ("RAO-01", "Rao Residence", "Rao Sudhir", "Jayanagar, Bengaluru", "Residential",
         date(2026, 5, 4), date(2027, 3, 31), "32,00,000", "28,00,000",
         FeeModel.percent_of_cost, 8.0, 0, ProjectStatus.active),
        ("SHR-02", "Sharma Commercial Building", "Sharma Holdings", "Gachibowli, Hyderabad",
         "Commercial", date(2025, 11, 12), date(2026, 12, 31), "48,00,000", "40,00,000",
         FeeModel.percent_of_cost, 6.5, 0, ProjectStatus.active),
        ("KUM-03", "Kumar Villa", "Kumar Prasad", "Vijayanagar, Mysuru", "Residential",
         date(2026, 2, 18), date(2026, 11, 30), "18,00,000", "16,00,000",
         FeeModel.percent_of_cost, 8.0, 0, ProjectStatus.active),
        ("MER-04", "Office Interior — Meridian", "Meridian Offices", "Whitefield, Bengaluru",
         "Interior", date(2025, 6, 2), date(2026, 2, 28), "9,00,000", "9,00,000",
         FeeModel.lump_sum, 0.0, to_paise("7,50,000"), ProjectStatus.completed),
    ]
    for (code, name, client_name, place, kind, start, due, budget,
         expected, fee_model, fee_pct, fee_lump, status) in specs:
        project = Project(
            code=code, name=name, client_id=clients[client_name].id, location=place,
            project_type=kind, start_date=start, due_date=due,
            budget=to_paise(budget), expected_total=to_paise(expected),
            fee_model=fee_model.value, fee_percent=fee_pct, fee_lump_sum=fee_lump,
            status=status.value,
        )
        db.add(project)
        db.flush()
        ledger.fund_for_project(db, project.id, project.name)
        projects[name] = project

    vendors = [
        ("ABC Cement & Steel", "Materials", ["ABC CEMENT", "ABC CEM"]),
        ("Sri Lakshmi Hardware", "Materials", ["SRI LAKSHMI", "LAKSHMI HARDWARE"]),
        ("Ravi Contractors", "Contractor", ["RAVI CONTRACT", "RAVI CONST"]),
        ("Murthy Electricals", "Electrical", ["MURTHY ELEC"]),
        ("Deccan Plumbing Works", "Plumbing", ["DECCAN PLUMB"]),
        ("Prakash Interiors", "Furniture", ["PRAKASH INTER"]),
        ("Vision Reprographics", "Printing", ["VISION REPRO", "VISION PRINT"]),
    ]
    for name, category_name, patterns in vendors:
        db.add(Vendor(name=name, default_category_id=categories[category_name].id,
                      match_patterns=patterns))
    db.flush()

    db.add_all([
        Rule(name="ABC Cement → Materials", priority=10,
             conditions={"description_contains": "ABC CEMENT", "direction": "debit"},
             actions={"category_id": categories["Materials"].id,
                      "kind": TxnKind.vendor_payment.value},
             auto_apply=False),
        Rule(name="Swiggy & Zomato → Personal / Food", priority=20,
             conditions={"description_regex": "SWIGGY|ZOMATO", "direction": "debit"},
             actions={"fund_id": personal.id, "category_id": categories["p:Food"].id,
                      "kind": TxnKind.personal_spend.value},
             auto_apply=True),
        Rule(name="Bank charges → Personal", priority=30,
             conditions={"description_regex": "CHARGE|CHRG", "direction": "debit",
                         "amount_max": to_paise("2,000")},
             actions={"fund_id": personal.id,
                      "category_id": categories["p:Bank charges"].id,
                      "kind": TxnKind.bank_charge.value},
             auto_apply=True),
    ])
    db.flush()

    _seed_transactions(db, bank, cash, projects, categories, personal)
    db.commit()

    report = ledger.integrity_check(db)
    return {
        "email": DEMO_EMAIL,
        "password": DEMO_PASSWORD,
        "bank_balance": format_inr(report["cash_balance"]),
        "integrity_ok": report["ok"],
        "problems": report["problems"],
    }


def _seed_transactions(db, bank, cash, projects, categories, personal) -> None:
    def fund_of(project_name: str) -> int:
        project = projects[project_name]
        return ledger.fund_for_project(db, project.id, project.name).id

    def spend(project_name, on, amount, description, category, account=None,
              kind=TxnKind.vendor_payment.value):
        ledger.record_transaction(
            db, account_id=(account or bank).id, value_date=on, direction="debit",
            amount=to_paise(amount), kind=kind, description=description,
            splits=[ledger.Split(fund_id=fund_of(project_name), amount=to_paise(amount),
                                 category_id=categories[category].id)],
        )

    def receive(project_name, on, amount, description, ref):
        ledger.record_transaction(
            db, account_id=bank.id, value_date=on, direction="credit",
            amount=to_paise(amount), kind=TxnKind.client_payment.value,
            description=description, external_ref=ref,
            splits=[ledger.Split(fund_id=fund_of(project_name), amount=to_paise(amount))],
        )

    def personal_spend(on, amount, description, category):
        ledger.record_transaction(
            db, account_id=bank.id, value_date=on, direction="debit",
            amount=to_paise(amount), kind=TxnKind.personal_spend.value,
            description=description,
            splits=[ledger.Split(fund_id=personal.id, amount=to_paise(amount),
                                 category_id=categories["p:" + category].id)],
        )

    def personal_income(on, amount, description):
        ledger.record_transaction(
            db, account_id=bank.id, value_date=on, direction="credit",
            amount=to_paise(amount), kind=TxnKind.personal_income.value,
            description=description,
            splits=[ledger.Split(fund_id=personal.id, amount=to_paise(amount))],
        )

    # ---- Office Interior (completed) -------------------------------------
    receive("Office Interior — Meridian", date(2025, 6, 6), "3,00,000",
            "NEFT CR-MERIDIAN OFFICES-ADVANCE", "MERI250606A")
    receive("Office Interior — Meridian", date(2025, 9, 18), "3,00,000",
            "NEFT CR-MERIDIAN OFFICES-STAGE 2", "MERI250918B")
    receive("Office Interior — Meridian", date(2026, 1, 22), "3,00,000",
            "NEFT CR-MERIDIAN OFFICES-FINAL", "MERI260122C")
    for on, amount, description, category in [
        (date(2025, 6, 20), "1,10,000", "UPI/DR/PRAKASH INTERIORS/prakashint@okaxis", "Furniture"),
        (date(2025, 7, 14), "68,000", "UPI/DR/MURTHY ELECTRICALS/murthyelec@ybl", "Electrical"),
        (date(2025, 8, 9), "92,000", "NEFT DR-RAVI CONTRACTORS", "Contractor"),
        (date(2025, 10, 3), "54,000", "UPI/DR/SRI LAKSHMI HARDWARE", "Materials"),
        (date(2025, 11, 27), "38,000", "UPI/DR/DECCAN PLUMBING WORKS", "Plumbing"),
        (date(2026, 1, 9), "28,000", "UPI/DR/VISION REPROGRAPHICS", "Printing"),
    ]:
        spend("Office Interior — Meridian", on, amount, description, category)

    # ---- Sharma Commercial: approaching its limit ------------------------
    for on, amount, ref in [
        (date(2025, 11, 20), "3,00,000", "SHRM251120"),
        (date(2026, 3, 11), "2,50,000", "SHRM260311"),
        (date(2026, 7, 8), "2,50,000", "SHRM260708"),
    ]:
        receive("Sharma Commercial Building", on, amount,
                "NEFT CR-SHARMA HOLDINGS-MILESTONE", ref)
    for on, amount, description, category in [
        (date(2025, 12, 4), "1,45,000", "UPI/DR/ABC CEMENT AND ST/abccement@okaxis", "Materials"),
        (date(2026, 1, 16), "98,000", "NEFT DR-RAVI CONTRACTORS-SLAB", "Contractor"),
        (date(2026, 2, 21), "76,000", "UPI/DR/LABOUR PAYMENT SITE 2", "Labour"),
        (date(2026, 4, 6), "1,20,000", "UPI/DR/ABC CEMENT AND ST/abccement@okaxis", "Materials"),
        (date(2026, 5, 19), "88,000", "UPI/DR/MURTHY ELECTRICALS/murthyelec@ybl", "Electrical"),
        (date(2026, 6, 24), "64,000", "UPI/DR/DECCAN PLUMBING WORKS", "Plumbing"),
        (date(2026, 7, 30), "72,000", "UPI/DR/LABOUR PAYMENT SITE 2", "Labour"),
        (date(2026, 8, 14), "49,000", "NEFT DR-STRUCTURAL CONSULTANT FEE", "Consultant"),
        (date(2026, 8, 28), "20,000", "UPI/DR/SITE SECURITY AND WATER", "Site expenses"),
    ]:
        spend("Sharma Commercial Building", on, amount, description, category)

    # A vendor refund: money back in, and it reduces project spend. Not income.
    ledger.record_transaction(
        db, account_id=bank.id, value_date=date(2026, 9, 2), direction="credit",
        amount=to_paise("8,000"), kind=TxnKind.refund_in.value,
        description="UPI/CR/DECCAN PLUMBING WORKS/REFUND RETURNED GOODS",
        splits=[ledger.Split(fund_id=fund_of("Sharma Commercial Building"),
                             amount=to_paise("8,000"),
                             category_id=categories["Plumbing"].id,
                             note="Returned two unused fittings")],
    )

    # ---- Kumar Villa: overspent, funded from elsewhere -------------------
    receive("Kumar Villa", date(2026, 2, 24), "1,50,000",
            "NEFT CR-KUMAR PRASAD-ADVANCE", "KUM260224")
    receive("Kumar Villa", date(2026, 6, 15), "1,50,000",
            "NEFT CR-KUMAR PRASAD-STAGE 2", "KUM260615")
    for on, amount, description, category in [
        (date(2026, 3, 6), "82,000", "UPI/DR/ABC CEMENT AND ST/abccement@okaxis", "Materials"),
        (date(2026, 4, 18), "64,000", "NEFT DR-RAVI CONTRACTORS-FOUNDATION", "Contractor"),
        (date(2026, 5, 22), "46,000", "UPI/DR/SRI LAKSHMI HARDWARE", "Materials"),
        (date(2026, 7, 11), "58,000", "UPI/DR/MURTHY ELECTRICALS/murthyelec@ybl", "Electrical"),
        (date(2026, 8, 20), "37,000", "UPI/DR/BBMP PLAN SANCTION FEE", "Government fees"),
    ]:
        spend("Kumar Villa", on, amount, description, category)

    # Cash withdrawn for labour. This is a TRANSFER, not an expense -- the money
    # is still Kumar Villa's, it has just moved from the bank to the tin.
    ledger.record_transaction(
        db, account_id=bank.id, value_date=date(2026, 9, 1), direction="debit",
        amount=to_paise("55,000"), kind=TxnKind.account_transfer.value,
        description="ATW/CASH WITHDRAWAL/JAYANAGAR",
        splits=[ledger.Split(fund_id=fund_of("Kumar Villa"), amount=to_paise("55,000"),
                             note="Drawn for site labour")],
    )
    ledger.record_transaction(
        db, account_id=cash.id, value_date=date(2026, 9, 1), direction="credit",
        amount=to_paise("55,000"), kind=TxnKind.account_transfer.value,
        description="Cash drawn from HDFC Current",
        splits=[ledger.Split(fund_id=fund_of("Kumar Villa"), amount=to_paise("55,000"))],
    )
    spend("Kumar Villa", date(2026, 9, 3), "34,000",
          "Mason and helpers — week ending 3 Sep", "Labour", account=cash)
    spend("Kumar Villa", date(2026, 9, 9), "21,000",
          "Site labour — week ending 9 Sep", "Labour", account=cash)

    # ---- Rao Residence: the example from the brief -----------------------
    receive("Rao Residence", date(2026, 5, 9), "3,00,000",
            "NEFT CR-RAO SUDHIR-DESIGN ADVANCE", "RAO260509")
    receive("Rao Residence", date(2026, 9, 12), "2,00,000",
            "NEFT CR-RAO SUDHIR-STAGE PAYMENT", "AXISP00234519")
    for on, amount, description, category in [
        (date(2026, 6, 2), "80,000", "UPI/DR/ABC CEMENT AND ST/abccement@okaxis", "Materials"),
        (date(2026, 6, 27), "55,000", "UPI/DR/LABOUR PAYMENT SITE 1", "Labour"),
        (date(2026, 7, 21), "40,000", "NEFT DR-RAVI CONTRACTORS-RAO", "Contractor"),
        (date(2026, 8, 5), "15,000", "UPI/DR/SITE VISITS FUEL AND TOLL", "Travel"),
        (date(2026, 8, 26), "25,000", "UPI/DR/SITE EXPENSES MISC", "Miscellaneous"),
    ]:
        spend("Rao Residence", on, amount, description, category)

    # The architect draws his fee. No bank row -- the bank never sees this.
    ledger.create_fund_transfer(
        db, from_fund_id=fund_of("Rao Residence"), to_fund_id=personal.id,
        amount=to_paise("1,00,000"), on=date(2026, 9, 10),
        reason=TransferReason.fee_draw.value,
        note="Design fee drawn against Rao Residence stage 1",
    )

    # ---- personal life ---------------------------------------------------
    cursor = date(2025, 4, 5)
    rotation = [
        ("32,000", "NEFT DR-LANDLORD RENT", "Rent"),
        ("4,800", "UPI/DR/SWIGGY ORDER", "Food"),
        ("2,400", "UPI/DR/BESCOM ELECTRICITY BILL", "Bills"),
        ("1,299", "UPI/DR/NETFLIX SUBSCRIPTION", "Subscriptions"),
        ("6,200", "UPI/DR/AMAZON RETAIL INDIA", "Shopping"),
        ("3,100", "UPI/DR/ZOMATO ORDER", "Food"),
        ("2,800", "UPI/DR/AIRTEL BROADBAND", "Bills"),
        ("9,500", "UPI/DR/INDIGO AIR TICKET", "Travel"),
    ]
    index = 0
    while cursor < date(2026, 9, 10):
        amount, description, category = rotation[index % len(rotation)]
        personal_spend(cursor, amount, description, category)
        cursor += timedelta(days=11)
        index += 1

    for month, amount in [(6, "45,000"), (9, "45,000"), (12, "45,000")]:
        personal_income(date(2025, month, 28), amount,
                        "NEFT CR-RV COLLEGE OF ARCHITECTURE-VISITING FACULTY")
    for month, amount in [(2, "48,000"), (5, "48,000"), (8, "48,000")]:
        personal_income(date(2026, month, 28), amount,
                        "NEFT CR-RV COLLEGE OF ARCHITECTURE-VISITING FACULTY")

    for on, amount in [(date(2025, 9, 30), "412"), (date(2026, 3, 31), "689")]:
        ledger.record_transaction(
            db, account_id=bank.id, value_date=on, direction="credit",
            amount=to_paise(amount), kind=TxnKind.interest.value,
            description="SAVINGS INTEREST CREDIT",
            splits=[ledger.Split(fund_id=personal.id, amount=to_paise(amount),
                                 category_id=categories["p:Interest"].id)],
        )

    # ---- rows left for the review screen ---------------------------------
    for on, direction, amount, description in [
        (date(2026, 9, 4), "debit", "4,500", "UPI/DR/425719836104/AMAZON RETAIL/HDFC"),
        (date(2026, 9, 5), "debit", "2,000", "UPI/DR/XYZ ENTERPRISES/xyzent@okicici"),
        (date(2026, 9, 6), "debit", "18,400", "UPI/DR/SRI LAKSHMI HARDWARE/srilak@ybl"),
        (date(2026, 9, 7), "debit", "1,150", "POS/SWIGGY INSTAMART/BENGALURU"),
        (date(2026, 9, 8), "credit", "12,000", "UPI/CR/UNKNOWN SENDER/PAYMENT"),
        (date(2026, 9, 11), "debit", "236", "ACCOUNT SERVICE CHARGE SEP"),
    ]:
        ledger.record_transaction(
            db, account_id=bank.id, value_date=on, direction=direction,
            amount=to_paise(amount), description=description, source="file",
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the Studio Ledger demo data")
    parser.add_argument("--reset", action="store_true",
                        help="drop every table first")
    args = parser.parse_args()

    if args.reset:
        reset_database()
    else:
        Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        result = seed(db)

    print()
    for key, value in result.items():
        print(f"  {key:>14}: {value}")
    print()


if __name__ == "__main__":
    main()
