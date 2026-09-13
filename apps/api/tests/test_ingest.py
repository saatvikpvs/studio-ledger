"""Statement parsing, narration normalisation and de-duplication.

The dedupe matrix is the important part: overlapping statements are the normal
case, and two legitimately identical rows must both survive.
"""

from __future__ import annotations

import io
from datetime import date

import pytest

from app.core.money import to_paise
from app.ingest.normalize import fingerprint, parse_narration
from app.ingest.parsers.statement import (
    StatementError,
    find_header,
    load_grid,
    parse_date,
    parse_statement,
    verify_numeric_columns,
)
from app.models import StagedState
from app.services import importer

from .conftest import assert_invariant

HDFC_CSV = """Statement of account
Account No: XXXXXXXX4417

Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
12/09/26,NEFT CR-RAO SUDHIR-ADVANCE,AXISP00234519,12/09/26,,"2,00,000.00","3,20,000.00"
13/09/26,UPI/DR/425719836104/ABC CEMENT AND ST/HDFC/abccement@okaxis,000000,13/09/26,"35,000.00",,"2,85,000.00"
14/09/26,POS/AMAZON RETAIL INDIA/BENGALURU,000000,14/09/26,"4,500.00",,"2,80,500.00"
15/09/26,UPI/DR/998877665544/XYZ ENTERPRISES/xyz@okicici,000000,15/09/26,"2,000.00",,"2,78,500.00"

*** End of statement ***
"""

SIGNED_CSV = """Transaction Date,Description,Amount,Balance
01-Jun-2026,SALARY CREDIT,45000.00,145000.00
03-Jun-2026,RENT PAYMENT,-32000.00,113000.00
"""

DRCR_CSV = """Txn Date,Particulars,Amount,Dr/Cr
05/06/2026,FUEL PUMP HSR,500.00,DR
05/06/2026,FUEL PUMP HSR,500.00,DR
"""

# A wallet statement (PhonePe shape). Three hazards in one file:
#   * "Credit/debit instrument" contains the word "credit" but holds text
#   * the amount is unsigned, with direction in a separate Transaction Type column
#   * a multi-line legal disclaimer follows the data
PHONEPE_CSV = """Transaction Statement for 91XXXXXXXX
Duration,"15 Jun, 2026 - 13 Sep, 2026"

Date,Time,Transaction Details,Transaction ID,UTR,Transaction Type,Credit/debit instrument,Amount
2026-09-11,19:26:00,Received from A Sender,T2609111926165927453407,845034463269,CREDIT,Credited to 6272XXXXXXXX1009,5000
2026-09-04,17:24:00,Paid to SOME MERCHANT,T2609041724332889910827,393309573765,DEBIT,Paid by 6272XXXXXXXX1009,85
2026-08-29,11:38:00,Paid to UBER INDIA SYSTEMS P,T2608291138566416968194,471628900605,DEBIT,Paid by 6272XXXXXXXX1009,108.07
Disclaimer : Do not fall prey to fictitious offers of winning prizes
etc. through SMS  emails and calls. The contents of this email
the recipient specified in this document. If you received this message by mistake
"""


class TestNarration:
    def test_upi_narration(self):
        parsed = parse_narration(
            "UPI/DR/425719836104/ABC CEMENT AND ST/HDFC/abccement@okaxis/Pay"
        )
        assert parsed.normalised == "ABC CEMENT AND ST"
        assert parsed.vpa == "abccement@okaxis"

    def test_neft_narration(self):
        parsed = parse_narration("NEFT-AXISP00234519-RAO SUDHIR-HDFC0000123-PAYMENT")
        assert "RAO SUDHIR" in parsed.normalised
        assert parsed.reference == "AXISP00234519"

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("Paid to PRUTHVI SIDDARTHA ER", "PRUTHVI SIDDARTHA ER"),
            ("Received from Soumya Akka", "SOUMYA AKKA"),
            ("Paid to UBER INDIA SYSTEMS P", "UBER INDIA SYSTEMS P"),
            ("Money sent to Ravi Contractors", "RAVI CONTRACTORS"),
        ],
    )
    def test_wallet_phrasing_reduces_to_the_counterparty(self, raw, expected):
        # "Paid to X" and "Received from X" are the same counterparty X. Keeping
        # the verb splits one merchant into two and breaks merchant memory.
        assert parse_narration(raw).normalised == expected

    def test_empty_narration_is_safe(self):
        parsed = parse_narration("")
        assert parsed.normalised == ""
        assert parsed.vpa is None

    def test_normalisation_is_stable(self):
        # Two statements can spell the same payment differently; the normalised
        # form is what the classifier and dedupe both key on.
        a = parse_narration("UPI/DR/111111/SRI LAKSHMI HARDWARE/HDFC/sl@ybl")
        b = parse_narration("UPI/DR/222222/SRI LAKSHMI HARDWARE/HDFC/sl@ybl")
        assert a.normalised == b.normalised


