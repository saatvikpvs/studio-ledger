"""The tests that matter most.

Financial software fails silently -- a UI bug is visible, a wrong number is not.
So the weight goes here, on the invariant that everything else rests on:

    sum(all fund balances) == sum(all account balances)
"""

from __future__ import annotations

import random
from datetime import date, timedelta

import pytest

from app.core.money import to_paise
from app.models import FundKind, TxnKind, TxnStatus
from app.services import analytics, ledger

from .conftest import assert_invariant


def make(db, account, *, direction, amount, splits=None, kind="uncategorised", on=None):
    return ledger.record_transaction(
        db,
        account_id=account.id,
        value_date=on or date(2026, 6, 1),
        direction=direction,
        amount=to_paise(amount),
        kind=kind,
        description="Test transaction",
        splits=splits or [],
    )


class TestInvariant:
    def test_unallocated_money_lands_in_unassigned_not_null(self, db, bank):
        txn = make(db, bank, direction="credit", amount="5,00,000")

        assert len(txn.allocations) == 1
        fund = db.get(type(txn.allocations[0]).fund.property.mapper.class_,
                      txn.allocations[0].fund_id)
        assert fund.kind == FundKind.unassigned.value
        assert_invariant(db)

    def test_partial_allocation_puts_the_rest_in_unassigned(
        self, db, bank, project_fund
    ):
        txn = make(
            db, bank, direction="debit", amount="50,000",
            splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise("30,000"))],
        )

        assert sum(a.amount for a in txn.allocations) == txn.amount
        unassigned = ledger.unassigned_fund(db)
        assert any(a.fund_id == unassigned.id and a.amount == to_paise("20,000")
                   for a in txn.allocations)
        assert_invariant(db)

    def test_over_allocation_is_refused(self, db, bank, project_fund):
        with pytest.raises(ledger.LedgerError, match="exceed"):
            make(
                db, bank, direction="debit", amount="10,000",
                splits=[ledger.Split(fund_id=project_fund.id,
                                     amount=to_paise("15,000"))],
            )

    def test_split_across_two_funds(self, db, bank, project_fund):
        personal = ledger.personal_fund(db)
        # One hardware bill covering a site and the architect's own home.
        txn = make(
            db, bank, direction="debit", amount="50,000",
            splits=[
                ledger.Split(fund_id=project_fund.id, amount=to_paise("35,000")),
                ledger.Split(fund_id=personal.id, amount=to_paise("15,000")),
            ],
        )
        assert len(txn.allocations) == 2
        assert ledger.fund_balance(db, project_fund.id) == to_paise("-35,000")
        assert ledger.fund_balance(db, personal.id) == to_paise("-15,000")
        assert_invariant(db)

    def test_recategorising_never_moves_cash(self, db, bank, project_fund):
        txn = make(db, bank, direction="debit", amount="35,000")
        before = ledger.account_balance(db, bank.id)

        ledger.set_allocations(
            db, txn,
            [ledger.Split(fund_id=project_fund.id, amount=to_paise("35,000"))],
        )

        assert ledger.account_balance(db, bank.id) == before
        assert ledger.fund_balance(db, ledger.unassigned_fund(db).id) == 0
        assert_invariant(db)

    def test_random_operation_sequences_preserve_the_invariant(
        self, db, bank, cash, project_fund
    ):
        """The test that catches the refactor six months from now."""
        rng = random.Random(20260913)
        personal = ledger.personal_fund(db)
        funds = [project_fund.id, personal.id]
        created = []

        for step in range(60):
            choice = rng.random()
            on = date(2026, 1, 1) + timedelta(days=rng.randint(0, 200))

            if choice < 0.55:
                account = rng.choice([bank, cash])
                amount = rng.randint(100, 500_000)
                splits = []
                if rng.random() < 0.7:
                    fund_id = rng.choice(funds)
                    part = amount if rng.random() < 0.6 else rng.randint(1, amount)
                    splits = [ledger.Split(fund_id=fund_id, amount=part)]
                created.append(
                    ledger.record_transaction(
                        db,
                        account_id=account.id,
                        value_date=on,
                        direction=rng.choice(["credit", "debit"]),
                        amount=amount,
                        description=f"Row {step}",
                        splits=splits,
                        occurrence_index=step,
                    )
                )
            elif choice < 0.75 and created:
                txn = rng.choice(created)
                ledger.set_allocations(
                    db, txn,
                    [ledger.Split(fund_id=rng.choice(funds), amount=txn.amount)],
                )
            elif choice < 0.9:
                ledger.create_fund_transfer(
                    db,
                    from_fund_id=funds[0], to_fund_id=funds[1],
                    amount=rng.randint(1, 10_000), on=on, reason="correction",
                )
            elif created:
                txn = rng.choice(created)
                if txn.status == TxnStatus.posted.value:
                    ledger.void_transaction(db, txn, reason="random test")

            assert_invariant(db)


class TestFundTransfers:
    def test_fee_draw_moves_no_cash(self, db, bank, project_fund):
        make(
            db, bank, direction="credit", amount="5,00,000",
            kind=TxnKind.client_payment.value,
            splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise("5,00,000"))],
        )
        personal = ledger.personal_fund(db)
        cash_before = ledger.total_cash(db)

        ledger.create_fund_transfer(
            db, from_fund_id=project_fund.id, to_fund_id=personal.id,
            amount=to_paise("1,00,000"), on=date(2026, 6, 10), reason="fee_draw",
        )

        assert ledger.total_cash(db) == cash_before  # the bank never saw this
        assert ledger.fund_balance(db, project_fund.id) == to_paise("4,00,000")
        assert ledger.fund_balance(db, personal.id) == to_paise("1,00,000")
        assert_invariant(db)

    def test_cannot_transfer_a_fund_to_itself(self, db, project_fund):
        with pytest.raises(ledger.LedgerError):
            ledger.create_fund_transfer(
                db, from_fund_id=project_fund.id, to_fund_id=project_fund.id,
                amount=1000, on=date(2026, 6, 1), reason="correction",
            )


