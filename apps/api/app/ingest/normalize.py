"""Turning bank narration into something matchable.

This is the highest-leverage piece of the classifier and the part naive
implementations skip. Raw Indian bank descriptions are mostly channel noise::

    UPI/DR/425719836104/ABC CEMENT AND ST/HDFC/abccement@okaxis/Pay
      -> norm "ABC CEMENT AND ST", vpa "abccement@okaxis"

    NEFT-AXISP00234519-RAO SUDHIR-HDFC0000123-PAYMENT
      -> norm "RAO SUDHIR", ref "AXISP00234519"

Matching on the normalised form instead of the raw string is the difference
between a classifier that works and one that does not.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

CHANNELS = (
    "UPI", "NEFT", "RTGS", "IMPS", "ACH", "ECS", "NACH", "POS", "ATM", "ATW",
    "MMT", "INF", "BIL", "TPT", "CHQ", "CMS", "EDC", "VPS", "SI", "CC", "DC",
)

_IFSC = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")
_VPA = re.compile(r"\b([a-zA-Z0-9._-]{2,})@([a-zA-Z]{2,})\b")
_LONG_DIGITS = re.compile(r"\b\d{6,}\b")
_REF_TOKEN = re.compile(r"\b[A-Z]{2,6}[A-Z0-9]{6,}\b")
_DATE_ISH = re.compile(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b")
_PUNCT_RUN = re.compile(r"[/\\|,;:_*#~\-]{1,}")
_SPACE = re.compile(r"\s+")
#: Wallet statements name the counterparty in a sentence: "Paid to X",
#: "Received from Y". The verb is noise -- X is the identity the classifier and
#: the review screen's merchant grouping both need.
_LEAD_PHRASE = re.compile(
    r"^(PAID TO|RECEIVED FROM|MONEY SENT TO|MONEY RECEIVED FROM|SENT TO|"
    r"PAYMENT TO|PAYMENT FROM|REFUND FROM|TRANSFER TO|TRANSFER FROM)\s+"
)
_TRAILING_BANK = re.compile(
    r"\b(HDFC|ICICI|SBIN?|AXIS|KOTAK|YESB|IDFC|PYTM|OKAXIS|OKHDFCBANK|OKICICI|"
    r"OKSBI|IBKL|PUNB|CNRB|UBIN|BARB)\b"
)


@dataclass(slots=True)
class ParsedNarration:
    normalised: str
    vpa: str | None
    reference: str | None
    counterparty: str | None


def parse_narration(raw: str) -> ParsedNarration:
    text = (raw or "").strip()
    if not text:
        return ParsedNarration("", None, None, None)

    upper = text.upper()

    vpa_match = _VPA.search(text)
    vpa = vpa_match.group(0).lower() if vpa_match else None

    working = _IFSC.sub(" ", upper)
    if vpa_match:
        working = working.replace(vpa_match.group(0).upper(), " ")

    # Pull a reference token out before we strip digits, so we keep the UTR.
    reference = None
    for candidate in _REF_TOKEN.findall(working):
        if candidate not in CHANNELS and not candidate.isalpha():
            reference = candidate
            break
    if reference is None:
        digits = _LONG_DIGITS.findall(working)
        if digits:
            reference = max(digits, key=len)

    working = _DATE_ISH.sub(" ", working)
    working = _LONG_DIGITS.sub(" ", working)
    working = _PUNCT_RUN.sub(" ", working)

    tokens = [t for t in _SPACE.split(working) if t]

    # Drop leading channel markers and direction flags.
    while tokens and (tokens[0] in CHANNELS or tokens[0] in {"DR", "CR", "TO", "FROM", "BY"}):
        tokens.pop(0)

    tokens = [
        t
        for t in tokens
        if t not in CHANNELS
        and not _TRAILING_BANK.fullmatch(t)
        and t not in {"PAY", "PAYMENT", "TRANSFER", "TRF", "REF", "DR", "CR"}
        and not (t.isdigit() and len(t) > 3)
    ]

    normalised = " ".join(tokens).strip()
    normalised = _LEAD_PHRASE.sub("", normalised).strip()[:255]
    if not normalised and vpa:
        normalised = vpa.split("@")[0].upper()
    if not normalised:
        normalised = _SPACE.sub(" ", upper)[:255]

    counterparty = normalised or None
    return ParsedNarration(normalised, vpa, reference, counterparty)


def fingerprint(
    account_id: int,
    value_date,
    signed_amount: int,
    description_norm: str,
    occurrence_index: int = 0,
) -> str:
    """Stable identity for a bank row.

    ``occurrence_index`` is what makes this safe. Two 500-rupee fuel fills at the
    same pump on the same day are legitimately identical and both real; without a
    counter, hard dedupe silently eats the second one and the ledger quietly
    stops matching the bank -- the worst failure mode, because it looks fine.
    """
    payload = "␟".join(
        [
            str(account_id),
            value_date.isoformat(),
            str(signed_amount),
            description_norm.upper(),
            str(occurrence_index),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
