import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import {
  AREA_INK,
  Annot,
  Empty,
  ErrorNote,
  Ledger,
  Mark,
  Money,
  PageTitle,
  Section,
  Skeleton,
  Td,
  Th,
  cx,
  useToast,
  type Area,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDateShort, humanise } from "../lib/money";
import type { Fund, TransactionPage } from "../lib/types";

const areaOf = (fundKind: string | undefined): Area =>
  fundKind === "project"
    ? "professional"
    : fundKind === "savings"
      ? "savings"
      : fundKind === "personal"
        ? "personal"
        : "unassigned";

export default function Entries() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();

  const filters = {
    q: params.get("q") ?? "",
    fund_kind: params.get("fund_kind") ?? "",
    direction: params.get("direction") ?? "",
    date_from: params.get("date_from") ?? "",
    date_to: params.get("date_to") ?? "",
  };

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };

  const page = useQuery<TransactionPage>({
    queryKey: ["entries", filters],
    queryFn: () => api.get<TransactionPage>("/transactions", { ...filters, limit: 400 }),
  });

  const voidTxn = useMutation({
    mutationFn: (id: number) =>
      api.post(`/transactions/${id}/void?reason=Voided+by+user`),
    onSuccess: () => {
      toast.push("Voided. It stays in the ledger for the record.");
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const rows = page.data?.items ?? [];
  const active = Object.values(filters).some(Boolean);

  return (
    <>
      <PageTitle sub="Every movement of money, and what each one was for.">
        Entries
      </PageTitle>

      <Section label="Filter" index="01">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="lg:col-span-2">
            <Annot className="mb-1.5">Search</Annot>
            <input
              className="field-underline"
              placeholder="Payee or reference"
              value={filters.q}
              onChange={(e) => setFilter("q", e.target.value)}
            />
          </label>
          <label>
            <Annot className="mb-1.5">Area</Annot>
            <select
              className="field-underline"
              value={filters.fund_kind}
              onChange={(e) => setFilter("fund_kind", e.target.value)}
            >
              <option value="">All</option>
              <option value="personal">Personal</option>
              <option value="project">Professional</option>
              <option value="savings">Savings</option>
              <option value="unassigned">Unfiled</option>
            </select>
          </label>
          <label>
            <Annot className="mb-1.5">From</Annot>
            <input
              type="date"
              className="field-underline"
              value={filters.date_from}
              onChange={(e) => setFilter("date_from", e.target.value)}
            />
          </label>
          <label>
            <Annot className="mb-1.5">To</Annot>
            <input
              type="date"
              className="field-underline"
              value={filters.date_to}
              onChange={(e) => setFilter("date_to", e.target.value)}
            />
          </label>
        </div>

        {page.data && (
          <div className="mt-5 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-rule-soft pt-3 text-2xs text-ink-3">
            <span className="tnum">{page.data.total} entries</span>
            <span>
              In <Money paise={page.data.sum_credit} tone="in" className="text-[13px]" />
            </span>
            <span>
              Out <Money paise={page.data.sum_debit} tone="out" className="text-[13px]" />
            </span>
            <span>
              Net{" "}
              <Money
                paise={page.data.sum_credit - page.data.sum_debit}
                className="text-[13px] text-ink"
              />
            </span>
            {active && (
              <button
                className="btn-quiet ml-auto"
                onClick={() => setParams(new URLSearchParams(), { replace: true })}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </Section>

      <Section label="Ledger" index="02">
        {page.isError ? (
          <ErrorNote error={page.error} onRetry={() => page.refetch()} />
        ) : page.isLoading ? (
          <Skeleton className="h-80" />
        ) : !rows.length ? (
          <Empty
            title={active ? "Nothing matches those filters" : "No entries yet"}
            body={
              active
                ? "Widen the dates or clear the search."
                : "Record something with the strip at the top, or upload a statement under Reconcile."
            }
          />
        ) : (
          <Ledger min={840}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Entry</Th>
                <Th>Belongs to</Th>
                <Th>Category</Th>
                <Th>Kind</Th>
                <Th right>Amount</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((txn) => (
                <tr
                  key={txn.id}
                  className={cx(txn.status === "void" && "line-through opacity-40")}
                >
                  <Td className="whitespace-nowrap text-ink-3">
                    {formatDateShort(txn.value_date)}
                  </Td>
                  <Td className="max-w-[280px]">
                    <span className="block truncate" title={txn.description_raw}>
                      {txn.description_norm || txn.description_raw}
                    </span>
                    <span className="text-3xs text-ink-3">
                      {txn.account_name}
                      {txn.external_ref ? ` · ${txn.external_ref}` : ""}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {txn.allocations.map((alloc) => (
                        <Mark key={alloc.id} colour={AREA_INK[areaOf(alloc.fund_kind)]}>
                          {alloc.fund_kind === "unassigned" ? "Unfiled" : alloc.fund_name}
                        </Mark>
                      ))}
                    </div>
                  </Td>
                  <Td className="text-ink-2">
                    {txn.allocations.map((a) => a.category_name).filter(Boolean).join(", ") ||
                      "—"}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-3">{humanise(txn.kind)}</Td>
                  <Td right>
                    <Money
                      paise={txn.signed_amount}
                      exact
                      tone={txn.direction === "credit" ? "in" : "out"}
                    />
                  </Td>
                  <Td right>
                    {txn.status !== "void" && (
                      <button
                        className="btn-quiet"
                        onClick={() => voidTxn.mutate(txn.id)}
                      >
                        Void
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Ledger>
        )}
      </Section>
    </>
  );
}