class TestDates:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("12/09/26", date(2026, 9, 12)),
            ("13-Sep-2026", date(2026, 9, 13)),
            ("2026-09-14", date(2026, 9, 14)),
            ("15.09.2026", date(2026, 9, 15)),
            ("1 Jun 2026", date(2026, 6, 1)),
        ],
    )
    def test_indian_date_shapes(self, text, expected):
        assert parse_date(text) == expected

    def test_day_first_not_month_first(self):
        # 05/06/2026 is 5 June in India, not 6 May.
        assert parse_date("05/06/2026") == date(2026, 6, 5)

    def test_excel_serial(self):
        assert parse_date("46277") == date(2026, 9, 12)

    def test_rejects_nonsense(self):
        with pytest.raises(ValueError):
            parse_date("not a date")


class TestParsing:
    def test_hdfc_layout_with_preamble_and_footer(self):
        result = parse_statement(HDFC_CSV.encode(), "hdfc.csv")

        assert result.header_row == 3  # preamble discarded
        assert len(result.rows) == 4
        assert result.rows[0].direction == "credit"
        assert result.rows[0].amount == to_paise("2,00,000")
        assert result.rows[1].direction == "debit"
        assert result.rows[1].amount == to_paise("35,000")
        assert result.rows[0].reference == "AXISP00234519"

    def test_balance_chain_is_verified(self):
        result = parse_statement(HDFC_CSV.encode(), "hdfc.csv")
        # This statement's balances add up, so no warning about missing rows.
        assert not any("balance does not add up" in w for w in result.warnings)

    def test_broken_balance_chain_warns(self):
        broken = HDFC_CSV.replace('"2,85,000.00"', '"9,99,999.00"')
        result = parse_statement(broken.encode(), "hdfc.csv")
        assert any("balance does not add up" in w for w in result.warnings)

    def test_single_signed_amount_column(self):
        result = parse_statement(SIGNED_CSV.encode(), "signed.csv")
        assert len(result.rows) == 2
        assert result.rows[0].direction == "credit"
        assert result.rows[1].direction == "debit"
        assert result.rows[1].amount == to_paise("32,000")

    def test_dr_cr_flag_column(self):
        result = parse_statement(DRCR_CSV.encode(), "drcr.csv")
        assert len(result.rows) == 2
        assert all(row.direction == "debit" for row in result.rows)

    def test_unrecognised_layout_asks_for_mapping(self):
        result = parse_statement(b"alpha,beta,gamma\n1,2,3\n", "odd.csv")
        assert result.needs_mapping is True
        assert result.preview  # the wizard needs rows to show

    def test_wallet_statement_with_a_lying_header(self):
        """Regression: the worst bug found in this project.

        "Credit/debit instrument" holds "Credited to 6272XXXXXXXX1009". Matching
        it as the deposit column made every row parse as a Rs 6,272 credit --
        the masked card digits read as an amount. No error was raised; 182 real
        transactions were silently replaced with the same wrong figure.

        The fix is to check the data under a candidate money column, because
        header text cannot be trusted.
        """
        result = parse_statement(PHONEPE_CSV.encode(), "wallet.csv")

        assert "credit" not in result.column_map, "an instrument column is not money"
        assert result.column_map["amount"] == 7
        assert result.column_map["ref"] == 4, "UTR identifies a payment; a wallet id does not"

        assert len(result.rows) == 3
        assert [row.direction for row in result.rows] == ["credit", "debit", "debit"]
        assert [row.amount for row in result.rows] == [
            to_paise("5000"), to_paise("85"), to_paise("108.07"),
        ]
        assert result.rows[0].reference == "845034463269"

    def test_legal_disclaimer_is_not_reported_as_broken_rows(self):
        result = parse_statement(PHONEPE_CSV.encode(), "wallet.csv")
        assert result.errors == []

    def test_an_instrument_column_is_never_read_as_money(self):
        grid = load_grid(PHONEPE_CSV.encode(), "wallet.csv")
        head, raw = find_header(grid)
        verified = verify_numeric_columns(grid, head, raw)
        assert verified.get("amount") == 7
        assert "credit" not in verified and "debit" not in verified

    def test_legacy_xls_is_refused_with_advice(self):
        with pytest.raises(StatementError, match="re-save"):
            parse_statement(b"anything", "statement.xls")


