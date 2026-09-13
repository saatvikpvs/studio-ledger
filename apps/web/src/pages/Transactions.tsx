import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Money,
  PageHeader,
  Skeleton,
  Td,
  Th,
  cx,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDate, humanise, rupeesToPaise } from "../lib/money";
import type {
  Account,
  Category,
  Fund,
  Transaction,
  TransactionPage,
} from "../lib/types";

const KINDS = [
  "client_payment",
  "vendor_payment",
  "refund_in",
  "refund_out",
  "personal_income",
  "personal_spend",
  "owner_contribution",
  "account_transfer",
  "bank_charge",
  "interest",
  "tax_payment",
];

export default function Transactions() {
  // Filters live in the URL so every view is linkable and Back behaves.
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);

  const filters = {
    q: params.get("q") ?? "",
    fund_id: params.get("fund_id") ?? "",
    direction: params.get("direction") ?? "",
    kind: params.get("kind") ?? "",
    date_from: params.get("date_from") ?? "",
    date_to: params.get("date_to") ?? "",
  };

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };

  const page = useQuery<TransactionPage>({
    queryKey: ["transactions", filters],
    queryFn: () => api.get<TransactionPage>("/transactions", { ...filters, limit: 200 }),
  });

  const funds = useQuery<Fund[]>({
    queryKey: ["funds"],
    queryFn: () => api.get<Fund[]>("/funds"),
  });

  const accounts = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts"),
  });

  const categories = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/transactions", body),
    onSuccess: () => {
      toast.push("Transaction recorded.");
      setAdding(false);
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const voidTxn = useMutation({
    mutationFn: (id: number) => api.post(`/transactions/${id}/void?reason=Voided+by+user`),
    onSuccess: () => {
      toast.push("Transaction voided. It stays in the ledger for the audit trail.");
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const rows = page.data?.items ?? [];
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Every real movement of money, and what each one was for"
      >
        <button className="btn-primary" onClick={() => setAdding(true)}>
          Record transaction
        </button>
      </PageHeader>

      <Card className="mb-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="lg:col-span-2">
            <span className="label mb-1 block">Search</span>
            <input
              className="field"
              placeholder="Description or reference"
              value={filters.q}
              onChange={(e) => setFilter("q", e.target.value)}
            />
          </label>
          <label>
            <span className="label mb-1 block">Fund</span>
            <select
              className="field"
              value={filters.fund_id}
              onChange={(e) => setFilter("fund_id", e.target.value)}
            >
              <option value="">All funds</option>
              {(funds.data ?? []).map((fund) => (
                <option key={fund.id} value={fund.id}>
                  {fund.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label mb-1 block">Direction</span>
            <select
              className="field"
              value={filters.direction}
              onChange={(e) => setFilter("direction", e.target.value)}
            >
              <option value="">Both</option>
              <option value="credit">Money in</option>
              <option value="debit">Money out</option>
            </select>
          </label>
          <label>
            <span className="label mb-1 block">From</span>
            <input
              type="date"
              className="field"
              value={filters.date_from}
              onChange={(e) => setFilter("date_from", e.target.value)}
            />
          </label>
          <label>
            <span className="label mb-1 block">To</span>
            <input
              type="date"
              className="field"
              value={filters.date_to}
              onChange={(e) => setFilter("date_to", e.target.value)}
            />
          </label>
        </div>

        {page.data && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line-soft pt-3 text-[12px] text-ink-3">
            <span className="tabular">{page.data.total} transactions</span>
            <span>
              In <Money paise={page.data.sum_credit} className="text-pos" />
            </span>
            <span>
              Out <Money paise={page.data.sum_debit} className="text-neg" />
            </span>
            <span>
              Net{" "}
              <Money
                paise={page.data.sum_credit - page.data.sum_debit}
                className="font-medium"
              />
            </span>
            {hasFilters && (
              <button
                className="ml-auto text-accent hover:underline"
                onClick={() => setParams(new URLSearchParams(), { replace: true })}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </Card>

      {page.isError ? (
        <ErrorState error={page.error} onRetry={() => page.refetch()} />
      ) : page.isLoading ? (
        <Skeleton className="h-96" />
      ) : !rows.length ? (
        <EmptyState
          title={hasFilters ? "Nothing matches those filters" : "No transactions yet"}
          message={
            hasFilters
              ? "Try widening the date range or clearing the search."
              : "Import a bank statement or record a transaction by hand to get started."
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th>Attributed to</Th>
                <Th>Kind</Th>
                <Th right>Amount</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((txn) => (
                <tr
                  key={txn.id}
                  className={cx(txn.status === "void" && "opacity-45 line-through")}
                >
                  <Td className="whitespace-nowrap text-ink-2">
                    {formatDate(txn.value_date)}
                  </Td>
                  <Td>
                    <span
                      className="block max-w-[300px] truncate"
                      title={txn.description_raw}
                    >
                      {txn.description_norm || txn.description_raw}
                    </span>
                    <span className="font-mono text-2xs text-ink-3">
                      {txn.account_name}
                      {txn.external_ref ? ` · ${txn.external_ref}` : ""}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {txn.allocations.map((alloc) => (
                        <Chip
                          key={alloc.id}
                          tone={
                            alloc.fund_kind === "unassigned"
                              ? "warn"
                              : alloc.fund_kind === "personal"
                                ? "neutral"
                                : "accent"
                          }
                        >
                          {alloc.fund_kind === "unassigned"
                            ? "Needs review"
                            : alloc.fund_name}
                          {alloc.category_name ? ` · ${alloc.category_name}` : ""}
                        </Chip>
                      ))}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-3">{humanise(txn.kind)}</Td>
                  <Td right>
                    <Money
                      paise={txn.signed_amount}
                      signed
                      exact
                      className="font-medium"
                    />
                  </Td>
                  <Td right>
                    {txn.status !== "void" && (
                      <button
                        className="text-2xs text-ink-3 hover:text-neg"
                        onClick={() => voidTxn.mutate(txn.id)}
                      >
                        Void
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RecordModal
        open={adding}
        onClose={() => setAdding(false)}
        accounts={accounts.data ?? []}
        funds={(funds.data ?? []).filter((f) => f.kind !== "unassigned")}
        categories={categories.data ?? []}
        onSubmit={(body) => create.mutate(body)}
        pending={create.isPending}
      />
    </>
  );
}

/* ------------------------------------------------------------ record form */

function RecordModal({
  open,
  onClose,
  accounts,
  funds,
  categories,
  onSubmit,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  funds: Fund[];
  categories: Category[];
  onSubmit: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [splits, setSplits] = useState([{ fund_id: "", category_id: "", amount: "" }]);
  const [amount, setAmount] = useState("");

  const totalPaise = rupeesToPaise(amount) ?? 0;
  const allocated = splits.reduce(
    (sum, split) => sum + (rupeesToPaise(split.amount) ?? 0),
    0,
  );
  const remainder = totalPaise - allocated;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = rupeesToPaise(String(form.get("amount") ?? ""));
    if (!parsed || parsed <= 0) return;

    const usable = splits
      .filter((s) => s.fund_id && (rupeesToPaise(s.amount) ?? 0) > 0)
      .map((s) => ({
        fund_id: Number(s.fund_id),
        amount: rupeesToPaise(s.amount)!,
        category_id: s.category_id ? Number(s.category_id) : null,
      }));

    onSubmit({
      account_id: Number(form.get("account_id")),
      value_date: String(form.get("value_date")),
      direction: String(form.get("direction")),
      amount: parsed,
      kind: String(form.get("kind")),
      description: String(form.get("description") ?? ""),
      external_ref: String(form.get("external_ref") ?? "") || null,
      splits: usable,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a transaction"
      description="Anything you leave unallocated goes to the Unassigned fund for review."
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Account">
            <select name="account_id" className="field" required>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input
              name="value_date"
              type="date"
              className="field"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Field label="Direction">
            <select name="direction" className="field" defaultValue="debit">
              <option value="debit">Money out</option>
              <option value="credit">Money in</option>
            </select>
          </Field>
          <Field label="Amount">
            <input
              name="amount"
              className="field"
              required
              placeholder="35,000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Kind">
            <select name="kind" className="field" defaultValue="vendor_payment">
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {humanise(kind)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <input name="description" className="field" placeholder="ABC Cement" />
          </Field>
          <Field label="Reference / UTR">
            <input name="external_ref" className="field" placeholder="Optional" />
          </Field>
        </div>

        <div className="border-t border-line-soft pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Attribution</span>
            <button
              type="button"
              className="text-[12px] text-accent hover:underline"
              onClick={() =>
                setSplits((s) => [...s, { fund_id: "", category_id: "", amount: "" }])
              }
            >
              + Split across another fund
            </button>
          </div>

          <div className="space-y-2">
            {splits.map((split, index) => {
              const fund = funds.find((f) => f.id === Number(split.fund_id));
              const scope = fund?.kind === "personal" ? "personal" : "project";
              return (
                <div key={index} className="grid gap-2 sm:grid-cols-[2fr_2fr_1.2fr_auto]">
                  <select
                    className="field"
                    value={split.fund_id}
                    onChange={(e) =>
                      setSplits((s) =>
                        s.map((item, i) =>
                          i === index
                            ? { ...item, fund_id: e.target.value, category_id: "" }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="">Choose fund…</option>
                    {funds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="field"
                    value={split.category_id}
                    disabled={!split.fund_id}
                    onChange={(e) =>
                      setSplits((s) =>
                        s.map((item, i) =>
                          i === index ? { ...item, category_id: e.target.value } : item,
                        ),
                      )
                    }
                  >
                    <option value="">Category…</option>
                    {categories
                      .filter((c) => c.scope === scope || c.scope === "both")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                  <input
                    className="field"
                    placeholder="Amount"
                    value={split.amount}
                    onChange={(e) =>
                      setSplits((s) =>
                        s.map((item, i) =>
                          i === index ? { ...item, amount: e.target.value } : item,
                        ),
                      )
                    }
                  />
                  {splits.length > 1 && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setSplits((s) => s.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {totalPaise > 0 && (
            <p
              className={cx(
                "mt-2 text-[12px]",
                remainder < 0 ? "text-neg" : remainder > 0 ? "text-warn" : "text-pos",
              )}
            >
              {remainder < 0
                ? `Splits exceed the amount by ${Math.abs(remainder) / 100}.`
                : remainder > 0
                  ? `${remainder / 100} unallocated — it will go to Unassigned for review.`
                  : "Fully allocated."}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={pending || remainder < 0}
          >
            {pending ? "Saving…" : "Record"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
