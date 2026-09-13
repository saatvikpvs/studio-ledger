"""Suggesting a classification for a bank row.

Layered, evaluated in order, stopping at the first confident answer. Every
layer is explainable -- the UI always shows *why*, because an unexplained
suggestion gets distrusted and then ignored.

One deliberate asymmetry runs through this module: rules can confidently infer
a *category* ("ABC Cement" is always Materials) but rarely a *project*, because
the same supplier serves every site. Getting a project wrong corrupts a
client-facing number, so the engine fills in category confidently and leaves
the fund alone unless it is genuinely sure.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Allocation,
    Category,
    Direction,
    Fund,
    FundKind,
    Rule,
    Transaction,
    TxnKind,
    Vendor,
)

#: Layer 4. Deliberately small and boring -- it exists to stop the review queue
#: filling with obvious rows, not to be clever.
SEED_TERMS: list[tuple[str, str, str]] = [
    # (pattern, category name, transaction kind)
    (r"SWIGGY|ZOMATO|DOMINO|STARBUCKS|CAFE|RESTAURANT|BLINKIT|ZEPTO|BIGBASKET",
     "Food", TxnKind.personal_spend.value),
    (r"AMAZON|FLIPKART|MYNTRA|AJIO|RELIANCE TRENDS|LIFESTYLE|SHOPPERS",
     "Shopping", TxnKind.personal_spend.value),
    (r"UBER|OLA|RAPIDO|IRCTC|INDIGO|AIR INDIA|VISTARA|MAKEMYTRIP|REDBUS|FUEL|PETROL|HPCL|IOCL|BPCL",
     "Travel", TxnKind.personal_spend.value),
    (r"NETFLIX|SPOTIFY|PRIME VIDEO|HOTSTAR|YOUTUBE PREMIUM|ICLOUD|GOOGLE ONE",
     "Subscriptions", TxnKind.personal_spend.value),
    (r"ELECTRICITY|BESCOM|BSES|TNEB|WATER BOARD|GAS|AIRTEL|JIO|VODAFONE|BROADBAND|ACT FIBER",
     "Bills", TxnKind.personal_spend.value),
    (r"RENT", "Rent", TxnKind.personal_spend.value),
    (r"CEMENT|STEEL|TMT|SAND|AGGREGATE|BRICK|PLY|PLYWOOD|TILES|PAINT|ASIAN PAINTS|HARDWARE|SANITARY",
     "Materials", TxnKind.vendor_payment.value),
    (r"ELECTRICAL|WIRE|HAVELLS|ANCHOR|LEGRAND|SWITCHGEAR",
     "Electrical", TxnKind.vendor_payment.value),
    (r"PLUMB|JAQUAR|CERA|PIPE|CPVC", "Plumbing", TxnKind.vendor_payment.value),
    (r"LABOUR|LABOR|MASON|CARPENTER|PAINTER|WELDER",
     "Labour", TxnKind.vendor_payment.value),
    (r"CONTRACTOR|CONSTRUCTION|BUILDERS", "Contractor", TxnKind.vendor_payment.value),
    (r"FURNITURE|GODREJ INTERIO|IKEA|PEPPERFRY", "Furniture", TxnKind.vendor_payment.value),
    (r"AUTODESK|ADOBE|SKETCHUP|RHINO|LUMION|MICROSOFT|FIGMA|DROPBOX",
     "Software", TxnKind.vendor_payment.value),
    (r"PRINT|XEROX|BLUEPRINT|PLOTTER|STATIONERY", "Printing", TxnKind.vendor_payment.value),
    (r"BMC|BBMP|MUNICIPAL|PANCHAYAT|REGISTRAR|STAMP DUTY|BWSSB",
     "Government fees", TxnKind.vendor_payment.value),
    (r"STRUCTURAL|CONSULTANT|SURVEY|SOIL TEST|GEOTECH",
     "Consultant", TxnKind.vendor_payment.value),
    (r"BANK CHARGE|SERVICE CHARGE|SMS CHARGE|ANNUAL FEE|GST ON",
     "Bank charges", TxnKind.bank_charge.value),
    (r"INTEREST CREDIT|INT\.PD|SAVINGS INTEREST", "Interest", TxnKind.interest.value),
]

_COMPILED_SEED = [(re.compile(p), cat, kind) for p, cat, kind in SEED_TERMS]


@dataclass(slots=True)
class Suggestion:
    fund_id: int | None = None
    fund_name: str | None = None
    category_id: int | None = None
    category_name: str | None = None
    vendor_id: int | None = None
    kind: str = TxnKind.uncategorised.value
    confidence: float = 0.0
    reason: str = ""
    auto_apply: bool = False
    rule_id: int | None = None
    layer: str = "none"

    def as_dict(self) -> dict:
        return {
            "fund_id": self.fund_id,
            "fund_name": self.fund_name,
            "category_id": self.category_id,
            "category_name": self.category_name,
            "vendor_id": self.vendor_id,
            "kind": self.kind,
            "confidence": round(self.confidence, 2),
            "reason": self.reason,
            "auto_apply": self.auto_apply,
            "rule_id": self.rule_id,
            "layer": self.layer,
        }


@dataclass(slots=True)
class Candidate:
    """The minimum a classifier needs to see. Works for staged rows and saved ones."""

    description_norm: str
    direction: str
    amount: int
    vpa: str | None = None
    raw: str = ""
    extras: dict = field(default_factory=dict)


def classify(db: Session, candidate: Candidate) -> Suggestion:
    for layer in (_layer_rules, _layer_memory, _layer_vendor, _layer_seed, _layer_heuristic):
        suggestion = layer(db, candidate)
        if suggestion is not None:
            _decorate(db, suggestion)
            return suggestion
    return Suggestion(reason="No match -- needs review", layer="none")


# ---------------------------------------------------------------------------
# layer 1 -- explicit user rules
# ---------------------------------------------------------------------------

def _layer_rules(db: Session, c: Candidate) -> Suggestion | None:
    rules = db.scalars(
        select(Rule).where(Rule.enabled.is_(True)).order_by(Rule.priority, Rule.id)
    )
    for rule in rules:
        if not rule_matches(rule, c):
            continue
        actions = rule.actions or {}
        rule.match_count += 1
        rule.last_matched_at = datetime.utcnow()
        return Suggestion(
            fund_id=actions.get("fund_id"),
            category_id=actions.get("category_id"),
            vendor_id=actions.get("vendor_id"),
            kind=actions.get("kind", TxnKind.uncategorised.value),
            confidence=1.0,
            reason=f"Matched your rule “{rule.name}”",
            auto_apply=bool(rule.auto_apply),
            rule_id=rule.id,
            layer="rule",
        )
    return None


def rule_matches(rule: Rule, c: Candidate) -> bool:
    cond = rule.conditions or {}
    text = (c.description_norm or "").upper()

    if (needle := cond.get("description_contains")):
        if needle.upper() not in text:
            return False
    if (pattern := cond.get("description_regex")):
        try:
            if not re.search(pattern, text, re.IGNORECASE):
                return False
        except re.error:
            return False
    if (vpa := cond.get("vpa")) and (c.vpa or "").lower() != vpa.lower():
        return False
    if (direction := cond.get("direction")) and direction != c.direction:
        return False
    if (lo := cond.get("amount_min")) is not None and c.amount < lo:
        return False
    if (hi := cond.get("amount_max")) is not None and c.amount > hi:
        return False
    return bool(cond)


# ---------------------------------------------------------------------------
# layer 2 -- what the user did last time
# ---------------------------------------------------------------------------

def _layer_memory(db: Session, c: Candidate) -> Suggestion | None:
    """The strongest real signal: how he classified this exact merchant before."""
    q = (
        select(Allocation, Transaction)
        .join(Transaction, Allocation.transaction_id == Transaction.id)
        .where(
            Allocation.applied_by.in_(("user", "rule")),
            Allocation.category_id.is_not(None),
        )
    )
    if c.vpa:
        q = q.where(Transaction.vpa == c.vpa)
    elif c.description_norm:
        q = q.where(Transaction.description_norm == c.description_norm)
    else:
        return None

    rows = list(db.execute(q))
    if not rows:
        return None

    by_category: dict[int, int] = {}
    by_fund: dict[int, int] = {}
    kinds: dict[str, int] = {}
    for alloc, txn in rows:
        by_category[alloc.category_id] = by_category.get(alloc.category_id, 0) + 1
        by_fund[alloc.fund_id] = by_fund.get(alloc.fund_id, 0) + 1
        kinds[txn.kind] = kinds.get(txn.kind, 0) + 1

    top_category = max(by_category, key=by_category.get)
    hits = by_category[top_category]
    top_fund, fund_hits = max(by_fund.items(), key=lambda kv: kv[1])
    top_kind = max(kinds, key=kinds.get)

    fund = db.get(Fund, top_fund)
    # Only reuse the fund when it is unambiguous *and* not a project bucket --
    # the same vendor legitimately serves several sites.
    reuse_fund = fund_hits == len(rows) and fund is not None and (
        fund.kind != FundKind.project.value or len(by_fund) == 1 and hits >= 3
    )

    return Suggestion(
        fund_id=top_fund if reuse_fund else None,
        category_id=top_category,
        kind=top_kind,
        confidence=0.95 if hits >= 5 else 0.8,
        reason=f"You categorised this {hits} time{'s' if hits > 1 else ''} before",
        auto_apply=hits >= 5,
        layer="memory",
    )


# ---------------------------------------------------------------------------
# layer 3 -- known vendors
# ---------------------------------------------------------------------------

def _layer_vendor(db: Session, c: Candidate) -> Suggestion | None:
    text = (c.description_norm or "").upper()
    if not text:
        return None

    for vendor in db.scalars(select(Vendor)):
        patterns = list(vendor.match_patterns or []) + [vendor.name]
        for pattern in patterns:
            if pattern and pattern.upper() in text:
                return Suggestion(
                    category_id=vendor.default_category_id,
                    vendor_id=vendor.id,
                    kind=TxnKind.vendor_payment.value
                    if c.direction == Direction.debit.value
                    else TxnKind.refund_in.value,
                    confidence=0.85,
                    reason=f"Known vendor “{vendor.name}”",
                    auto_apply=False,
                    layer="vendor",
                )
    return None


# ---------------------------------------------------------------------------
# layer 4 -- seed dictionary
# ---------------------------------------------------------------------------

def _layer_seed(db: Session, c: Candidate) -> Suggestion | None:
    text = (c.description_norm or "").upper()
    if not text:
        return None

    for pattern, category_name, kind in _COMPILED_SEED:
        if not pattern.search(text):
            continue
        category = db.scalar(select(Category).where(Category.name == category_name))
        fund_id = None
        if kind in (TxnKind.personal_spend.value, TxnKind.bank_charge.value,
                    TxnKind.interest.value):
            fund = db.scalar(select(Fund).where(Fund.kind == FundKind.personal.value))
            fund_id = fund.id if fund else None
        return Suggestion(
            fund_id=fund_id,
            category_id=category.id if category else None,
            kind=kind,
            confidence=0.6,
            reason=f"Looks like {category_name.lower()}",
            auto_apply=False,
            layer="seed",
        )
    return None


# ---------------------------------------------------------------------------
# layer 5 -- shape heuristics
# ---------------------------------------------------------------------------

def _layer_heuristic(db: Session, c: Candidate) -> Suggestion | None:
    """Large round credits are almost always a client advance -- but which
    project is anybody's guess, so we say so rather than pick one."""
    if c.direction != Direction.credit.value:
        return None
    if c.amount < 5_000_000:  # below Rs 50,000
        return None
    if c.amount % 100_000 != 0:  # not a round thousand rupees
        return None
    return Suggestion(
        kind=TxnKind.client_payment.value,
        confidence=0.4,
        reason="Large round credit — likely a client payment. Pick the project.",
        auto_apply=False,
        layer="heuristic",
    )


def _decorate(db: Session, s: Suggestion) -> None:
    if s.fund_id:
        fund = db.get(Fund, s.fund_id)
        s.fund_name = fund.name if fund else None
    if s.category_id:
        category = db.get(Category, s.category_id)
        s.category_name = category.name if category else None


# ---------------------------------------------------------------------------
# retroactive application
# ---------------------------------------------------------------------------

def matching_transactions(db: Session, rule: Rule) -> list[Transaction]:
    """Which past rows a rule would have caught -- powers 'apply to 23 past ones?'"""
    out = []
    for txn in db.scalars(select(Transaction).order_by(Transaction.value_date.desc())):
        candidate = Candidate(
            description_norm=txn.description_norm,
            direction=txn.direction,
            amount=txn.amount,
            vpa=txn.vpa,
            raw=txn.description_raw,
        )
        if rule_matches(rule, candidate):
            out.append(txn)
    return out
