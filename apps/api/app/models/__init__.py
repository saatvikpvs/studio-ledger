"""The schema.

Two planes over one bank account (see the architecture doc, section 0):

  * ``Transaction``  -- the CASH plane. One row per real bank movement.
  * ``Allocation``   -- the ATTRIBUTION plane. What that money meant.

Invariant, enforced in ``services/ledger.py`` and checked by
``/api/v1/health/integrity``:

    sum(allocation.amount for a transaction) == transaction.amount
    sum(all fund balances) == sum(all account balances)

Money is always BIGINT paise. Never a float, never a Decimal column.
"""

from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.db import Base


# --------------------------------------------------------------------------
# enums (stored as plain strings -- portable, and readable in a DB browser)
# --------------------------------------------------------------------------

class Direction(str, enum.Enum):
    credit = "credit"
    debit = "debit"


class TxnKind(str, enum.Enum):
    """What a movement *means*. Orthogonal to direction and to fund."""

    client_payment = "client_payment"        # advance / milestone from a client
    vendor_payment = "vendor_payment"        # money out to a supplier or contractor
    refund_in = "refund_in"                  # vendor returned money
    refund_out = "refund_out"                # we returned money to a client
    personal_income = "personal_income"      # rent, salary, teaching, interest
    personal_spend = "personal_spend"
    owner_contribution = "owner_contribution"  # own money put into the practice
    account_transfer = "account_transfer"    # between the owner's own accounts
    bank_charge = "bank_charge"
    interest = "interest"
    tax_payment = "tax_payment"
    opening_balance = "opening_balance"
    uncategorised = "uncategorised"


#: Kinds that never count as income or expense in any report.
NEUTRAL_KINDS = {TxnKind.account_transfer, TxnKind.opening_balance}

#: Debit kinds that count as project spend.
SPEND_KINDS = {TxnKind.vendor_payment, TxnKind.tax_payment}


class FundKind(str, enum.Enum):
    project = "project"
    personal = "personal"
    unassigned = "unassigned"


class ProjectStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    on_hold = "on_hold"
    completed = "completed"
    cancelled = "cancelled"


class FeeModel(str, enum.Enum):
    percent_of_cost = "percent_of_cost"
    lump_sum = "lump_sum"
    none = "none"


class AccountType(str, enum.Enum):
    bank = "bank"
    cash = "cash"
    card = "card"


class TxnStatus(str, enum.Enum):
    posted = "posted"
    void = "void"


class TransferReason(str, enum.Enum):
    fee_draw = "fee_draw"
    reimbursement = "reimbursement"
    funding = "funding"
    correction = "correction"


class StagedState(str, enum.Enum):
    new = "new"
    duplicate = "duplicate"
    possible_duplicate = "possible_duplicate"
    error = "error"
    committed = "committed"


class BatchStatus(str, enum.Enum):
    staged = "staged"
    committed = "committed"
    reverted = "reverted"


class AppliedBy(str, enum.Enum):
    user = "user"
    rule = "rule"
    auto = "auto"
    system = "system"


# --------------------------------------------------------------------------
# mixins
# --------------------------------------------------------------------------

class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


# --------------------------------------------------------------------------
# people & structure
# --------------------------------------------------------------------------

class Owner(Base, TimestampMixin):
    __tablename__ = "owner"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(120), default="")
    practice_name: Mapped[str] = mapped_column(String(160), default="")
    gstin: Mapped[str | None] = mapped_column(String(20))
    fiscal_year_start_month: Mapped[int] = mapped_column(Integer, default=4)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Account(Base, TimestampMixin):
    """A real place money sits. Never stores a full account number."""

    __tablename__ = "account"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(16), default=AccountType.bank.value)
    bank_name: Mapped[str | None] = mapped_column(String(120))
    last4: Mapped[str | None] = mapped_column(String(4))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    #: The figure entered at setup, kept for reference only. The balance is
    #: computed from transactions -- creating an account posts an
    #: ``opening_balance`` transaction so the money has an attribution.
    #: Do NOT add this back into balance arithmetic.
    opening_balance: Mapped[int] = mapped_column(BigInteger, default=0)
    opening_date: Mapped[date] = mapped_column(Date, default=date.today)
    reconciled_through: Mapped[date | None] = mapped_column(Date)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)

    transactions: Mapped[list[Transaction]] = relationship(back_populates="account")


class Client(Base, TimestampMixin):
    __tablename__ = "client"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    gstin: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(Text)

    projects: Mapped[list[Project]] = relationship(back_populates="client")


class Vendor(Base, TimestampMixin):
    """Suppliers and contractors. ``match_patterns`` feeds the classifier."""

    __tablename__ = "vendor"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    default_category_id: Mapped[int | None] = mapped_column(ForeignKey("category.id"))
    contact: Mapped[str | None] = mapped_column(String(160))
    gstin: Mapped[str | None] = mapped_column(String(20))
    match_patterns: Mapped[list] = mapped_column(JSON, default=list)