class TestDedupe:
    def _stage(self, db, account, payload, name="hdfc.csv"):
        batch, _ = importer.stage_file(
            db, account_id=account.id, filename=name, data=payload
        )
        return batch

    def test_first_import_is_all_new(self, db, bank):
        batch = self._stage(db, bank, HDFC_CSV.encode())
        assert batch.new_count == 4
        assert batch.dup_count == 0

    def test_same_file_twice_finds_every_row_duplicate(self, db, bank):
        first = self._stage(db, bank, HDFC_CSV.encode())
        importer.commit(db, first)

        second = self._stage(db, bank, HDFC_CSV.encode())
        assert second.new_count == 0
        assert second.dup_count == 4

    def test_overlapping_statements_import_only_the_new_rows(self, db, bank):
        first = self._stage(db, bank, HDFC_CSV.encode())
        importer.commit(db, first)

        overlap = HDFC_CSV + (
            '16/09/26,UPI/DR/SRI LAKSHMI HARDWARE,000000,16/09/26,'
            '"18,400.00",,"2,60,100.00"\n'
        )
        second = self._stage(db, bank, overlap.encode(), name="hdfc-sep-oct.csv")
        assert second.new_count == 1
        assert second.dup_count == 4

    def test_two_identical_rows_both_survive(self, db, bank):
        """Two Rs 500 fuel fills at the same pump on the same day are both real."""
        batch = self._stage(db, bank, DRCR_CSV.encode(), name="fuel.csv")
        assert batch.new_count == 2
        assert batch.dup_count == 0

        result = importer.commit(db, batch)
        assert result["created"] == 2
        assert_invariant(db)

    def test_placeholder_references_are_not_treated_as_identity(self, db, bank):
        """Regression: banks write "000000" in the ref column on UPI rows.

        Matching on that made every later UPI row look like a duplicate of the
        first, silently dropping real transactions -- the worst failure mode
        there is, because the import reports success.
        """
        first = self._stage(db, bank, HDFC_CSV.encode())
        importer.commit(db, first)

        overlap = HDFC_CSV + (
            '16/09/26,UPI/DR/SRI LAKSHMI HARDWARE,000000,16/09/26,'
            '"18,400.00",,"2,60,100.00"\n'
        )
        second = self._stage(db, bank, overlap.encode(), name="later.csv")
        assert second.new_count == 1, "a genuine row was swallowed as a duplicate"

    @pytest.mark.parametrize(
        "ref,kept",
        [
            ("AXISP00234519", True),
            ("000000", False),
            ("------", False),
            ("NA", False),
            ("0", False),
            ("", False),
            ("CHQ123456", True),
        ],
    )
    def test_meaningful_ref(self, ref, kept):
        assert (importer.meaningful_ref(ref) is not None) is kept

    def test_occurrence_index_distinguishes_identical_rows(self):
        a = fingerprint(1, date(2026, 6, 5), -50_000, "FUEL PUMP HSR", 0)
        b = fingerprint(1, date(2026, 6, 5), -50_000, "FUEL PUMP HSR", 1)
        assert a != b

    def test_committed_rows_land_in_unassigned_or_a_rule_fund(self, db, bank):
        batch = self._stage(db, bank, HDFC_CSV.encode())
        importer.commit(db, batch)
        assert_invariant(db)

    def test_errors_do_not_block_the_good_rows(self, db, bank):
        broken = HDFC_CSV.replace("14/09/26,POS/AMAZON", "notadate,POS/AMAZON")
        batch = self._stage(db, bank, broken.encode(), name="broken.csv")
        assert batch.error_count == 1
        assert batch.new_count == 3


class TestRevert:
    def test_undo_removes_exactly_that_import(self, db, bank):
        batch = importer.stage_file(
            db, account_id=bank.id, filename="a.csv", data=HDFC_CSV.encode()
        )[0]
        importer.commit(db, batch)
        assert ledger_count(db) == 4

        result = importer.revert(db, batch)
        assert result["reverted"] == 4
        assert ledger_count(db) == 0
        assert_invariant(db)

    def test_undo_is_blocked_once_you_have_categorised_a_row(
        self, db, bank, project_fund
    ):
        from app.services import ledger as ledger_service

        batch = importer.stage_file(
            db, account_id=bank.id, filename="a.csv", data=HDFC_CSV.encode()
        )[0]
        importer.commit(db, batch)

        txn = db.query(_Transaction()).first()
        ledger_service.set_allocations(
            db, txn, [ledger_service.Split(fund_id=project_fund.id, amount=txn.amount)]
        )

        result = importer.revert(db, batch)
        assert result["reverted"] == 0
        assert result["blocked"]


def _Transaction():
    from app.models import Transaction

    return Transaction


def ledger_count(db) -> int:
    from app.models import Transaction

    return db.query(Transaction).count()
