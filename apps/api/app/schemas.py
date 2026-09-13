"""Request and response shapes.

Money crosses the wire as an integer count of paise. JavaScript integers are
exact to 2^53, which is about 90 trillion rupees -- so this is lossless, and it
keeps every float out of the pipeline end to end.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------
# auth
# --------------------------------------------------------------------------

class LoginIn(BaseModel):
    # Plain str, not EmailStr: signing in is a lookup, not a validation. A
    # stricter type here only ever locks someone out of their own account.
    email: str
    password: str


class OwnerOut(ORM):
    id: int
    email: str
    display_name: str
    practice_name: str
    gstin: str | None = None
    fiscal_year_start_month: int


# --------------------------------------------------------------------------
# reference data
# --------------------------------------------------------------------------

class AccountIn(BaseModel):
    name: str
    type: Literal["bank", "cash", "card"] = "bank"
    bank_name: str | None = None
    last4: str | None = Field(default=None, max_length=4)
    opening_balance: int = 0
    opening_date: date


class AccountOut(ORM):
    id: int
    name: str
    type: str
    bank_name: str | None
    last4: str | None
    opening_balance: int
    opening_date: date
    reconciled_through: date | None
    balance: int = 0


class ClientIn(BaseModel):
    name: str
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    gstin: str | None = None
    notes: str | None = None


class ClientOut(ORM):
    id: int
    name: str
    phone: str | None
    email: str | None
    address: str | None
    gstin: str | None
    notes: str | None
    project_count: int = 0
    total_received: int = 0


class VendorIn(BaseModel):
    name: str
    default_category_id: int | None = None
    contact: str | None = None
    gstin: str | None = None
    match_patterns: list[str] = []


class VendorOut(ORM):
    id: int
    name: str
    default_category_id: int | None
    contact: str | None
    gstin: str | None
    match_patterns: list[str]


class CategoryIn(BaseModel):
    name: str
    scope: Literal["project", "personal", "both"] = "both"
    colour: str = "#64748b"
    reimbursable: bool = True


class CategoryOut(ORM):
    id: int
    name: str
    scope: str
    colour: str
    is_system: bool
    reimbursable: bool


class FundOut(ORM):
    id: int
    name: str
    kind: str
    project_id: int | None
    balance: int = 0


# --------------------------------------------------------------------------
# projects
# --------------------------------------------------------------------------

class ProjectIn(BaseModel):
    name: str
    client_id: int
    code: str | None = None
    location: str | None = None
    project_type: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    budget: int = 0
    expected_total: int = 0
    fee_model: Literal["percent_of_cost", "lump_sum", "none"] = "percent_of_cost"
    fee_percent: float = 8.0
    fee_lump_sum: int = 0
    status: Literal["draft", "active", "on_hold", "completed", "cancelled"] = "active"
    notes: str | None = None


class ProjectSummaryOut(BaseModel):
    project_id: int
    name: str
    client_name: str
    location: str | None
    project_type: str | None
    status: str
    received: int
    spent: int
    in_hand: int
    budget: int
    headroom: int
    expected_total: int
    receivable: int
    fee_earned: int
    own_costs: int
    margin: int
    drawn: int
    percent_of_received: float
    percent_of_budget: float
    alert: str | None


class ProjectDetailOut(BaseModel):
    project: dict[str, Any]
    summary: ProjectSummaryOut
    breakdown: list[dict[str, Any]]
    payments: list[dict[str, Any]]
    fund_id: int


# --------------------------------------------------------------------------
# transactions
# --------------------------------------------------------------------------

class SplitIn(BaseModel):
    fund_id: int
    amount: int = Field(gt=0)
    category_id: int | None = None
    vendor_id: int | None = None
    note: str | None = None


class TransactionIn(BaseModel):
    account_id: int
    value_date: date
    direction: Literal["credit", "debit"]
    amount: int = Field(gt=0, description="positive paise; sign comes from direction")
    kind: str = "uncategorised"
    description: str = ""
    external_ref: str | None = None
    notes: str | None = None
    splits: list[SplitIn] = []


class AllocationOut(BaseModel):
    id: int
    fund_id: int
    fund_name: str
    fund_kind: str
    category_id: int | None
    category_name: str | None
    amount: int
    confidence: float
    applied_by: str
    reason: str | None


class TransactionOut(BaseModel):
    id: int
    account_id: int
    account_name: str
    value_date: date
    direction: str
    amount: int
    signed_amount: int
    kind: str
    description_raw: str
    description_norm: str
    counterparty: str | None
    external_ref: str | None
    source: str
    status: str
    needs_review: bool
    allocations: list[AllocationOut]
    suggestion: dict[str, Any] | None = None


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int
    limit: int
    offset: int
    sum_credit: int
    sum_debit: int


class RecategoriseIn(BaseModel):
    kind: str | None = None
    splits: list[SplitIn]


class BulkCategoriseIn(BaseModel):
    transaction_ids: list[int]
    fund_id: int
    category_id: int | None = None
    kind: str | None = None


class FundTransferIn(BaseModel):
    from_fund_id: int
    to_fund_id: int
    amount: int = Field(gt=0)
    date: date
    reason: Literal["fee_draw", "reimbursement", "funding", "correction"] = "fee_draw"
    note: str | None = None


# --------------------------------------------------------------------------
# rules
# --------------------------------------------------------------------------

class RuleIn(BaseModel):
    name: str
    priority: int = 100
    conditions: dict[str, Any]
    actions: dict[str, Any]
    auto_apply: bool = True
    enabled: bool = True


class RuleOut(ORM):
    id: int
    name: str
    priority: int
    conditions: dict[str, Any]
    actions: dict[str, Any]
    auto_apply: bool
    enabled: bool
    match_count: int


# --------------------------------------------------------------------------
# import
# --------------------------------------------------------------------------

class MappingIn(BaseModel):
    column_map: dict[str, int]
    header_row: int


class ImportBatchOut(ORM):
    id: int
    filename: str
    account_id: int
    row_count: int
    new_count: int
    dup_count: int
    error_count: int
    status: str
    period_start: date | None
    period_end: date | None


class StagedRowPatch(BaseModel):
    include: bool | None = None
    fund_id: int | None = None
    category_id: int | None = None
    kind: str | None = None


# --------------------------------------------------------------------------
# reconciliation
# --------------------------------------------------------------------------

class ReconciliationIn(BaseModel):
    account_id: int
    period_start: date
    period_end: date
    statement_closing_balance: int
