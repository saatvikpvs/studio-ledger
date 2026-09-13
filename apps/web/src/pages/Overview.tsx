import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import SectionBar, { type Band } from "../components/SectionBar";
import {
  AREA_INK,
  Annot,
  Empty,
  ErrorNote,
  Figure,
  Ledger,
  Mark,
  Money,
  PageTitle,
  Section,
  Skeleton,
  Td,
  Th,
  cx,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDate, formatDateShort } from "../lib/money";
import type { Overview as OverviewData, TransactionPage } from "../lib/types";

export default function Overview() {
  const overview = useQuery<OverviewData>({
    queryKey: ["overview"],
    queryFn: () => api.get<OverviewData>("/overview"),
  });

  const recent = useQuery<TransactionPage>({
    queryKey: ["recent-entries"],
    queryFn: () => api.get<TransactionPage>("/transactions", { limit: 12 }),
  });

  if (overview.isError) {
    return <ErrorNote error={overview.error} onRetry={() => overview.refetch()} />;
  }

  const data = overview.data;

  const bands: Band[] = data
    ? [
        { area: "personal", label: "Personal", amount: data.personal.balance },
        {
          area: "professional",
          label: "Professional",
          amount: data.professional.balance,
        },
        { area: "savings", label: "Savings", amount: data.savings.balance },
        { area: "unassigned", label: "Unfiled", amount: data.unassigned.balance },
      ]
    : [];

  return (
    <>
      <PageTitle
        sub={
          data
            ? "One bank account, read three ways. The bands below are the balance itself — they always add up to it exactly."
            : undefined
        }
        right={
          data && (
            <div className="text-right">
              <Annot>As at</Annot>
              <div className="text-[13px] tnum">{formatDate(data.as_of)}</div>
            </div>
          )
        }
      >
        Overview
      </PageTitle>

      {/* ============================================== 01 — the position */}
      <Section label="Position" index="01">
        {overview.isLoading || !data ? (
          <Skeleton className="h-[150px]" />
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_210px]">
            <SectionBar bands={bands} total={data.bank_balance} />
            <div className="lg:border-l lg:border-rule lg:pl-8">
              <Figure
                label="In the bank"
                paise={data.bank_balance}
                size="md"
                note={
                  <>
                    Across{" "}
                    {data.accounts.map((account, index) => (
                      <span key={account.id}>
                        {index > 0 && ", "}
                        {account.name}
                      </span>
                    ))}
                  </>
                }
              />
              {data.unassigned.count > 0 && (
                <Link
                  to="/reconcile"
                  className="mt-5 block border-l-2 border-ochre pl-3 transition-opacity hover:opacity-70"
                >
                  <Annot className="text-ochre">Needs filing</Annot>
                  <div className="mt-0.5 text-[13px] leading-snug">
                    <span className="tnum">{data.unassigned.count}</span> entries
                    are not yet assigned to an area.
                  </div>
                </Link>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* ============================================== 02 — this month */}
      <Section label="This month" index="02">
        {overview.isLoading || !data ? (
          <Skeleton className="h-[130px]" />
        ) : (
          <div className="grid gap-px bg-rule sm:grid-cols-3">
            <AreaColumn
              to="/personal"
              area="personal"
              title="Personal"
              balance={data.personal.balance}
              lines={[
                ["Received", data.personal.in_month, "in"],
                ["Spent", data.personal.out_month, "out"],
                ["Net", data.personal.net_month, "auto"],
              ]}
            />
            <AreaColumn
              to="/studio"
              area="professional"
              title="Professional"
              balance={data.professional.balance}
              lines={[
                ["Client money in", data.professional.in_month, "in"],
                ["Project spend", data.professional.out_month, "out"],
                ["Still owed", data.professional.receivable, "plain"],
              ]}
              foot={`${data.professional.active_projects} active ${
                data.professional.active_projects === 1 ? "project" : "projects"
              }`}
            />
            <AreaColumn
              to="/savings"
              area="savings"
              title="Savings"
              balance={data.savings.balance}
              lines={[
                ["Set aside", data.savings.contributed_month, "in"],
                [
                  "Toward goals",
                  data.savings.goals.reduce((s, g) => s + g.target_amount, 0),
                  "plain",
                ],
              ]}
              foot={`${data.savings.goal_count} ${
                data.savings.goal_count === 1 ? "goal" : "goals"
              }`}
            />
          </div>
        )}
      </Section>

      {/* ============================================== 03 — recent */}
      <Section
        label="Recent entries"
        index="03"
        action={
          <Link to="/entries" className="btn-quiet">
            All entries
          </Link>
        }
      >
        {recent.isLoading ? (
          <Skeleton className="h-52" />
        ) : !recent.data?.items.length ? (
          <Empty
            title="Nothing recorded yet"
            body="Use the strip above to record what you just spent. Amount, a word about what it was, and which area it belongs to."
          />
        ) : (
          <Ledger min={620}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Entry</Th>
                <Th>Area</Th>
                <Th>Category</Th>
                <Th right>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {recent.data.items.map((txn) => {
                const alloc = txn.allocations[0];
                const area =
                  alloc?.fund_kind === "project"
                    ? "professional"
                    : alloc?.fund_kind === "savings"
                      ? "savings"
                      : alloc?.fund_kind === "personal"
                        ? "personal"
                        : "unassigned";
                return (
                  <tr key={txn.id}>
                    <Td className="whitespace-nowrap text-ink-3">
                      {formatDateShort(txn.value_date)}
                    </Td>
                    <Td className="max-w-[320px]">
                      <span className="block truncate" title={txn.description_raw}>
                        {txn.description_norm || txn.description_raw}
                      </span>
                    </Td>
                    <Td>
                      <Mark colour={AREA_INK[area]}>
                        {area === "unassigned"
                          ? "Unfiled"
                          : area === "professional"
                            ? alloc?.fund_name ?? "Studio"
                            : area}
                      </Mark>
                    </Td>
                    <Td className="text-ink-3">{alloc?.category_name ?? "—"}</Td>
                    <Td right>
                      <Money
                        paise={txn.signed_amount}
                        exact
                        tone={txn.direction === "credit" ? "in" : "out"}
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

/* -------------------------------------------------------------------------- */

function AreaColumn({
  to,
  area,
  title,
  balance,
  lines,
  foot,
}: {
  to: string;
  area: "personal" | "professional" | "savings";
  title: string;
  balance: number;
  lines: [string, number, "in" | "out" | "plain" | "auto"][];
  foot?: string;
}) {
  return (
    <Link
      to={to}
      className="group bg-paper px-5 py-5 transition-colors hover:bg-paper-2/60"
      style={{ boxShadow: `inset 0 2px 0 ${AREA_INK[area]}` }}
    >
      <Figure label={title} paise={balance} size="sm" />
      <dl className="mt-4 space-y-1.5 border-t border-rule-soft pt-3">
        {lines.map(([label, value, tone]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-2xs text-ink-3">{label}</dt>
            <dd className="text-[13px]">
              <Money paise={value} tone={tone} exact={false} />
            </dd>
          </div>
        ))}
      </dl>
      {foot && (
        <div className="mt-3 text-3xs uppercase tracking-annot text-ink-3">
          {foot}
        </div>
      )}
    </Link>
  );
}
