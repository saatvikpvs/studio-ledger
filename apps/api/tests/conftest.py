from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.core.money import to_paise
from app.models import Account, AccountType, Category, Client, Project, TxnKind
from app.services import ledger


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def bank(db):
    account = Account(
        name="Test Current",
        type=AccountType.bank.value,
        opening_balance=0,
        opening_date=date(2026, 1, 1),
    )
    db.add(account)
    db.flush()
    return account


@pytest.fixture()
def cash(db):
    account = Account(
        name="Cash in hand",
        type=AccountType.cash.value,
        opening_date=date(2026, 1, 1),
    )
    db.add(account)
    db.flush()
    return account


@pytest.fixture()
def materials(db):
    category = Category(name="Materials", scope="project")
    db.add(category)
    db.flush()
    return category


@pytest.fixture()
def project(db):
    client = Client(name="Rao Sudhir")
    db.add(client)
    db.flush()
    proj = Project(
        name="Rao Residence",
        client_id=client.id,
        budget=to_paise("32,00,000"),
        expected_total=to_paise("28,00,000"),
        fee_percent=8.0,
    )
    db.add(proj)
    db.flush()
    ledger.fund_for_project(db, proj.id, proj.name)
    return proj


@pytest.fixture()
def project_fund(db, project):
    return ledger.fund_for_project(db, project.id, project.name)


def assert_invariant(db):
    """sum(funds) == sum(accounts), always. The whole design rests on this."""
    report = ledger.integrity_check(db)
    assert report["ok"], report["problems"]
    return report
