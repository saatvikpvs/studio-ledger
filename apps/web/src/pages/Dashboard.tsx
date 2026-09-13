import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  BalanceTrendChart,
  CashFlowChart,
  CategoryBars,
  FundAllocationBar,
} from "../components/charts";
import ProjectCard from "../components/ProjectCard";
import {
  Card,
  EmptyState,
  ErrorState,
  KpiTile,
  LoadingCards,
  PageHeader,
  SectionTitle,
  Skeleton,
  cx,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDate } from "../lib/money";
import type {
  BalancePoint,
  CategorySlice,
  DashboardSummary,
  MonthlyFlow,
} from "../lib/types";

export default function Dashboard() {
  const summary = useQuery<DashboardSummary>({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
  });

  const flows = useQuery<MonthlyFlow[]>({
    queryKey: ["monthly-flows"],
    queryFn: () => api.get<MonthlyFlow[]>("/charts/monthly-flows", { months: 12 }),
  });

  const trend = useQuery<BalancePoint[]>({
    queryKey: ["balance-trend"],
    queryFn: () => api.get<BalancePoint[]>("/charts/balance-trend", { days: 120 }),
  });

  const categories = useQuery<CategorySlice[]>({
    queryKey: ["category-breakdown", "project"],
    queryFn: () =>
      api.get<CategorySlice[]>("/charts/category-breakdown", { scope: "project" }),
  });

  if (summary.isError) {
    return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />;
  }

  const data = summary.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={data ? `Position as at ${formatDate(data.as_of)}` : undefined}
      >
        <Link to="/import" className="btn-ghost">
          Import statement
        </Link>
        <Link to="/review" className="btn-primary">
          Review
          {data && data.review_count > 0 ? ` (${data.review_count})` : ""}
        </Link>
      </PageHeader>

      {/* ------------------------------------------------ band 1: anything wrong? */}
      {data && data.alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {data.alerts.map((alert, index) => (
            <Link
              key={index}
              to={alert.href}
              className={cx(
                "flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors",
                alert.severity === "critical" && "border-neg/40 bg-neg-soft hover:bg-neg-soft/70",
                alert.severity === "warning" && "border-warn/40 bg-warn-soft hover:bg-warn-soft/70",
                alert.severity === "info" && "border-line bg-surface hover:bg-surface-2",
              )}
            >
              <span
                className={cx(
                  "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                  alert.severity === "critical" && "bg-neg",
                  alert.severity === "warning" && "bg-warn",
                  alert.severity === "info" && "bg-accent",
                )}
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{alert.title}</span>
                <span className="block text-[12px] text-ink-2">{alert.detail}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* ---------------------------------------------- band 2: where do I stand? */}
      {summary.isLoading || !data ? (
        <LoadingCards />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Bank balance"
            value={data.bank_balance}
            tone="neutral"
            hint="Across every account, reconciled against the statement"
          />
          <KpiTile
            label="Client money held"
            value={data.client_money_held}
            tone="accent"
            hint="Advances received but not yet spent — this is not yours"
          />
          <KpiTile
            label="Personal available"
            value={data.personal_available}
            tone={data.personal_available < 0 ? "neg" : "neutral"}
            hint="Your own money, after fees drawn"
          />
          <KpiTile
            label="Net cash this month"
            value={data.net_cash_month}
            tone={data.net_cash_month < 0 ? "neg" : "pos"}
            hint={`In ${(data.cash_in_month / 100).toLocaleString("en-IN")} · out ${(data.cash_out_month / 100).toLocaleString("en-IN")}`}
          />
        </div>
      )}

      {data && (
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <SectionTitle>How the balance divides</SectionTitle>
            <p className="mb-3.5 text-[12px] leading-relaxed text-ink-3">
              One bank account, separated in software. These add up to the bank
              balance exactly — always.
            </p>
            <FundAllocationBar data={data.fund_allocation} />
          </Card>

          <Card>
            <SectionTitle>Earned vs received</SectionTitle>
            <dl className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] text-ink-2">Cash in this month</dt>
                <dd className="tabular text-[15px] font-medium">
                  {(data.cash_in_month / 100).toLocaleString("en-IN", {
                    style: "currency",
                    currency: "INR",
                    maximumFractionDigits: 0,
                  })}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] text-ink-2">Actually earned</dt>
                <dd className="tabular text-[15px] font-medium text-pos">
                  {(data.earned_month / 100).toLocaleString("en-IN", {
                    style: "currency",
                    currency: "INR",
                    maximumFractionDigits: 0,
                  })}
                </dd>
              </div>
            </dl>
            <p className="mt-3.5 border-t border-line-soft pt-3 text-2xs leading-relaxed text-ink-3">
              A client advance is cash arriving, not money made. The gap is how
              much client money you are holding.
            </p>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------ band 3: how is each job? */}
      <div className="mt-8">
        <SectionTitle
          action={
            <Link to="/projects" className="text-[12px] text-accent hover:underline">
              All projects →
            </Link>
          }
        >
          Active projects
        </SectionTitle>

        {summary.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[188px]" />
            ))}
          </div>
        ) : data && data.projects.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.projects.map((project) => (
              <ProjectCard key={project.project_id} project={project} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No active projects"
            message="Create a project to start tracking client money against it separately from your own."
            action={
              <Link to="/projects" className="btn-primary">
                Create a project
              </Link>
            }
          />
        )}
      </div>

      {/* ------------------------------------------------- band 4: what's the trend? */}
      <div className="mt-8 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle>Cash in and out</SectionTitle>
          <p className="mb-2 text-[12px] text-ink-3">
            Cash, not income — client advances are included here.
          </p>
          {flows.isLoading ? (
            <Skeleton className="h-[240px]" />
          ) : (
            <CashFlowChart data={flows.data ?? []} />
          )}
        </Card>

        <Card>
          <SectionTitle>Project spend by category</SectionTitle>
          {categories.isLoading ? (
            <Skeleton className="h-[240px]" />
          ) : (
            <CategoryBars data={categories.data ?? []} limit={8} />
          )}
        </Card>
      </div>

      <Card className="mt-3">
        <SectionTitle>Balance over time</SectionTitle>
        {trend.isLoading ? (
          <Skeleton className="h-[200px]" />
        ) : (
          <BalanceTrendChart data={trend.data ?? []} />
        )}
      </Card>
    </>
  );
}
