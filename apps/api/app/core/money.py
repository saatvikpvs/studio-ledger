"""Money handling.

One rule, enforced everywhere: money is an integer count of paise. No float ever
touches a monetary value -- not in the database, not in Python, not in JSON.

Rupees exist only at two boundaries: parsing a bank statement (string -> paise)
and rendering in the UI (paise -> string). Both live here.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

Paise = int

#: The first number-shaped run in the text. Extracting beats stripping:
#: deleting non-digits turned "Rs. 35,000" into ".35000" -- 35 paise.
_NUMBER = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
_DR_CR = re.compile(r"\b(CR|DR)\b\.?\s*$", re.IGNORECASE)


class MoneyError(ValueError):
    pass


def to_paise(value: str | int | float | Decimal) -> Paise:
    """Parse a human/statement amount into paise.

    Handles the shapes Indian bank statements actually use::

        "1,00,000.00"   -> 10000000
        "Rs. 35,000"    -> 3500000
        "4500.50 Cr"    -> 450050   (sign is the caller's job, not ours)
        "(2,000)"       -> -200000
    """
    if isinstance(value, int):
        return value * 100
    if isinstance(value, Decimal):
        return int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if isinstance(value, float):
        raise MoneyError("refusing to parse a float as money; pass str or Decimal")

    text = str(value).strip()
    if not text:
        raise MoneyError("empty amount")

    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]

    text = _DR_CR.sub("", text).strip()
    match = _NUMBER.search(text)
    if match is None:
        raise MoneyError(f"not an amount: {value!r}")

    try:
        amount = Decimal(match.group(0).replace(",", ""))
    except InvalidOperation as exc:  # pragma: no cover - defensive
        raise MoneyError(f"not an amount: {value!r}") from exc

    paise = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return -paise if negative else paise


def to_rupees(paise: Paise) -> Decimal:
    """Exact Decimal rupees, for reports and exports."""
    return (Decimal(paise) / Decimal(100)).quantize(Decimal("0.01"))


def format_inr(paise: Paise, *, compact: bool = False) -> str:
    """Indian-grouped display string. ``compact`` gives the lakh/crore short form."""
    sign = "-" if paise < 0 else ""
    n = abs(paise)

    if compact:
        if n >= 10_000_000_00:  # >= 1 crore
            return f"{sign}Rs {_trim(Decimal(n) / Decimal(10_000_000_00))}Cr"
        if n >= 100_000_00:  # >= 1 lakh
            return f"{sign}Rs {_trim(Decimal(n) / Decimal(100_000_00))}L"
        if n >= 1_000_00:
            return f"{sign}Rs {_trim(Decimal(n) / Decimal(1_000_00))}K"

    whole, frac = divmod(n, 100)
    return f"{sign}Rs {_group_indian(whole)}.{frac:02d}"


def _trim(d: Decimal) -> str:
    return f"{d.quantize(Decimal('0.01')).normalize():f}"


def _group_indian(n: int) -> str:
    """12345678 -> '1,23,45,678' (last group of 3, then groups of 2)."""
    s = str(n)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + tail


def split_amount(total: Paise, weights: list[int]) -> list[Paise]:
    """Split ``total`` proportionally so the parts sum to it *exactly*.

    Uses largest-remainder: splitting 10000 paise three ways gives
    [3334, 3333, 3333], never three lots of 3333 that lose a paisa.
    """
    if not weights:
        raise MoneyError("no weights to split across")
    if any(w < 0 for w in weights):
        raise MoneyError("negative weight")
    total_weight = sum(weights)
    if total_weight == 0:
        raise MoneyError("weights sum to zero")

    raw = [(total * w, w) for w in weights]
    floors = [r // total_weight for r, _ in raw]
    remainder = total - sum(floors)

    order = sorted(
        range(len(weights)),
        key=lambda i: (raw[i][0] % total_weight),
        reverse=True,
    )
    for k in range(abs(remainder)):
        floors[order[k % len(order)]] += 1 if remainder > 0 else -1
    return floors
