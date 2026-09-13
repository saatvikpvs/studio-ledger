/** Mirrors the FastAPI schemas. Money is always integer paise. */

export interface Owner {
  id: number;
  email: string;
  display_name: string;
  practice_name: string;
  gstin: string | null;
  fiscal_year_start_month: number;
}

export interface Account {
  id: number;
  name: string;
  type: "bank" | "cash" | "card";
  bank_name: string | null;
  last4: string | null;
  opening_balance: number;
  opening_date: string;
  reconciled_through: string | null;
  balance: number;
}

export interface Client {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  project_count: number;
  total_received: number;
}

export interface Vendor {
  id: number;
  name: string;
  default_category_id: number | null;
  contact: string | null;
  gstin: string | null;
  match_patterns: string[];
}

export interface Category {
  id: number;
  name: string;
  scope: "project" | "personal" | "both";
  colour: string;
  is_system: boolean;
  reimbursable: boolean;
}

export interface Fund {
  id: number;
  name: string;
  kind: "project" | "personal" | "unassigned";
  project_id: number | null;
  balance: number;
}

export interface ProjectSummary {
  project_id: number;
  name: string;
  client_name: string;
  location: string | null;
  project_type: string | null;
  status: string;
  received: number;
  spent: number;
  in_hand: number;
  budget: number;
  headroom: number;
  expected_total: number;
  receivable: number;
  fee_earned: number;
  own_costs: number;
  margin: number;
  drawn: number;
  percent_of_received: number;
  percent_of_budget: number;
  alert: "warning" | "critical" | null;
}

export interface Project {
  id: number;
  code: string | null;
  name: string;
  client_id: number;
  client_name: string;
  location: string | null;
  project_type: string | null;
  start_date: string | null;
  due_date: string | null;
  budget: number;
  expected_total: number;
  fee_model: "percent_of_cost" | "lump_sum" | "none";
  fee_percent: number;
  fee_lump_sum: number;
  status: string;
  notes: string | null;
}

export interface Allocation {
  id: number;
  fund_id: number;
  fund_name: string;
  fund_kind: string;
  category_id: number | null;
  category_name: string | null;
  amount: number;
  confidence: number;
  applied_by: string;
  reason: string | null;
}

export interface Suggestion {
  fund_id: number | null;
  fund_name: string | null;
  category_id: number | null;
  category_name: string | null;
  vendor_id: number | null;
  kind: string;
  confidence: number;
  reason: string;
  auto_apply: boolean;
  rule_id: number | null;
  layer: string;
}

export interface Transaction {
  id: number;
  account_id: number;
  account_name: string;
  value_date: string;
  direction: "credit" | "debit";
  amount: number;
  signed_amount: number;
  kind: string;
  description_raw: string;
  description_norm: string;
  counterparty: string | null;
  external_ref: string | null;
  source: string;
  status: string;
  needs_review: boolean;
  allocations: Allocation[];
  suggestion: Suggestion | null;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
  sum_credit: number;
  sum_debit: number;
}

export interface Alert {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
}

export interface FundSlice {
  fund_id: number;
  name: string;
  kind: string;
  balance: number;
}

export interface DashboardSummary {
  as_of: string;
  bank_balance: number;
  client_money_held: number;
  personal_available: number;
  unassigned: number;
  total_received: number;
  project_spend: number;
  personal_spend_month: number;
  cash_in_month: number;
  cash_out_month: number;
  net_cash_month: number;
  earned_month: number;
  review_count: number;
  projects: ProjectSummary[];
  alerts: Alert[];
  fund_allocation: FundSlice[];
}

export interface MonthlyFlow {
  month: string;
  cash_in: number;
  cash_out: number;
  net: number;
}

export interface BalancePoint {
  date: string;
  balance: number;
}

export interface CategorySlice {
  category: string;
  colour: string;
  amount: number;
  count: number;
}

export interface ClientPayment {
  date: string;
  amount: number;
  project: string;
  project_id: number;
  reference: string | null;
  description: string;
}

export interface Rule {
  id: number;
  name: string;
  priority: number;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  auto_apply: boolean;
  enabled: boolean;
  match_count: number;
}

export interface StagedRow {
  id: number;
  row_index: number;
  state: "new" | "duplicate" | "possible_duplicate" | "error" | "committed";
  include: boolean;
  dup_of_txn_id: number | null;
  errors: string[];
  suggestion: Suggestion | null;
  value_date?: string;
  description?: string;
  description_norm?: string;
  direction?: "credit" | "debit";
  amount?: number;
  balance?: number | null;
  reference?: string | null;
}

export interface ImportPreview {
  batch_id: number;
  filename: string;
  status: string;
  account_id: number;
  period_start: string | null;
  period_end: string | null;
  counts: {
    total: number;
    new: number;
    duplicates: number;
    errors: number;
    auto_categorised: number;
    needs_review: number;
  };
  rows: StagedRow[];
  warnings?: string[];
  needs_mapping?: boolean;
  preview_grid?: string[][];
  columns?: string[];
  column_map?: Record<string, number>;
  header_row?: number;
}

export interface ImportBatch {
  id: number;
  filename: string;
  account_id: number;
  row_count: number;
  new_count: number;
  dup_count: number;
  error_count: number;
  status: string;
  period_start: string | null;
  period_end: string | null;
}

export interface ReportColumn {
  key: string;
  label: string;
  type?: "money";
}

export interface Report {
  key: string;
  title: string;
  generated_at: string;
  filters: Record<string, unknown>;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
  totals: Record<string, number>;
}

export interface Integrity {
  ok: boolean;
  cash_balance: number;
  fund_total: number;
  transfer_volume: number;
  problems: { type: string; [k: string]: unknown }[];
}

export interface PersonalSummary {
  fund_id: number;
  balance: number;
  spent_this_month: number;
  spent_this_fy: number;
  fiscal_year: { start: string; end: string };
  breakdown: CategorySlice[];
  monthly: MonthlyFlow[];
}

export interface Reconciliation {
  id: number;
  account_id: number;
  account_name: string;
  period_start: string;
  period_end: string;
  statement_closing_balance: number;
  calculated_balance: number;
  difference: number;
  status: string;
}

export interface FundTransfer {
  id: number;
  date: string;
  amount: number;
  reason: string;
  note: string | null;
  from_fund: string;
  to_fund: string;
}
