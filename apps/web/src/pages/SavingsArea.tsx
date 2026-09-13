import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import AreaEntryForm from "../components/AreaEntryForm";
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
import { formatDateShort } from "../lib/money";
import type { Overview, TransactionPage } from "../lib/types";

export default function SavingsArea() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const overview = useQuery<Overview>({
    queryKey: ["overview"],
    queryFn: () => api.get<Overview>("/overview"),
  });

  const area = overview.data?.savings;

  const entries = useQuery<TransactionPage>({
    queryKey: ["savings-entries", area?.fund_id],
    queryFn: () =>
      api.get<TransactionPage>("/transactions", {
        fund_id: area?.fund_id,
        limit: 300,
      }),
    enabled: Boolean(area?.fund_id),
  });

  const deleteEntry = useMutation({
    mutationFn: (id: number) =>
      api.post(`/transactions/${id}/void?reason=Deleted+from+Savings`),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  if (entries.isError) {
    return <ErrorNote error={entries.error} onRetry={() => entries.refetch()} />;
  }

  const rows = entries.data?.items ?? [];

  return (
    <>
      <PageTitle sub="Money you have set aside. It is still in the same bank account — recording it here reserves it, so the rest of the dashboard stops counting it as spendable.">
        Savings
      </PageTitle>

      <AreaEntryForm area="savings" />

      <Section label="Standing" index="01">
        {!area ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="grid gap-8 sm:grid-cols-3">
            <Figure label="Total saved" paise={area.balance} accent={AREA_INK.savings} />
            <Figure
              label="Added this month"
              paise={area.in_month}
              size="sm"
              tone="in"
            />
            <Figure
              label="Withdrawn this month"
              paise={area.out_month}
              size="sm"
              tone="out"
            />
          </div>
        )}
      </Section>

      <Section label="Entries" index="02">
        {entries.isLoading ? (
          <Skeleton className="h-64" />
        ) : !rows.length ? (
          <Empty
            title="Nothing saved yet"
            body="Use the strip above to set money aside. It stays in your account — recording it here just reserves it out of your spendable total."
          />
        ) : (
          <Ledger min={560}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Entry</Th>
                <Th right>Amount</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((txn) => {
                const alloc = txn.allocations.find((a) => a.fund_kind === "savings");
                const signed =
                  txn.direction === "credit"
                    ? (alloc?.amount ?? 0)
                    : -(alloc?.amount ?? 0);
                return (
                  <tr key={txn.id}>
                    <Td className="whitespace-nowrap text-ink-3">
                      {formatDateShort(txn.value_date)}
                    </Td>
                    <Td className="max-w-[360px]">
                      <span className="block truncate" title={txn.description_raw}>
                        {txn.description_norm || txn.description_raw}
                      </span>
                    </Td>
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