class Category(Base, TimestampMixin):
    __tablename__ = "category"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    scope: Mapped[str] = mapped_column(String(16), default="both")  # project|personal|both
    colour: Mapped[str] = mapped_column(String(9), default="#64748b")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    #: False for costs the practice bears itself (software, printing, its own
    #: consultants). Those reduce the fee; reimbursable costs pass through to
    #: the client and do not.
    reimbursable: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (UniqueConstraint("name", "scope", name="uq_category_name_scope"),)


class Project(Base, TimestampMixin):
    __tablename__ = "project"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str | None] = mapped_column(String(24))
    name: Mapped[str] = mapped_column(String(160), index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("client.id"))
    location: Mapped[str | None] = mapped_column(String(160))
    project_type: Mapped[str | None] = mapped_column(String(80))
    start_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)

    budget: Mapped[int] = mapped_column(BigInteger, default=0)
    expected_total: Mapped[int] = mapped_column(BigInteger, default=0)

    # Correction 1 from the architecture doc: an advance is not income.
    # The fee is what the architect actually earns.
    fee_model: Mapped[str] = mapped_column(String(24), default=FeeModel.percent_of_cost.value)
    fee_percent: Mapped[float] = mapped_column(Float, default=8.0)
    fee_lump_sum: Mapped[int] = mapped_column(BigInteger, default=0)

    status: Mapped[str] = mapped_column(String(16), default=ProjectStatus.active.value)
    notes: Mapped[str | None] = mapped_column(Text)

    client: Mapped[Client] = relationship(back_populates="projects")
    fund: Mapped[Fund] = relationship(back_populates="project", uselist=False)


class Fund(Base, TimestampMixin):
    """A bucket on the attribution plane. Not a bank account."""

    __tablename__ = "fund"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(160))
    project_id: Mapped[int | None] = mapped_column(ForeignKey("project.id"), unique=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)

    project: Mapped[Project | None] = relationship(back_populates="fund")


# --------------------------------------------------------------------------
# the cash plane
# --------------------------------------------------------------------------

class Transaction(Base, TimestampMixin):
    __tablename__ = "transaction"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), index=True)

    value_date: Mapped[date] = mapped_column(Date, index=True)
    posted_date: Mapped[date | None] = mapped_column(Date)

    direction: Mapped[str] = mapped_column(String(8))
    amount: Mapped[int] = mapped_column(BigInteger)  # always positive paise
    kind: Mapped[str] = mapped_column(String(24), default=TxnKind.uncategorised.value)

    description_raw: Mapped[str] = mapped_column(Text, default="")
    description_norm: Mapped[str] = mapped_column(String(255), default="", index=True)
    counterparty: Mapped[str | None] = mapped_column(String(160))
    vpa: Mapped[str | None] = mapped_column(String(160), index=True)
    external_ref: Mapped[str | None] = mapped_column(String(80))
    running_balance: Mapped[int | None] = mapped_column(BigInteger)

    source: Mapped[str] = mapped_column(String(16), default="manual")
    import_batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batch.id"))
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)

    status: Mapped[str] = mapped_column(String(8), default=TxnStatus.posted.value)
    void_of_id: Mapped[int | None] = mapped_column(ForeignKey("transaction.id"))
    notes: Mapped[str | None] = mapped_column(Text)

    account: Mapped[Account] = relationship(back_populates="transactions")
    allocations: Mapped[list[Allocation]] = relationship(
        back_populates="transaction", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_txn_amount_positive"),
        UniqueConstraint("account_id", "fingerprint", name="uq_txn_account_fingerprint"),
        Index("ix_txn_account_date", "account_id", "value_date"),
    )

    @property
    def signed_amount(self) -> int:
        if self.status == TxnStatus.void.value:
            return 0
        return self.amount if self.direction == Direction.credit.value else -self.amount


# --------------------------------------------------------------------------
# the attribution plane
# --------------------------------------------------------------------------

class Allocation(Base, TimestampMixin):
    """Ties a slice of a transaction to exactly one fund.

    Allocations for a transaction must sum to its amount. Anything the user has
    not classified sits against the Unassigned fund -- never against NULL. That
    is what keeps ``sum(funds) == sum(accounts)`` true at every instant.
    """

    __tablename__ = "allocation"

    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transaction.id", ondelete="CASCADE"), index=True
    )
    fund_id: Mapped[int] = mapped_column(ForeignKey("fund.id"), index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("category.id"))
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendor.id"))

    amount: Mapped[int] = mapped_column(BigInteger)  # positive paise
    note: Mapped[str | None] = mapped_column(Text)

    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    applied_by: Mapped[str] = mapped_column(String(8), default=AppliedBy.user.value)
    rule_id: Mapped[int | None] = mapped_column(ForeignKey("rule.id"))
    reason: Mapped[str | None] = mapped_column(String(255))

    transaction: Mapped[Transaction] = relationship(back_populates="allocations")
    fund: Mapped[Fund] = relationship()
    category: Mapped[Category | None] = relationship()

    __table_args__ = (CheckConstraint("amount > 0", name="ck_alloc_amount_positive"),)