class TestProjectFigures:
    def test_the_brief_example(self, db, bank, project, project_fund, materials):
        """Client A gives 5,00,000; 2,15,000 is spent; 2,85,000 remains."""
        make(
            db, bank, direction="credit", amount="5,00,000",
            kind=TxnKind.client_payment.value,
            splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise("5,00,000"))],
        )
        for amount in ["80,000", "55,000", "40,000", "15,000", "25,000"]:
            make(
                db, bank, direction="debit", amount=amount,
                kind=TxnKind.vendor_payment.value,
                on=date(2026, 6, 2),
                splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise(amount),
                                     category_id=materials.id)],
            )

        summary = analytics.project_summary(db, project)
        assert summary.received == to_paise("5,00,000")
        assert summary.spent == to_paise("2,15,000")
        assert summary.in_hand == to_paise("2,85,000")
        assert summary.percent_of_received == 43.0
        assert_invariant(db)

    def test_a_project_may_go_negative(self, db, bank, project, project_fund):
        """Money is fungible. Warn loudly, block never."""
        make(
            db, bank, direction="credit", amount="3,00,000",
            kind=TxnKind.client_payment.value,
            splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise("3,00,000"))],
        )
        make(
            db, bank, direction="debit", amount="3,42,000",
            kind=TxnKind.vendor_payment.value,
            splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise("3,42,000"))],
        )

        summary = analytics.project_summary(db, project)
        assert summary.in_hand == to_paise("-42,000")
        assert summary.alert == "critical"
        assert_invariant(db)

    def test_vendor_refund_reduces_spend_and_is_not_income(
        self, db, bank, project, project_fund
    ):
        make(
            db, bank, direction="debit", amount="50,000",
            kind=TxnKind.vendor_payment.value,
            splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise("50,000"))],
        )
        make(
            db, bank, direction="credit", amount="8,000",
            kind=TxnKind.refund_in.value, on=date(2026, 6, 5),
            splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise("8,000"))],
        )

        summary = analytics.project_summary(db, project)
        assert summary.spent == to_paise("42,000")
        assert summary.received == 0  # a refund is not a client payment
        assert_invariant(db)

    def test_three_remaining_figures_are_distinct(
        self, db, bank, project, project_fund
    ):
        make(
            db, bank, direction="credit", amount="5,00,000",
            kind=TxnKind.client_payment.value,
            splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise("5,00,000"))],
        )
        make(
            db, bank, direction="debit", amount="2,15,000",
            kind=TxnKind.vendor_payment.value,
            splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise("2,15,000"))],
        )

        s = analytics.project_summary(db, project)
        assert s.in_hand == to_paise("2,85,000")      # cash available
        assert s.headroom == to_paise("29,85,000")    # against budget
        assert s.receivable == to_paise("23,00,000")  # client still owes
        assert len({s.in_hand, s.headroom, s.receivable}) == 3


class TestCashAndTransfers:
    def test_cash_withdrawal_is_not_an_expense(
        self, db, bank, cash, project, project_fund
    ):
        """The case that breaks a naive tracker in week one."""
        make(
            db, bank, direction="credit", amount="3,00,000",
            kind=TxnKind.client_payment.value,
            splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise("3,00,000"))],
        )
        # Withdraw 55,000 for site labour: bank out, cash in, same fund.
        for account, direction in ((bank, "debit"), (cash, "credit")):
            make(
                db, account, direction=direction, amount="55,000",
                kind=TxnKind.account_transfer.value, on=date(2026, 6, 3),
                splits=[ledger.Split(fund_id=project_fund.id,
                                     amount=to_paise("55,000"))],
            )

        summary = analytics.project_summary(db, project)
        assert summary.spent == 0  # nothing has actually been spent yet
        assert summary.in_hand == to_paise("3,00,000")
        assert ledger.account_balance(db, cash.id) == to_paise("55,000")
        assert_invariant(db)

        # Now pay the labour out of the tin.
        make(
            db, cash, direction="debit", amount="34,000",
            kind=TxnKind.vendor_payment.value, on=date(2026, 6, 4),
            splits=[ledger.Split(fund_id=project_fund.id, amount=to_paise("34,000"))],
        )
        assert analytics.project_summary(db, project).spent == to_paise("34,000")
        assert_invariant(db)


class TestVoiding:
    def test_void_removes_it_from_balances_but_keeps_the_row(self, db, bank):
        txn = make(db, bank, direction="debit", amount="10,000")
        assert ledger.account_balance(db, bank.id) == to_paise("-10,000")

        ledger.void_transaction(db, txn, reason="entered twice")

        assert ledger.account_balance(db, bank.id) == 0
        assert db.get(type(txn), txn.id) is not None  # history is preserved
        assert_invariant(db)


class TestReconciledPeriods:
    def test_cannot_post_into_a_closed_period(self, db, bank):
        bank.reconciled_through = date(2026, 6, 30)
        db.flush()

        with pytest.raises(ledger.LedgerError, match="reconciled"):
            make(db, bank, direction="debit", amount="1,000", on=date(2026, 6, 15))

    def test_posting_after_the_lock_is_fine(self, db, bank):
        bank.reconciled_through = date(2026, 6, 30)
        db.flush()
        make(db, bank, direction="debit", amount="1,000", on=date(2026, 7, 1))
        assert_invariant(db)
