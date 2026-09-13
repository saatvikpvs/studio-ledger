import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { AreaDonut, type DonutSlice } from "../components/Graphs";
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
    queryFn: () => api.get<TransactionPage>("/transactions", { limit: 10 }),
  });

  if (overview.isError) {
    return <ErrorNote error={overview.error} onRetry={() => overview.refetch()} />;
  }

  const data = overview.data;

  const slices: DonutSlice[] = data
    ? [
        { label: "Personal", amount: data.personal.balance, colour: AREA_INK.personal },
        {
          label: "Professional",
          amount: data.professional.balance,
          colour: AREA_INK.professional,
        },
        { label: "Savings", amount: data.savings.balance, colour: AREA_INK.savings },
        ...(data.unassigned.balance !== 0
          ? [{
              label: "Unfiled",
              amount: data.unassigned.balance,
              colour: AREA_INK.unassigned,
            }]
          : []),
      ]
    : [];

  return (
    <>
      <PageTitle
        sub={
          data
            ? "Everything you have, and how it divides between Personal, Professional and Savings."
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

      {/* ============================================== 01 — the total */}
      <Section label="Total money" index="01">
        {overview.isLoading || !data ? (
          <Skeleton className="h-[220px]" />
        ) : (
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Figure
              label="You currently have"
              paise={data.bank_balance}
              size="lg"
              note={
                <>
                  Across{" "}
                  {data.accounts.map((account, index) => (
                    <span key={account.id}>
                      {index > 0 && ", "}
                      {account.name}
                    </span>
                  ))}
                  . Personal, Professional and Savings always add up to this
                  figure exactly.
                </>
              }
            />
            <div className="lg:border-l lg:border-rule lg:pl-10">
              <AreaDonut slices={slices} total={data.bank_balance} />
              {data.unassigned.count > 0 && (
                <Link
                  to="/settings"
                  className="mt-5 block border-l-2 border-ochre pl-3 transition-opacity hover:opacity-70"
                >
                  <Annot className="text-ochre">Needs filing</Annot>
                  <div className="mt-0.5 text-[13px] leading-snug">
                    <span className="tnum">{data.unassigned.count}</span> entries
                    are not yet assigned to an area — see Settings › Import.
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
                ["Added", data.savings.in_month, "in"],
                ["Withdrawn", data.savings.out_month, "out"],
                ["Net", data.savings.net_month, "auto"],
              ]}
            />
          </div>
        )}
      </Section>

      {/* ============================================== 03 — recent */}
      <Section label="Recent entries" index="03">
        {recent.isLoading ? (
          <Skeleton className="h-52" />
        ) : !recent.data?.items.length ? (
          <Empty
            title="Nothing recorded yet"
            body="Open Personal, Professional or Savings and use the strip at the top to record what you just spent or received."
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
