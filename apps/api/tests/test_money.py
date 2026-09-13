from decimal import Decimal

import pytest

from app.core.money import (
    MoneyError,
    format_inr,
    split_amount,
    to_paise,
    to_rupees,
)


class TestParsing:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("1,00,000.00", 10_000_000),
            ("500000", 50_000_000),
            ("Rs. 35,000", 3_500_000),
            ("₹ 4,500.50", 450_050),
            ("4500.50 Cr", 450_050),
            ("2,000.00 Dr", 200_000),
            ("(2,000)", -200_000),
            ("0.01", 1),
            ("  1234  ", 123_400),
        ],
    )
    def test_statement_shapes(self, text, expected):
        assert to_paise(text) == expected

    def test_rejects_float(self):
        # Floats are how rounding errors get into money. Refuse them outright.
        with pytest.raises(MoneyError):
            to_paise(4500.50)

    @pytest.mark.parametrize("text", ["", "   ", "abc", "-", "."])
    def test_rejects_rubbish(self, text):
        with pytest.raises(MoneyError):
            to_paise(text)

    def test_decimal_roundtrip(self):
        assert to_paise(Decimal("1234.56")) == 123_456
        assert to_rupees(123_456) == Decimal("1234.56")


class TestFormatting:
    @pytest.mark.parametrize(
        "paise,expected",
        [
            (10_000_000, "Rs 1,00,000.00"),
            (50_000_000, "Rs 5,00,000.00"),
            (100_000, "Rs 1,000.00"),
            (-420_000, "-Rs 4,200.00"),
            (0, "Rs 0.00"),
        ],
    )
    def test_indian_grouping(self, paise, expected):
        # 5,00,000 -- not 500,000. This is the whole point.
        assert format_inr(paise) == expected

    def test_compact(self):
        assert format_inr(21_500_000, compact=True) == "Rs 2.15L"
        assert format_inr(1_200_000_000, compact=True) == "Rs 1.2Cr"

    def test_one_crore_precision(self):
        # 1,00,00,000.05 -- the value a float cannot hold.
        paise = to_paise("1,00,00,000.05")
        assert paise == 1_000_000_005
        assert format_inr(paise) == "Rs 1,00,00,000.05"


class TestSplitting:
    def test_three_way_split_loses_nothing(self):
        parts = split_amount(10_000, [1, 1, 1])
        assert sum(parts) == 10_000
        assert sorted(parts) == [3333, 3333, 3334]

    def test_weighted_split(self):
        parts = split_amount(100_000, [3, 1])
        assert sum(parts) == 100_000
        assert parts == [75_000, 25_000]

    @pytest.mark.parametrize(
        "total,weights",
        [
            (1, [1, 1, 1]),
            (7, [2, 3, 5]),
            (999_999, [1, 1, 1, 1, 1, 1, 1]),
            (100, [1]),
        ],
    )
    def test_always_sums_exactly(self, total, weights):
        assert sum(split_amount(total, weights)) == total

    def test_rejects_zero_weights(self):
        with pytest.raises(MoneyError):
            split_amount(100, [0, 0])
