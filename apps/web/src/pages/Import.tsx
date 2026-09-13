import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Card,
  Chip,
  Field,
  Money,
  PageHeader,
  SectionTitle,
  Td,
  Th,
  cx,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDateShort } from "../lib/money";
import type { Account, ImportBatch, ImportPreview } from "../lib/types";

const STATE_TONE = {
  new: "pos",
  duplicate: "neutral",
  possible_duplicate: "warn",
  error: "neg",
  committed: "accent",
} as const;

const STATE_LABEL = {
  new: "New",
  duplicate: "Duplicate",
  possible_duplicate: "Possible duplicate",
  error: "Could not read",
  committed: "Imported",
} as const;

export default function ImportPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [accountId, setAccountId] = useState<string>("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const accounts = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts"),
  });

  const history = useQuery<ImportBatch[]>({
    queryKey: ["import-history"],
    queryFn: () => api.get<ImportBatch[]>("/import/history"),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("account_id", accountId || String(accounts.data?.[0]?.id ?? ""));
      form.append("file", file);
      return api.upload<ImportPreview>("/import/upload", form);
    },
    onSuccess: (data) => {
      setPreview(data);
      queryClient.invalidateQueries({ queryKey: ["import-history"] });
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const patchRow = useMutation({
    mutationFn: ({ id, include }: { id: number; include: boolean }) =>
      api.patch(`/import/rows/${id}`, { include }),
    onSuccess: (_result, variables) => {
      setPreview((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) =>
                row.id === variables.id ? { ...row, include: variables.include } : row,
              ),
            }
          : current,
      );
    },
  });

  const commit = useMutation({
    mutationFn: (batchId: number) => api.post(`/import/${batchId}/commit`),
    onSuccess: (result) => {
      const r = result as { created: number; auto_categorised: number; needs_review: number };
      toast.push(
        `Imported ${r.created} transactions — ${r.auto_categorised} categorised automatically, ${r.needs_review} to review.`,
      );
      setPreview(null);
      queryClient.invalidateQueries();
      if (r.needs_review > 0) navigate("/review");
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const revert = useMutation({
    mutationFn: (batchId: number) => api.del(`/import/${batchId}`),
    onSuccess: () => {
      toast.push("Import undone.");
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const counts = preview?.counts;

  return (
    <>
      <PageHeader
        title="Import a statement"
        subtitle="CSV or Excel from any bank. Nothing enters the ledger until you commit."
      />

      {!preview && (
        <Card className="mb-3">
          <div className="grid gap-4 sm:grid-cols-[240px_1fr] sm:items-end">
            <Field label="Import into">
              <select
                className="field"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {(accounts.data ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                    {account.last4 ? ` ••${account.last4}` : ""}
                  </option>
                ))}
              </select>
            </Field>

            <div>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.xlsx,.xlsm,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate(file);
                  e.target.value = "";
                }}
              />
              <button
                className="btn-primary w-full sm:w-auto"
                onClick={() => fileInput.current?.click()}
                disabled={upload.isPending || !accounts.data?.length}
              >
                {upload.isPending ? "Reading…" : "Choose a statement file"}
              </button>
            </div>
          </div>

          <p className="mt-4 border-t border-line-soft pt-3 text-[12px] leading-relaxed text-ink-3">
            Studio Ledger only reads statements you download yourself. It never
            asks for and cannot accept a bank password, net-banking login, UPI
            PIN, card PIN, CVV or OTP. If your bank only offers a PDF, export to
            Excel or CSV from net banking first.
          </p>
        </Card>
      )}

      {/* ------------------------------------------------------------- preview */}
      {preview && (
        <>
          {preview.warnings?.map((warning, index) => (
            <div
              key={index}
              className="mb-2 rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-[13px] text-ink-2"
            >
              {warning}
            </div>
          ))}

          {preview.needs_mapping && (
            <Card className="mb-3 border-warn/40">
              <SectionTitle>This layout was not recognised</SectionTitle>
              <p className="mb-3 text-[13px] text-ink-2">
                The first rows of your file are below. Re-upload after saving a
                column mapping, or send this file so a profile can be added for
                your bank.
              </p>
              <div className="overflow-x-auto rounded border border-line">
                <table className="w-full border-collapse text-[11px]">
                  <tbody>
                    {(preview.preview_grid ?? []).slice(0, 8).map((row, i) => (
                      <tr key={i} className="border-b border-line-soft last:border-0">
                        {row.map((cell, j) => (
                          <td key={j} className="max-w-[160px] truncate px-2 py-1.5">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {counts && (
            <div className="mb-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Rows read" value={counts.total} />
              <Stat label="New" value={counts.new} tone="pos" />
              <Stat label="Duplicates" value={counts.duplicates} tone="warn" />
              <Stat label="Auto-categorised" value={counts.auto_categorised} tone="accent" />
              <Stat label="To review" value={counts.needs_review} />
            </div>
          )}

          <Card padded={false} className="mb-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft p-4">
              <div>
                <div className="text-[13px] font-medium">{preview.filename}</div>
                <div className="text-2xs text-ink-3">
                  {preview.period_start && preview.period_end
                    ? `${formatDateShort(preview.period_start)} — ${formatDateShort(preview.period_end)}`
                    : "No date range detected"}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => setPreview(null)}>
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  disabled={commit.isPending || !counts?.new}
                  onClick={() => commit.mutate(preview.batch_id)}
                >
                  {commit.isPending
                    ? "Importing…"
                    : `Import ${preview.rows.filter((r) => r.include).length} transactions`}
                </button>
              </div>
            </div>

            <div className="max-h-[540px] overflow-auto">
              <table className="w-full min-w-[880px] border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <Th>Include</Th>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th right>Amount</Th>
                    <Th>Status</Th>
                    <Th>Suggested</Th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr
                      key={row.id}
                      className={cx(
                        row.state === "duplicate" && "opacity-55",
                        row.state === "error" && "bg-neg-soft/40",
                      )}
                    >
                      <Td>
                        <input
                          type="checkbox"
                          checked={row.include}
                          disabled={row.state === "error"}
                          aria-label="Include this row"
                          onChange={(e) =>
                            patchRow.mutate({ id: row.id, include: e.target.checked })
                          }
                        />
                      </Td>
                      <Td className="whitespace-nowrap text-ink-2">
                        {row.value_date ? formatDateShort(row.value_date) : "—"}
                      </Td>
                      <Td className="max-w-[300px]">
                        <span className="block truncate" title={row.description}>
                          {row.description ?? (row.errors?.[0] ?? "—")}
                        </span>
                        {row.errors?.length > 0 && (
                          <span className="text-2xs text-neg">{row.errors[0]}</span>
                        )}
                      </Td>
                      <Td right>
                        {row.amount != null && (
                          <Money
                            paise={row.direction === "credit" ? row.amount : -row.amount}
                            signed
                            exact
                            className="font-medium"
                          />
                        )}
                      </Td>
                      <Td>
                        <Chip tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Chip>
                      </Td>
                      <Td>
                        {row.suggestion?.reason ? (
                          <span className="text-2xs text-ink-2">
                            {row.suggestion.category_name && (
                              <strong className="font-medium">
                                {row.suggestion.category_name}
                              </strong>
                            )}
                            {row.suggestion.category_name ? " · " : ""}
                            {row.suggestion.reason}
                          </span>
                        ) : (
                          <span className="text-2xs text-ink-3">—</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ------------------------------------------------------------- history */}
      {!preview && (
        <Card padded={false}>
          <div className="p-5 pb-0">
            <SectionTitle>Import history</SectionTitle>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <Th>File</Th>
                  <Th>Period</Th>
                  <Th right>Rows</Th>
                  <Th right>New</Th>
                  <Th right>Duplicates</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {(history.data ?? []).map((batch) => (
                  <tr key={batch.id}>
                    <Td className="max-w-[220px] truncate font-medium">
                      {batch.filename}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">
                      {batch.period_start && batch.period_end
                        ? `${formatDateShort(batch.period_start)} — ${formatDateShort(batch.period_end)}`
                        : "—"}
                    </Td>
                    <Td right className="text-ink-2">{batch.row_count}</Td>
                    <Td right className="text-pos">{batch.new_count}</Td>
                    <Td right className="text-ink-3">{batch.dup_count}</Td>
                    <Td>
                      <Chip tone={batch.status === "committed" ? "pos" : "neutral"}>
                        {batch.status}
                      </Chip>
                    </Td>
                    <Td right>
                      {batch.status === "committed" && (
                        <button
                          className="text-2xs text-ink-3 hover:text-neg"
                          onClick={() => revert.mutate(batch.id)}
                        >
                          Undo
                        </button>
                      )}
                    </Td>
                  </tr>
                ))}
                {!history.data?.length && (
                  <tr>
                    <Td className="py-8 text-center text-ink-3">
                      No statements imported yet.
                    </Td>
                    <Td /><Td /><Td /><Td /><Td /><Td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "pos" | "warn" | "accent";
}) {
  const colour = {
    neutral: "text-ink",
    pos: "text-pos",
    warn: "text-warn",
    accent: "text-accent",
  }[tone];
  return (
    <div className="card p-3.5">
      <div className="label">{label}</div>
      <div className={cx("mt-0.5 text-xl font-semibold tabular", colour)}>{value}</div>
    </div>
  );
}
