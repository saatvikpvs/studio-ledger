import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  Card,
  EmptyState,
  ErrorState,
  Money,
  PageHeader,
  Skeleton,
  cx,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import type { Fund, ProjectSummary, Report } from "../lib/types";

interface ReportMeta {
  key: string;
  title: string;
}

const DESCRIPTIONS: Record<string, string> = {
  project_expenses: "Every rupee spent on a project, by category — the one you show the client.",
  project_summary: "Received, spent, in hand, budget variance, fee earned and margin.",
  client_payments: "All payments received, with references and dates.",
  personal_expenses: "Your own spending by category and month.",
  monthly_statement: "Cash in, cash out and net, month by month.",
  category_analysis: "Spend by category across projects and personal life.",
  vendor_report: "Total paid per counterparty — useful for negotiation and tax.",
  fund_statement: "A running ledger of one fund. The proof behind every dashboard figure.",
};

export default function Reports() {
  const toast = useToast();
  const [active, setActive] = useState("project_summary");
  const [filters, setFilters] = useState({
    date_from: "",
    date_to: "",
    project_id: "",
    fund_id: "",
  });

  const list = useQuery<ReportMeta[]>({
    queryKey: ["reports"],
    queryFn: () => api.get<ReportMeta[]>("/reports"),
  });

  const projects = useQuery<ProjectSummary[]>({
    queryKey: ["projects", ""],
    queryFn: () => api.get<ProjectSummary[]>("/projects"),
  });

  const funds = useQuery<Fund[]>({
    queryKey: ["funds"],
    queryFn: () => api.get<Fund[]>("/funds"),
  });

  const report = useQuery<Report>({
    queryKey: ["report", active, filters],
    queryFn: () => api.get<Report>(`/reports/${active}`, filters),
  });

  const download = async (format: "csv" | "xlsx") => {
    try {
      await api.download(
        `/reports/${active}/export`,
        { ...filters, format },
        `${active}-${new Date().toISOString().slice(0, 10)}.${format}`,
      );
      toast.push(`Exported as ${format.toUpperCase()}.`);
    } catch (error) {
      toast.push((error as Error).message, "error");
    }
  };

  const data = report.data;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Filter, read, and export. Every figure traces back to the ledger."
      >
        <button className="btn-ghost" onClick={() => download("csv")} disabled={!data}>
          Export CSV
        </button>
        <button className="btn-ghost" onClick={() => download("xlsx")} disabled={!data}>
          Export Excel
        </button>
        <button className="btn-primary" onClick={() => window.print()} disabled={!data}>
          Print / PDF
        </button>
      </PageHeader>

      <div className="grid gap-3 lg:grid-cols-[250px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Card padded={false}>
            <ul className="p-2">
              {(list.data ?? []).map((meta) => (
                <li key={meta.key}>
                  <button
                    onClick={() => setActive(meta.key)}
                    className={cx(
                      "w-full rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                      active === meta.key
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    {meta.title}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <span className="label mb-2 block">Filters</span>
            <div className="space-y-2.5">
              <label className="block">
                <span className="mb-1 block text-2xs text-ink-3">From</span>
                <input
                  type="date"
                  className="field"
                  value={filters.date_from}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, date_from: e.target.value }))
                  }
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-2xs text-ink-3">To</span>
                <input
                  type="date"
                  className="field"
                  value={filters.date_to}
                  onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-2xs text-ink-3">Project</span>
                <select
                  className="field"
                  value={filters.project_id}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, project_id: e.target.value }))
                  }
                >
                  <option value="">All projects</option>
                  {(projects.data ?? []).map((p) => (
                    <option key={p.project_id} value={p.project_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {active === "fund_statement" && (
                <label className="block">
                  <span className="mb-1 block text-2xs text-ink-3">Fund</span>
                  <select
                    className="field"
                    value={filters.fund_id}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, fund_id: e.target.value }))
                    }
                  >
                    <option value="">Personal</option>
                    {(funds.data ?? []).map((fund) => (
                      <option key={fund.id} value={fund.id}>
                        {fund.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className="btn-ghost btn-sm w-full"
                onClick={() =>
                  setFilters({ date_from: "", date_to: "", project_id: "", fund_id: "" })
                }
              >
                Clear filters
              </button>
            </div>
          </Card>
        </div>

        <div>
          {report.isError ? (
            <ErrorState error={report.error} onRetry={() => report.refetch()} />
          ) : report.isLoading || !data ? (
            <Skeleton className="h-96" />
          ) : (
            <Card padded={false}>
              <div className="border-b border-line-soft p-5">
                <h2 className="font-semibold tracking-tight">{data.title}</h2>
                <p className="mt-1 text-[12px] text-ink-3">
                  {DESCRIPTIONS[data.key] ?? ""}
                </p>
                <p className="mt-1 font-mono text-2xs text-ink-3">
                  {data.rows.length} rows · generated {data.generated_at.slice(0, 10)}
                </p>
              </div>

              {!data.rows.length ? (
                <EmptyState
                  title="Nothing in this period"
                  message="Widen the date range or clear the project filter."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        {data.columns.map((column) => (
                          <th
                            key={column.key}
                            className={cx(
                              "label whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2 font-medium",
                              column.type === "money" ? "text-right" : "text-left",
                            )}
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, index) => (
                        <tr key={index}>
                          {data.columns.map((column) => (
                            <td
                              key={column.key}
                              className={cx(
                                "border-b border-line-soft px-3 py-2 text-[13px]",
                                column.type === "money"
                                  ? "whitespace-nowrap text-right"
                                  : "",
                              )}
                            >
                              {column.type === "money" ? (
                                <Money paise={Number(row[column.key] ?? 0)} exact />
                              ) : (
                                String(row[column.key] ?? "—")
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {Object.keys(data.totals).length > 0 && (
                      <tfoot>
                        <tr className="bg-surface-2">
                          {data.columns.map((column, index) => (
                            <td
                              key={column.key}
                              className={cx(
                                "border-t border-line px-3 py-2.5 text-[13px] font-semibold",
                                column.type === "money"
                                  ? "whitespace-nowrap text-right"
                                  : "",
                              )}
                            >
                              {index === 0
                                ? "Total"
                                : data.totals[column.key] !== undefined
                                  ? column.type === "money"
                                    ? <Money paise={data.totals[column.key]} exact />
                                    : data.totals[column.key]
                                  : ""}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
