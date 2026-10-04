import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  AREA_INK,
  AREA_LABEL,
  type Area,
  DeleteButton,
  Empty,
  ErrorNote,
  Ledger,
  Money,
  PageTitle,
  Section,
  Skeleton,
  Td,
  Th,
  cx,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDate } from "../lib/money";
import type { Allocation, Transaction, TransactionPage } from "../lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const FUND_KIND_TO_AREA: Record<string, Area> = {
  project: "professional",
  personal: "personal",
  savings: "savings",
  unassigned: "unassigned",
};

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const TODAY = toISODate(new Date());

/**
 * One month, every area combined. Each day shows what moved that day; pick a
 * day to see the breakdown -- one line per category, the way a single lump
 * withdrawal split across food, travel and a materials advance should read.
 */
export default function Calendar() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(TODAY);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);

  const entries = useQuery<TransactionPage>({
    queryKey: ["calendar-transactions", year, month],
    queryFn: () =>
      api.get<TransactionPage>("/transactions", {
        date_from: toISODate(monthStart),
        date_to: toISODate(monthEnd),
        limit: 500,
      }),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, { credit: number; debit: number; items: Transaction[] }>();
    for (const txn of entries.data?.items ?? []) {
      const bucket = map.get(txn.value_date) ?? { credit: 0, debit: 0, items: [] };
      if (txn.direction === "credit") bucket.credit += txn.amount;
      else bucket.debit += txn.amount;
      bucket.items.push(txn);
      map.set(txn.value_date, bucket);
    }
    return map;
  }, [entries.data]);

  const cells = useMemo(() => {
    const daysInMonth = monthEnd.getDate();
    const startWeekday = monthStart.getDay();
    const out: (Date | null)[] = [
      ...Array(startWeekday).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
    ];
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [year, month]);

  const selectedBucket = selected ? byDay.get(selected) : undefined;
  const selectedRows = useMemo(() => {
    type Row = { txn: Transaction; alloc: Allocation };
    const rows: Row[] = [];
    for (const txn of selectedBucket?.items ?? []) {
      for (const alloc of txn.allocations) rows.push({ txn, alloc });
    }
    return rows.sort((a, b) => b.txn.id - a.txn.id);
  }, [selectedBucket]);

  const deleteEntry = useMutation({
    mutationFn: (id: number) =>
      api.post(`/transactions/${id}/void?reason=Deleted+from+Calendar`),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const goMonth = (delta: number) => {
    setCursor(new Date(year, month + delta, 1));
  };

  if (entries.isError) {
    return <ErrorNote error={entries.error} onRetry={() => entries.refetch()} />;
  }

  return (
    <>
      <PageTitle sub="Every area, one month. Pick a day to see what was credited or debited, and how it split across categories.">
        Calendar
      </PageTitle>

      <Section
        label="Month"
        index="01"
        action={
          <div className="flex items-center gap-3">
            <button onClick={() => goMonth(-1)} className="btn-line px-3" aria-label="Previous month">
              ‹
            </button>
            <div className="min-w-[11ch] text-center font-serif text-[15px]">
              {monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </div>
            <button onClick={() => goMonth(1)} className="btn-line px-3" aria-label="Next month">
              ›
            </button>
            {(year !== new Date().getFullYear() || month !== new Date().getMonth()) && (
              <button
                onClick={() => {
                  const now = new Date();
                  setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
                  setSelected(TODAY);
                }}
                className="btn-quiet"
              >
                Today
              </button>
            )}
          </div>
        }
      >
        {entries.isLoading ? (
          <Skeleton className="h-96" />
        ) : (
          <div className="grid grid-cols-7 gap-px border border-rule bg-rule-soft">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="bg-paper py-1.5 text-center font-sans text-3xs uppercase tracking-annot text-ink-3"
              >
                {day}
              </div>
            ))}
            {cells.map((date, i) => {
              if (!date) return <div key={i} className="bg-paper-2" />;
              const iso = toISODate(date);
              const bucket = byDay.get(iso);
              const isSelected = selected === iso;
              const isToday = iso === TODAY;
              return (
                <button
                  key={iso}
                  onClick={() => setSelected(iso)}
                  className={cx(
                    "flex min-h-[72px] flex-col items-start gap-1 bg-paper p-1.5 text-left transition-colors hover:bg-paper-2",
                    isSelected && "ring-2 ring-inset",
                  )}
                  style={isSelected ? { boxShadow: "inset 0 0 0 2px var(--accent)" } : undefined}
                >
                  <span
                    className={cx(
                      "tnum text-[12px]",
                      isToday ? "font-semibold text-ink" : "text-ink-3",
                    )}
                  >
                    {date.getDate()}
                  </span>
                  {bucket && (
                    <span className="flex flex-col gap-0.5 text-3xs leading-tight">
                      {bucket.credit > 0 && (
                        <span className="tnum text-sap">
                          +<Money paise={bucket.credit} compact />
                        </span>
                      )}
                      {bucket.debit > 0 && (
                        <span className="tnum text-oxide">
                          -<Money paise={bucket.debit} compact />
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <Section label={selected ? formatDate(selected) : "Day"} index="02">
        {!selected ? (
          <Empty title="Pick a day" body="Select a date above to see what happened that day." />
        ) : !selectedRows.length ? (
          <Empty
            title="No entries"
            body="Nothing recorded for this day yet."
          />
        ) : (
          <>
            <div className="mb-4 flex gap-8">
              {selectedBucket!.credit > 0 && (
                <div>
                  <div className="annot">Received</div>
                  <Money paise={selectedBucket!.credit} tone="in" className="font-serif text-[20px]" />
                </div>
              )}
              {selectedBucket!.debit > 0 && (
                <div>
                  <div className="annot">Spent</div>
                  <Money paise={selectedBucket!.debit} tone="out" className="font-serif text-[20px]" />
                </div>
              )}
            </div>
            <Ledger min={640}>
              <thead>
                <tr>
                  <Th>Area</Th>
                  <Th>Entry</Th>
                  <Th>Category</Th>
                  <Th right>Amount</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {selectedRows.map(({ txn, alloc }) => {
                  const area = FUND_KIND_TO_AREA[alloc.fund_kind] ?? "unassigned";
                  const signed = txn.direction === "credit" ? alloc.amount : -alloc.amount;
                  return (
                    <tr key={`${txn.id}-${alloc.id}`}>
                      <Td>
                        <span
                          className="inline-flex items-center gap-1.5 text-2xs text-ink-3"
                        >
                          <span
                            className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
                            style={{ background: AREA_INK[area] }}
                          />
                          {AREA_LABEL[area]}
                        </span>
                      </Td>
                      <Td className="max-w-[300px]">
                        <span className="block truncate" title={txn.description_raw}>
                          {txn.description_norm || txn.description_raw}
                        </span>
                      </Td>
                      <Td className="text-ink-2">
                        {alloc.category_name ?? "—"}
                        {alloc.note && (
                          <span className="block text-3xs text-ink-3">{alloc.note}</span>
                        )}
                      </Td>
                      <Td right>
                        <Money paise={signed} exact tone={txn.direction === "credit" ? "in" : "out"} />
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
          </>
        )}
      </Section>
    </>
  );
}
