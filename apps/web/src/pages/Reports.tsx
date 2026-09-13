import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  Annot,
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
import type { Fund, ProjectSummary, Report } from "../lib/types";

interface ReportMeta {
  key: string;
  title: string;
}

const NOTES: Record<string, string> = {
  project_expenses: "Every rupee spent on a project, by category — the one you show the client.",
  project_summary: "Received, spent, in hand, budget variance, fee earned and margin.",
  client_payments: "All payments received, with references and dates.",
  personal_expenses: "Your own spending by category and month.",
  monthly_statement: "Money in, money out and net, month by month.",
  category_analysis: "Spend by category across the studio and personal life.",
  vendor_report: "Total paid per payee — useful for negotiation and at tax time.",
  fund_statement: "A running ledger of one area. The proof behind every figure.",
};

export default function Reports() {
  const toast = useToast();
  const [active, setActive] = useState("monthly_statement");
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
      <PageTitle
        sub="Filter, read, export. Every figure traces back to an entry you can open."
        right={
          <>
            <button className="btn-line" onClick={() => download("csv")} disabled={!data}>
              CSV
            </button>
            <button className="btn-line" onClick={() => download("xlsx")} disabled={!data}>
              Excel
            </button>
            <button className="btn-solid" onClick={() => window.print()} disabled={!data}>
              Print
            </button>
          </>
        }
      >
        Reports
      </PageTitle>

      <div className="grid gap-10 border-t border-rule pt-8 lg:grid-cols-[210px_minmax(0,1fr)]">
        {/* index */}
        <div className="no-print">
          <Annot className="mb-3">Index</Annot>
          <ul className="border-t border-rule-soft">
            {(list.data ?? []).map((meta) => (
              <li key={meta.key}>
                <button
                  onClick={() => setActive(meta.key)}
                  className={cx(
                    "w-full border-b border-rule-soft py-2 text-left text-[13px] transition-colors",
                    active === meta.key ? "text-ink" : "text-ink-3 hover:text-ink",
                  )}
                >
                  {meta.title}
                </button>
              </li>
            ))}
          </ul>

          <Annot className="mb-3 mt-8">Filters</Annot>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-3xs text-ink-3">From</span>
              <input
                type="date"
                className="field-underline text-[13px]"
                value={filters.date_from}
                onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-3xs text-ink-3">To</span>
              <input
                type="date"
                className="field-underline text-[13px]"
                value={filters.date_to}
                onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-3xs text-ink-3">Project</span>
              <select
                className="field-underline text-[13px]"
                value={filters.project_id}
                onChange={(e) => setFilters((f) => ({ ...f, project_id: e.target.value }))}
              >
                <option value="">All</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.project_id} value={p.project_id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {active === "fund_statement" && (
              <label className="block">
                <span className="mb-1 block text-3xs text-ink-3">Area</span>
                <select
                  className="field-underline text-[13px]"
                  value={filters.fund_id}
                  onChange={(e) => setFilters((f) => ({ ...f, fund_id: e.target.value }))}
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
              className="btn-quiet"
              onClick={() =>
                setFilters({ date_from: "", date_to: "", project_id: "", fund_id: "" })
              }
            >
              Clear filters
            </button>
          </div>
        </div>

        {/* the report */}
        <div className="min-w-0">
          {report.isError ? (
            <ErrorNote error={report.error} onRetry={() => report.refetch()} />
          ) : report.isLoading || !data ? (
            <Skeleton className="h-96" />
          ) : (
            <>
              <div className="mb-6 border-b border-rule pb-4">
                <h2 className="font-serif text-[24px] leading-tight">{data.title}</h2>
                <p className="mt-1.5 max-w-measure text-[13px] text-ink-2">
                  {NOTES[data.key] ?? ""}
                </p>
                <div className="annot mt-2">
                  {data.rows.length} rows · generated {data.generated_at.slice(0, 10)}
                </div>
              </div>

              {!data.rows.length ? (
                <Empty
                  title="Nothing in this period"
                  body="Widen the date range or clear the project filter."
                />
              ) : (
                <Ledger min={620}>
                  <thead>
                    <tr>
                      {data.columns.map((column) => (
                        <Th key={column.key} right={column.type === "money"}>
                          {column.label}
                        </Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, index) => (
                      <tr key={index}>
                        {data.columns.map((column) => (
                          <Td key={column.key} right={column.type === "money"}>
                            {column.type === "money" ? (
                              <Money paise={Number(row[column.key] ?? 0)} exact />
                            ) : (
                              String(row[column.key] ?? "—")
                            )}
                          </Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {Object.keys(data.totals).length > 0 && (
                    <tfoot>
                      <tr>
                        {data.columns.map((column, index) => (
                          <Td
                            key={column.key}
                            right={column.type === "money"}
                            className="border-t border-ink font-medium"
                          >
                            {index === 0
                              ? "Total"
                              : data.totals[column.key] !== undefined
                                ? column.type === "money"
                                  ? <Money paise={data.totals[column.key]} exact />
                                  : data.totals[column.key]
                                : ""}
                          </Td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </Ledger>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
