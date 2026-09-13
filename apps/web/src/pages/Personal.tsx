import { useQuery } from "@tanstack/react-query";

import { CashFlowChart, CategoryDonut } from "../components/charts";
import {
  Card,
  EmptyState,
  ErrorState,
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
import type { PersonalSummary, TransactionPage } from "../lib/types";

export default function Personal() {
  const summary = useQuery<PersonalSummary>({
    queryKey: ["personal"],
    queryFn: () => api.get<PersonalSummary>("/personal/summary"),
  });

  const page = useQuery<TransactionPage>({
    queryKey: ["personal-transactions", summary.data?.fund_id],
    queryFn: () =>
      api.get<TransactionPage>("/transactions", {
        fund_id: summary.data?.fund_id,
        limit: 200,
      }),
    enabled: Boolean(summary.data?.fund_id),
  });

  if (summary.isError) {
    return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />;
  }

  const data = summary.data;
  const rows = page.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Personal"
        subtitle="Your own money. Nothing here touches a project's balance."
      />

      {summary.isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiTile
              label="Personal available"
              value={data.balance}
              tone={data.balance < 0 ? "neg" : "neutral"}
              hint="After fees drawn from projects"
            />
            <KpiTile
              label="Spent this month"
              value={data.spent_this_month}
              tone="neg"
            />
            <KpiTile
              label="Spent this financial year"
              value={data.spent_this_fy}
              hint={`${formatDate(data.fiscal_year.start)} — ${formatDate(data.fiscal_year.end)}`}
            />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Card>
              <SectionTitle>Where it goes</SectionTitle>
              <CategoryDonut data={data.breakdown} />
            </Card>

            <Card>
              <SectionTitle>Cash in and out</SectionTitle>
              <p className="mb-2 text-[12px] text-ink-3">
                Across every account, not just personal spending.
              </p>
              <CashFlowChart data={data.monthly} />
            </Card>
          </div>
        </>
      )}

      <div className="mt-8">
        <SectionTitle>Personal transactions</SectionTitle>
        {page.isLoading ? (
          <Skeleton className="h-80" />
        ) : !rows.length ? (
          <EmptyState
            title="Nothing recorded yet"
            message="Personal spending will appear here once you categorise transactions into your Personal fund."
          />
        ) : (
          <Card padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse">
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th>Category</Th>
                    <Th>Kind</Th>
                    <Th right>Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((txn) => {
                    const alloc = txn.allocations.find((a) => a.fund_kind === "personal");
                    const signed =
                      txn.direction === "credit"
                        ? (alloc?.amount ?? 0)
                        : -(alloc?.amount ?? 0);
                    return (
                      <tr key={txn.id}>
                        <Td className="whitespace-nowrap text-ink-2">
                          {formatDate(txn.value_date)}
                        </Td>
                        <Td className="max-w-[300px] truncate" >
                          {txn.description_norm || txn.description_raw}
                        </Td>
                        <Td className="text-ink-2">{alloc?.category_name ?? "—"}</Td>
                        <Td className="whitespace-nowrap text-ink-3">
                          {humanise(txn.kind)}
                        </Td>
                        <Td right>
                          <Money paise={signed} signed exact className="font-medium" />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
