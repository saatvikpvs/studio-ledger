"""The three areas, savings, and telling a CSV row apart from a hand entry.

The dashboard is organised around Personal / Professional / Savings, so the
figure that has to hold is that those three plus Unfiled equal the bank balance.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.core.money import to_paise
from app.models import TxnKind
from app.services import analytics, importer, ledger

from .conftest import assert_invariant


def credit(db, account, amount, fund_id, *, kind, on=date(2026, 6, 1)):
    return ledger.record_transaction(
        db, account_id=account.id, value_date=on, direction="credit",
        amount=to_paise(amount), kind=kind, description="In",
        splits=[ledger.Split(fund_id=fund_id, amount=to_paise(amount))],
    )


class TestAreasAddUp:
    def test_three_areas_plus_unfiled_equal_the_bank(
        self, db, bank, project, project_fund
    ):
        personal = ledger.personal_fund(db)
        savings = ledger.savings_fund(db)

        credit(db, bank, "50,000", personal.id, kind=TxnKind.personal_income.value)
        credit(db, bank, "5,00,000", project_fund.id,
               kind=TxnKind.client_payment.value)
        credit(db, bank, "10,000", savings.id, kind=TxnKind.personal_income.value)
        # Something imported but not yet filed.
        ledger.record_transaction(
            db, account_id=bank.id, value_date=date(2026, 6, 3), direction="debit",
            amount=to_paise("4,500"), description="UPI/DR/UNKNOWN", source="file",
        )

        view = analytics.overview(db, date(2026, 6, 30))
        total = (
            view["personal"]["balance"]
            + view["professional"]["balance"]
            + view["savings"]["balance"]
            + view["unassigned"]["balance"]
        )
        assert total == view["bank_balance"]
        assert_invariant(db)

    def test_savings_is_a_plain_area_like_personal(self, db, bank):
        savings = ledger.savings_fund(db)
        credit(db, bank, "30,000", savings.id, kind=TxnKind.personal_income.value)

        view = analytics.overview(db, date(2026, 6, 30))
        assert view["savings"]["balance"] == to_paise("30,000")
        assert view["savings"]["in_month"] == to_paise("30,000")
        assert view["savings"]["fund_id"] == savings.id


class TestSavingsIsARealTransaction:
    """Savings dropped the goal/envelope model: an entry here is a real
    transaction on the account, filed to the Savings fund -- exactly the same
    mechanism Personal already used, not a no-cash internal transfer."""

    def test_adding_to_savings_is_a_real_transaction(self, db, bank):
        savings = ledger.savings_fund(db)
        before = ledger.total_cash(db)

        credit(db, bank, "10,000", savings.id, kind=TxnKind.personal_income.value)

        assert ledger.total_cash(db) == before + to_paise("10,000")
        assert ledger.fund_balance(db, savings.id) == to_paise("10,000")
        assert_invariant(db)

    def test_it_counts_as_real_cash_flow_for_the_area(self, db, bank):
        savings = ledger.savings_fund(db)
        credit(db, bank, "10,000", savings.id, kind=TxnKind.personal_income.value)
        ledger.record_transaction(
            db, account_id=bank.id, value_date=date(2026, 6, 10), direction="debit",
            amount=to_paise("2,000"), kind=TxnKind.personal_spend.value,
            description="Withdrawn",
            splits=[ledger.Split(fund_id=savings.id, amount=to_paise("2,000"))],
        )

        view = analytics.overview(db, date(2026, 6, 30))
        assert view["savings"]["in_month"] == to_paise("10,000")
        assert view["savings"]["out_month"] == to_paise("2,000")
        assert view["savings"]["net_month"] == to_paise("8,000")


class TestManualMatching:
    """A statement row for something already typed in is not a new expense."""

    CSV = (
        "Date,Transaction Details,UTR,Transaction Type,Amount\n"
        "2026-06-04,Paid to VASUDHARA KITCHEN,845034463269,DEBIT,250\n"
    )

    def test_a_hand_entered_payment_is_recognised_not_reimported(self, db, bank):
        personal = ledger.personal_fund(db)
        # You record lunch the day it happens, in your own words.
        ledger.record_transaction(
            db, account_id=bank.id, value_date=date(2026, 6, 4), direction="debit",
            amount=to_paise("250"), kind=TxnKind.personal_spend.value,
            description="Lunch", source="manual",
            splits=[ledger.Split(fund_id=personal.id, amount=to_paise("250"))],
        )

        batch, _ = importer.stage_file(
            db, account_id=bank.id, filename="upi.csv", data=self.CSV.encode()
        )
        rows = importer.preview(db, batch)["rows"]

        assert rows[0]["state"] == "manual_match"
        assert rows[0]["include"] is False, "importing it would double the expense"
        assert batch.new_count == 0

    def test_descriptions_need_not_agree(self, db, bank):
        """You type "lunch"; the bank says "Paid to VASUDHARA KITCHEN"."""
        personal = ledger.personal_fund(db)
        ledger.record_transaction(
            db, account_id=bank.id, value_date=date(2026, 6, 6), direction="debit",
            amount=to_paise("250"), description="lunch with R", source="manual",
            splits=[ledger.Split(fund_id=personal.id, amount=to_paise("250"))],
        )
        batch, _ = importer.stage_file(
            db, account_id=bank.id, filename="upi.csv", data=self.CSV.encode()
        )
        # Two days apart, same amount and direction -- still recognised.
        assert importer.preview(db, batch)["rows"][0]["state"] == "manual_match"

    def test_an_unrelated_payment_is_still_new(self, db, bank):
        personal = ledger.personal_fund(db)
        ledger.record_transaction(
            db, account_id=bank.id, value_date=date(2026, 6, 4), direction="debit",
            amount=to_paise("900"), description="Something else", source="manual",
            splits=[ledger.Split(fund_id=personal.id, amount=to_paise("900"))],
        )
        batch, _ = importer.stage_file(
            db, account_id=bank.id, filename="upi.csv", data=self.CSV.encode()
        )
        assert importer.preview(db, batch)["rows"][0]["state"] == "new"
        assert batch.new_count == 1

    def test_an_imported_row_is_a_duplicate_not_a_manual_match(self, db, bank):
        first, _ = importer.stage_file(
            db, account_id=bank.id, filename="upi.csv", data=self.CSV.encode()
        )
        importer.commit(db, first)

        second, _ = importer.stage_file(
            db, account_id=bank.id, filename="upi.csv", data=self.CSV.encode()
        )
        assert importer.preview(db, second)["rows"][0]["state"] == "duplicate"
        assert_invariant(db)
