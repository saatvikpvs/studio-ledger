import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import AreaEntryForm from "../components/AreaEntryForm";
import { CategoryRules, MonthStrip } from "../components/Graphs";
import {
  AREA_INK,
  DeleteButton,
  Empty,
  ErrorNote,
  Figure,
  Ledger,
  Money,
  PageTitle,
  Section,
  Skeleton,
  Td,
  Th,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDate, formatDateShort } from "../lib/money";
import type { Overview, PersonalSummary, TransactionPage } from "../lib/types";

export default function PersonalArea() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const overview = useQuery<Overview>({
    queryKey: ["overview"],
    queryFn: () => api.get<Overview>("/overview"),
  });

  const summary = useQuery<PersonalSummary>({
    queryKey: ["personal"],
    queryFn: () => api.get<PersonalSummary>("/personal/summary"),
  });

  const entries = useQuery<TransactionPage>({
    queryKey: ["personal-entries", summary.data?.fund_id],
    queryFn: () =>
      api.get<TransactionPage>("/transactions", {
        fund_id: summary.data?.fund_id,
        limit: 200,
      }),
    enabled: Boolean(summary.data?.fund_id),
  });

  if (summary.isError) {
    return <ErrorNote error={summary.error} onRetry={() => summary.refetch()} />;
  }

  const area = overview.data?.personal;
  const data = summary.data;
  const rows = entries.data?.items ?? [];

  const deleteEntry = useMutation({
    mutationFn: (id: number) =>
      api.post(`/transactions/${id}/void?reason=Deleted+from+Personal`),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  return (
    <>
      <PageTitle sub="Your own money — what comes in, what goes out, what is left. Nothing here touches a project or your savings.">
        Personal
      </PageTitle>

      <AreaEntryForm area="personal" />

      <Section label="Standing" index="01">
        {!data || !area ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="grid gap-8 sm:grid-cols-3">
            <Figure
              label="Available"
              paise={area.balance}
              accent={AREA_INK.personal}
              note="After anything drawn from the studio and set aside as savings"
            />
            <Figure
              label="Received this month"
              paise={area.in_month}
              size="sm"
              tone="in"
            />
            <Figure
              label="Spent this month"
              paise={area.out_month}
              size="sm"
              tone="out"
              note={
                data.spent_this_fy ? (
                  <>
                    <Money paise={data.spent_this_fy} /> so far this financial year
                  </>
                ) : undefined
              }
            />
          </div>
        )}
      </Section>

      <Section label="Where it goes" index="02">
        {summary.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <CategoryRules data={data?.breakdown ?? []} limit={10} />
            </div>
            <div className="lg:border-l lg:border-rule lg:pl-10">
              <div className="annot mb-4">In and out, by month</div>
              <MonthStrip data={data?.monthly ?? []} months={6} />
              {data && (
                <p className="mt-5 max-w-measure text-2xs leading-relaxed text-ink-3">
                  Financial year {formatDate(data.fiscal_year.start)} to{" "}
                  {formatDate(data.fiscal_year.end)}.
                </p>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section label="Entries" index="03">
        {entries.isLoading ? (
          <Skeleton className="h-64" />
        ) : !rows.length ? (
          <Empty
            title="No personal entries yet"
            body="Record an expense with the strip at the top of the page and it appears here."
          />
        ) : (
          <Ledger min={600}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Entry</Th>
                <Th>Category</Th>
                <Th right>Amount</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((txn) => {
                const alloc = txn.allocations.find(
                  (a) => a.fund_kind === "personal",
                );
                const signed =
                  txn.direction === "credit"
                    ? (alloc?.amount ?? 0)
                    : -(alloc?.amount ?? 0);
                return (
                  <tr key={txn.id}>
                    <Td className="whitespace-nowrap text-ink-3">
                      {formatDateShort(txn.value_date)}
                    </Td>
                    <Td className="max-w-[340px]">
                      <span className="block truncate" title={txn.description_raw}>
                        {txn.description_norm || txn.description_raw}
                      </span>
                    </Td>
                    <Td className="text-ink-2">{alloc?.category_name ?? "—"}</Td>
                    <Td right>
                      <Money
                        paise={signed}
                        exact
                        tone={txn.direction === "credit" ? "in" : "out"}
                      />
                    </Td>
                    <Td right>
                      <DeleteButton
                        onClick={() => deleteEntry.mutate(txn.id)}
                        disabled={deleteEntry.isPending}
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Ledger>
        )}
      </Section>
    </>
  );
}
