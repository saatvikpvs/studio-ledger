import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { CategoryBars } from "../components/charts";
import {
  Card,
  Chip,
  EmptyState,
  KpiTile,
  Money,
  PageHeader,
  SectionTitle,
  Skeleton,
  Td,
  Th,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDate, humanise } from "../lib/money";
import type { CategorySlice, Fund, TransactionPage } from "../lib/types";

export default function Expenses() {
  const [fundId, setFundId] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const funds = useQuery<Fund[]>({
    queryKey: ["funds"],
    queryFn: () => api.get<Fund[]>("/funds"),
  });

  const projectFunds = (funds.data ?? []).filter((f) => f.kind === "project");

  const page = useQuery<TransactionPage>({
    queryKey: ["project-expenses", fundId],
    queryFn: () =>
      api.get<TransactionPage>("/transactions", {
        fund_kind: fundId ? undefined : "project",
        fund_id: fundId || undefined,
        direction: "debit",
        limit: 300,
      }),
  });

  const breakdown = useQuery<CategorySlice[]>({
    queryKey: ["category-breakdown", "project"],
    queryFn: () =>
      api.get<CategorySlice[]>("/charts/category-breakdown", { scope: "project" }),
  });

  const rows = (page.data?.items ?? []).filter((txn) =>
    categoryFilter
      ? txn.allocations.some((a) => a.category_name === categoryFilter)
      : true,
  );

  const total = rows.reduce(
    (sum, txn) =>
      sum +
      txn.allocations
        .filter((a) => a.fund_kind === "project")
        .reduce((s, a) => s + a.amount, 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Project expenses"
        subtitle="Everything spent against a client project, separate from your own spending"
      />

      <div className="mb-3 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <div className="grid gap-3">
          <KpiTile
            label={fundId ? "Spent on this project" : "Spent across all projects"}
            value={total}
            tone="accent"
            hint={`${rows.length} transactions`}
          />
          <Card>
            <span className="label mb-1.5 block">Project</span>
            <select
              className="field"
              value={fundId}
              onChange={(e) => setFundId(e.target.value)}
            >
              <option value="">All projects</option>
              {projectFunds.map((fund) => (
                <option key={fund.id} value={fund.id}>
                  {fund.name}
                </option>
              ))}
            </select>
            {categoryFilter && (
              <button
                className="mt-3 text-[12px] text-accent hover:underline"
                onClick={() => setCategoryFilter("")}
              >
                Clear category filter: {categoryFilter}
              </button>
            )}
          </Card>
        </div>

        <Card>
          <SectionTitle>By category</SectionTitle>
          {breakdown.isLoading ? (
            <Skeleton className="h-56" />
          ) : (
            <CategoryBars data={breakdown.data ?? []} limit={14} />
          )}
        </Card>
      </div>

      {page.isLoading ? (
        <Skeleton className="h-80" />
      ) : !rows.length ? (
        <EmptyState
          title="No project expenses"
          message="Record an expense against a project, or import a statement and categorise the rows."
          action={
            <Link to="/transactions" className="btn-primary">
              Record an expense
            </Link>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Description</Th>
                  <Th>Project</Th>
                  <Th>Category</Th>
                  <Th>Kind</Th>
                  <Th right>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((txn) =>
                  txn.allocations
                    .filter((a) => a.fund_kind === "project")
                    .map((alloc) => (
                      <tr key={`${txn.id}-${alloc.id}`}>
                        <Td className="whitespace-nowrap text-ink-2">
                          {formatDate(txn.value_date)}
                        </Td>
                        <Td className="max-w-[280px]">
                          <span className="block truncate" title={txn.description_raw}>
                            {txn.description_norm || txn.description_raw}
                          </span>
                          {txn.allocations.length > 1 && (
                            <Chip tone="neutral" className="mt-1">
                              split
                            </Chip>
                          )}
                        </Td>
                        <Td className="text-ink-2">{alloc.fund_name}</Td>
                        <Td>
                          {alloc.category_name ? (
                            <button
                              className="text-accent hover:underline"
                              onClick={() => setCategoryFilter(alloc.category_name!)}
                            >
                              {alloc.category_name}
                            </button>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap text-ink-3">
                          {humanise(txn.kind)}
                        </Td>
                        <Td right>
                          <Money paise={alloc.amount} exact className="font-medium" />
                        </Td>
                      </tr>
                    )),
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