class FundTransfer(Base, TimestampMixin):
    """Moves money between funds. Touches no bank account.

    This is how a fee draw works: project fund -> personal fund, no cash event.
    Never counted as income or as expense anywhere.
    """

    __tablename__ = "fund_transfer"

    id: Mapped[int] = mapped_column(primary_key=True)
    from_fund_id: Mapped[int] = mapped_column(ForeignKey("fund.id"), index=True)
    to_fund_id: Mapped[int] = mapped_column(ForeignKey("fund.id"), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)
    date: Mapped[date] = mapped_column(Date, default=date.today, index=True)
    reason: Mapped[str] = mapped_column(String(24), default=TransferReason.fee_draw.value)
    note: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_transfer_amount_positive"),
        CheckConstraint("from_fund_id <> to_fund_id", name="ck_transfer_distinct_funds"),
    )


# --------------------------------------------------------------------------
# ingest
# --------------------------------------------------------------------------

class ImportBatch(Base, TimestampMixin):
    __tablename__ = "import_batch"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"))
    filename: Mapped[str] = mapped_column(String(255))
    file_sha256: Mapped[str] = mapped_column(String(64), index=True)
    profile_name: Mapped[str | None] = mapped_column(String(80))
    source: Mapped[str] = mapped_column(String(16), default="file")

    row_count: Mapped[int] = mapped_column(Integer, default=0)
    new_count: Mapped[int] = mapped_column(Integer, default=0)
    dup_count: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)

    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(12), default=BatchStatus.staged.value)

    rows: Mapped[list[StagedRow]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )


class StagedRow(Base):
    """Nothing reaches the ledger until the user commits the batch."""

    __tablename__ = "staged_row"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("import_batch.id", ondelete="CASCADE"), index=True
    )
    row_index: Mapped[int] = mapped_column(Integer)
    raw: Mapped[dict] = mapped_column(JSON, default=dict)
    parsed: Mapped[dict] = mapped_column(JSON, default=dict)
    fingerprint: Mapped[str | None] = mapped_column(String(64))
    dup_of_txn_id: Mapped[int | None] = mapped_column(ForeignKey("transaction.id"))
    state: Mapped[str] = mapped_column(String(20), default=StagedState.new.value)
    suggestion: Mapped[dict] = mapped_column(JSON, default=dict)
    errors: Mapped[list] = mapped_column(JSON, default=list)
    include: Mapped[bool] = mapped_column(Boolean, default=True)

    batch: Mapped[ImportBatch] = relationship(back_populates="rows")


class BankProfile(Base, TimestampMixin):
    """Column mapping for one bank's statement layout."""

    __tablename__ = "bank_profile"

    id: Mapped[int] = mapped_column(primary_key=True)
    bank_name: Mapped[str] = mapped_column(String(120), unique=True)
    detection: Mapped[dict] = mapped_column(JSON, default=dict)
    column_map: Mapped[dict] = mapped_column(JSON, default=dict)
    date_formats: Mapped[list] = mapped_column(JSON, default=list)
    amount_convention: Mapped[str] = mapped_column(String(24), default="dual_column")
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)


class Rule(Base, TimestampMixin):
    __tablename__ = "rule"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    priority: Mapped[int] = mapped_column(Integer, default=100, index=True)
    conditions: Mapped[dict] = mapped_column(JSON, default=dict)
    actions: Mapped[dict] = mapped_column(JSON, default=dict)
    auto_apply: Mapped[bool] = mapped_column(Boolean, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    match_count: Mapped[int] = mapped_column(Integer, default=0)
    last_matched_at: Mapped[datetime | None] = mapped_column(DateTime)


# --------------------------------------------------------------------------
# assurance
# --------------------------------------------------------------------------

class Reconciliation(Base, TimestampMixin):
    __tablename__ = "reconciliation"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    statement_closing_balance: Mapped[int] = mapped_column(BigInteger)
    calculated_balance: Mapped[int] = mapped_column(BigInteger, default=0)
    difference: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(String(12), default="open")
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)


class Attachment(Base, TimestampMixin):
    __tablename__ = "attachment"

    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int | None] = mapped_column(ForeignKey("transaction.id"))
    project_id: Mapped[int | None] = mapped_column(ForeignKey("project.id"))
    stored_name: Mapped[str] = mapped_column(String(255))
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(120))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))


class AuditLog(Base):
    """Append-only. Every mutation of money lands here."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("owner.id"))
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(40))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
