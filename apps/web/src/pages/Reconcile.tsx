import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  AREA_INK,
  Annot,
  Empty,
  ErrorNote,
  Ledger,
  Mark,
  Money,
  PageTitle,
  Section,
  Segmented,
  Skeleton,
  Td,
  Th,
  cx,
  useToast,
  type Area,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDateShort } from "../lib/money";
import type {
  Account,
  AreaKey,
  Category,
  Fund,
  ImportBatch,
  ImportPreview,
  StagedRow,
  Transaction,
  TransactionPage,
} from "../lib/types";

const STATE_NOTE: Record<StagedRow["state"], { label: string; colour: string }> = {
  new: { label: "New", colour: "var(--sap)" },
  manual_match: { label: "Already entered", colour: "var(--blueprint)" },
  duplicate: { label: "Already imported", colour: "var(--ink-3)" },
  possible_duplicate: { label: "Possible duplicate", colour: "var(--ochre)" },
  error: { label: "Unreadable", colour: "var(--oxide)" },
  committed: { label: "Imported", colour: "var(--ink-3)" },
};

export default function Reconcile() {
  return (
    <>
      <PageTitle sub="Your monthly check. Upload the UPI statement, confirm what you already entered by hand, and file anything left over.">
        Reconcile
      </PageTitle>
      <ImportSection />
      <UnfiledSection />
    </>
  );
}

/* ========================================================== 01 — import === */

function ImportSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const accounts = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts"),
  });
  const history = useQuery<ImportBatch[]>({
    queryKey: ["import-history"],
    queryFn: () => api.get<ImportBatch[]>("/import/history"),
  });

  useEffect(() => {
    if (!accountId && accounts.data?.length) {
      const upi = accounts.data.find((a) => /upi|phonepe|gpay|paytm/i.test(a.name));
      setAccountId(String((upi ?? accounts.data[0]).id));
    }
  }, [accounts.data, accountId]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("account_id", accountId);
      form.append("file", file);
      return api.upload<ImportPreview>("/import/upload", form);
    },
    onSuccess: (data) => setPreview(data),
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const patchRow = useMutation({
    mutationFn: ({ id, include }: { id: number; include: boolean }) =>
      api.patch(`/import/rows/${id}`, { include }),
    onSuccess: (_r, variables) =>
      setPreview((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) =>
                row.id === variables.id ? { ...row, include: variables.include } : row,
              ),
            }
          : current,
      ),
  });

  const link = useMutation({
    mutationFn: (id: number) => api.post(`/import/rows/${id}/link`),
    onSuccess: (result, id) => {
      toast.push((result as { message: string }).message);
      setPreview((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) =>
                row.id === id
                  ? { ...row, state: "manual_match", include: false }
                  : row,
              ),
            }
          : current,
      );
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const unlink = useMutation({
    mutationFn: (id: number) => api.post(`/import/rows/${id}/unlink`),
    onSuccess: (_r, id) =>
      setPreview((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) =>
                row.id === id ? { ...row, state: "new", include: true } : row,
              ),
            }
          : current,
      ),
  });

  const commit = useMutation({
    mutationFn: (batchId: number) => api.post(`/import/${batchId}/commit`),
    onSuccess: (result) => {
      const r = result as { created: number; needs_review: number };
      toast.push(
        `Imported ${r.created} ${r.created === 1 ? "entry" : "entries"}. ${r.needs_review} to file.`,
      );
      setPreview(null);
      queryClient.invalidateQueries();
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
  const included = preview?.rows.filter((row) => row.include).length ?? 0;

  return (
    <Section label="Statement" index="01">
      {!preview ? (
        <>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <label className="w-[220px]">
              <Annot className="mb-1.5">Into account</Annot>
              <select
                className="field"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {(accounts.data ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

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
              className="btn-solid"
              onClick={() => fileInput.current?.click()}
              disabled={upload.isPending || !accountId}
            >
              {upload.isPending ? "Reading…" : "Choose statement file"}
            </button>
            <p className="max-w-[42ch] text-2xs leading-relaxed text-ink-3">
              CSV or Excel, from any bank or UPI app. Nothing enters the ledger
              until you review it below.
            </p>
          </div>

          {history.data && history.data.length > 0 && (
            <div className="mt-8 border-t border-rule-soft pt-5">
              <Annot className="mb-3">Previous imports</Annot>
              <Ledger min={560}>
                <thead>
                  <tr>
                    <Th>File</Th>
                    <Th>Period</Th>
                    <Th right>Rows</Th>
                    <Th right>Imported</Th>
                    <Th right>Skipped</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((batch) => (
                    <tr key={batch.id}>
                      <Td className="max-w-[240px] truncate">{batch.filename}</Td>
                      <Td className="whitespace-nowrap text-ink-3">
                        {batch.period_start && batch.period_end
                          ? `${formatDateShort(batch.period_start)} — ${formatDateShort(batch.period_end)}`
                          : "—"}
                      </Td>
                      <Td right className="text-ink-3">{batch.row_count}</Td>
                      <Td right>{batch.new_count}</Td>
                      <Td right className="text-ink-3">{batch.dup_count}</Td>
                      <Td right>
                        {batch.status === "committed" && (
                          <button
                            className="btn-quiet"
                            onClick={() => revert.mutate(batch.id)}
                          >
                            Undo
                          </button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Ledger>
            </div>
          )}
        </>
      ) : (
        <>
          {preview.warnings?.map((warning, index) => (
            <p
              key={index}
              className="mb-3 border-l-2 border-ochre pl-3 text-[13px] leading-relaxed text-ink-2"
            >
              {warning}
            </p>
          ))}

          {counts && (
            <div className="mb-6 grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-5">
              <Count label="Rows read" value={counts.total} />
              <Count label="New" value={counts.new} colour="var(--sap)" />
              <Count
                label="Already entered"
                value={counts.matched_manually ?? 0}
                colour="var(--blueprint)"
              />
              <Count label="Already imported" value={counts.duplicates} />
              <Count label="To file" value={counts.needs_review} colour="var(--ochre)" />
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-serif text-[17px]">{preview.filename}</div>
              <Annot>
                {preview.period_start && preview.period_end
                  ? `${formatDateShort(preview.period_start)} — ${formatDateShort(preview.period_end)}`
                  : "No dates detected"}
              </Annot>
            </div>
            <div className="flex gap-3">
              <button className="btn-line" onClick={() => setPreview(null)}>
                Cancel
              </button>
              <button
                className="btn-solid"
                disabled={commit.isPending || !included}
                onClick={() => commit.mutate(preview.batch_id)}
              >
                {commit.isPending ? "Importing…" : `Import ${included}`}
              </button>
            </div>
          </div>

          <div className="max-h-[560px] overflow-auto border-t border-rule">
            <Ledger min={760}>
              <thead className="sticky top-0 z-10 bg-paper">
                <tr>
                  <Th>Take</Th>
                  <Th>Date</Th>
                  <Th>Entry</Th>
                  <Th right>Amount</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const note = STATE_NOTE[row.state];
                  return (
                    <tr
                      key={row.id}
                      className={cx(
                        row.state !== "new" && row.state !== "manual_match" && "opacity-55",
                      )}
                    >
                      <Td>
                        <input
                          type="checkbox"
                          checked={row.include}
                          disabled={row.state === "error"}
                          aria-label="Import this row"
                          onChange={(e) =>
                            patchRow.mutate({ id: row.id, include: e.target.checked })
                          }
                        />
                      </Td>
                      <Td className="whitespace-nowrap text-ink-3">
                        {row.value_date ? formatDateShort(row.value_date) : "—"}
                      </Td>
                      <Td className="max-w-[300px]">
                        <span className="block truncate" title={row.description}>
                          {row.description ?? row.errors?.[0] ?? "—"}
                        </span>
                        {row.suggestion?.category_name && (
                          <span className="text-3xs text-ink-3">
                            {row.suggestion.category_name} · {row.suggestion.reason}
                          </span>
                        )}
                      </Td>
                      <Td right>
                        {row.amount != null && (
                          <Money
                            paise={row.direction === "credit" ? row.amount : -row.amount}
                            exact
                            tone={row.direction === "credit" ? "in" : "out"}
                          />
                        )}
                      </Td>
                      <Td>
                        <Mark colour={note.colour}>{note.label}</Mark>
                      </Td>
                      <Td right>
                        {row.state === "manual_match" && (
                          <button
                            className="btn-quiet"
                            onClick={() => unlink.mutate(row.id)}
                          >
                            Not the same
                          </button>
                        )}
                        {row.state === "possible_duplicate" && (
                          <button
                            className="btn-quiet"
                            onClick={() => link.mutate(row.id)}
                          >
                            Same as mine
                          </button>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Ledger>
          </div>

          <p className="mt-4 max-w-measure border-l-2 border-rule pl-3 text-2xs leading-relaxed text-ink-3">
            Rows marked <em>already entered</em> match something you typed in
            yourself — same amount, same few days. They are not imported again,
            because that would double the expense. The bank's reference is copied
            onto your entry instead.
          </p>
        </>
      )}
    </Section>
  );
}

function Count({
  label,
  value,
  colour,
}: {
  label: string;
  value: number;
  colour?: string;
}) {
  return (
    <div className="bg-paper px-4 py-3">
      <Annot>{label}</Annot>
      <div
        className="mt-0.5 font-serif text-[24px] leading-none tnum"
        style={colour ? { color: colour } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

/* ========================================================= 02 — unfiled === */

function UnfiledSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<number, { fundId: string; categoryId: string }>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkArea, setBulkArea] = useState<AreaKey>("personal");
  const [bulkFund, setBulkFund] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");

  const queue = useQuery<TransactionPage>({
    queryKey: ["unfiled"],
    queryFn: () =>
      api.get<TransactionPage>("/transactions", { needs_review: true, limit: 300 }),
  });
  const funds = useQuery<Fund[]>({
    queryKey: ["funds"],
    queryFn: () => api.get<Fund[]>("/funds"),
  });
  const categories = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });

  const rows = queue.data?.items ?? [];
  const assignable = (funds.data ?? []).filter((f) => f.kind !== "unassigned");
  const personalFund = assignable.find((f) => f.kind === "personal");

  const fundsForArea = (area: AreaKey) =>
    assignable.filter((f) =>
      area === "personal"
        ? f.kind === "personal"
        : area === "professional"
          ? f.kind === "project"
          : f.kind === "savings",
    );

  const categoriesFor = (fundId: string) => {
    const fund = assignable.find((f) => f.id === Number(fundId));
    const scope = fund?.kind === "project" ? "project" : "personal";
    return (categories.data ?? []).filter(
      (c) => c.scope === scope || c.scope === "both",
    );
  };

  const kindFor = (fundKind: string | undefined, direction: string) =>
    fundKind === "project"
      ? direction === "credit"
        ? "client_payment"
        : "vendor_payment"
      : direction === "credit"
        ? "personal_income"
        : "personal_spend";

  const fileOne = useMutation({
    mutationFn: async (txn: Transaction) => {
      const draft = drafts[txn.id] ?? {
        fundId: String(txn.suggestion?.fund_id ?? personalFund?.id ?? ""),
        categoryId: String(txn.suggestion?.category_id ?? ""),
      };
      if (!draft.fundId) throw new Error("Choose where this belongs.");
      const fund = assignable.find((f) => f.id === Number(draft.fundId));
      return api.patch(`/transactions/${txn.id}`, {
        kind: kindFor(fund?.kind, txn.direction),
        splits: [
          {
            fund_id: Number(draft.fundId),
            amount: txn.amount,
            category_id: draft.categoryId ? Number(draft.categoryId) : null,
          },
        ],
      });
    },
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const fileMany = useMutation({
    mutationFn: async () => {
      const fund = assignable.find((f) => f.id === Number(bulkFund));
      const sample = rows.find((r) => selected.has(r.id));
      return api.post("/transactions/bulk-categorise", {
        transaction_ids: [...selected],
        fund_id: Number(bulkFund),
        category_id: bulkCategory ? Number(bulkCategory) : null,
        kind: kindFor(fund?.kind, sample?.direction ?? "debit"),
      });
    },
    onSuccess: (result) => {
      const count = (result as { updated: number }).updated;
      toast.push(`Filed ${count} ${count === 1 ? "entry" : "entries"}.`);
      setSelected(new Set());
      setBulkFund("");
      setBulkCategory("");
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  useEffect(() => {
    const options = fundsForArea(bulkArea);
    setBulkFund(options.length === 1 ? String(options[0].id) : "");
    setBulkCategory("");
  }, [bulkArea, funds.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (queue.isError) {
    return <ErrorNote error={queue.error} onRetry={() => queue.refetch()} />;
  }

  // Group by merchant so fourteen cement purchases are one decision.
  const groups = new Map<string, Transaction[]>();
  for (const txn of rows) {
    const key = txn.description_norm || txn.description_raw || "Unknown";
    groups.set(key, [...(groups.get(key) ?? []), txn]);
  }
  const repeated = [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 14);

  return (
    <Section label="Unfiled" index="02">
      {queue.isLoading ? (
        <Skeleton className="h-64" />
      ) : !rows.length ? (
        <Empty
          title="Everything is filed"
          body="Every entry belongs to Personal, Professional or Savings. Imported rows land here first until you say where they go."
        />
      ) : (
        <>
          <p className="mb-5 max-w-measure text-[13px] leading-relaxed text-ink-2">
            <span className="tnum">{rows.length}</span> entries are not yet
            assigned to an area. They still count against your bank balance —
            they are simply not attributed yet.
          </p>

          {repeated.length > 0 && (
            <div className="mb-6 border-y border-rule-soft py-4">
              <Annot className="mb-2.5">Same payee, more than once</Annot>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {repeated.map(([name, group]) => (
                  <button
                    key={name}
                    onClick={() => setSelected(new Set(group.map((t) => t.id)))}
                    className="btn-quiet"
                  >
                    {name.slice(0, 30)}
                    <span className="tnum text-ink-3"> ×{group.length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selected.size > 0 && (
            <div
              className="animate-rise mb-5 flex flex-wrap items-end gap-x-4 gap-y-3 border border-ink px-4 py-3"
              style={{ boxShadow: `inset 3px 0 0 ${AREA_INK[bulkArea as Area]}` }}
            >
              <div className="pb-1.5">
                <Annot>Selected</Annot>
                <div className="font-serif text-[20px] leading-none tnum">
                  {selected.size}
                </div>
              </div>
              <div className="w-[260px]">
                <Annot className="mb-1.5">Area</Annot>
                <Segmented<AreaKey>
                  value={bulkArea}
                  onChange={setBulkArea}
                  colourise
                  options={[
                    { value: "personal", label: "Personal" },
                    { value: "professional", label: "Studio" },
                    { value: "savings", label: "Savings" },
                  ]}
                />
              </div>
              {fundsForArea(bulkArea).length > 1 && (
                <div className="w-[170px]">
                  <Annot className="mb-1.5">
                    {bulkArea === "professional" ? "Project" : "Goal"}
                  </Annot>
                  <select
                    className="field-underline text-[13px]"
                    value={bulkFund}
                    onChange={(e) => setBulkFund(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {fundsForArea(bulkArea).map((fund) => (
                      <option key={fund.id} value={fund.id}>
                        {fund.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="w-[170px]">
                <Annot className="mb-1.5">Category</Annot>
                <select
                  className="field-underline text-[13px]"
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  disabled={!bulkFund}
                >
                  <option value="">—</option>
                  {categoriesFor(bulkFund).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn-solid"
                disabled={!bulkFund || fileMany.isPending}
                onClick={() => fileMany.mutate()}
              >
                {fileMany.isPending ? "Filing…" : `File ${selected.size}`}
              </button>
              <button className="btn-quiet pb-2" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          )}

          <Ledger min={860}>
            <thead>
              <tr>
                <Th>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(rows.map((r) => r.id)) : new Set(),
                      )
                    }
                  />
                </Th>
                <Th>Date</Th>
                <Th>Entry</Th>
                <Th right>Amount</Th>
                <Th>Belongs to</Th>
                <Th>Category</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((txn) => {
                const draft = drafts[txn.id] ?? {
                  fundId: String(txn.suggestion?.fund_id ?? ""),
                  categoryId: String(txn.suggestion?.category_id ?? ""),
                };
                return (
                  <tr
                    key={txn.id}
                    className={cx(selected.has(txn.id) && "bg-paper-2/70")}
                  >
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${txn.description_norm}`}
                        checked={selected.has(txn.id)}
                        onChange={(e) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            e.target.checked ? next.add(txn.id) : next.delete(txn.id);
                            return next;
                          })
                        }
                      />
                    </Td>
                    <Td className="whitespace-nowrap text-ink-3">
                      {formatDateShort(txn.value_date)}
                    </Td>
                    <Td className="max-w-[260px]">
                      <span className="block truncate" title={txn.description_raw}>
                        {txn.description_norm || txn.description_raw}
                      </span>
                      {txn.suggestion?.reason && (
                        <span className="text-3xs text-ink-3">
                          {txn.suggestion.reason}
                        </span>
                      )}
                    </Td>
                    <Td right>
                      <Money
                        paise={txn.signed_amount}
                        exact
                        tone={txn.direction === "credit" ? "in" : "out"}
                      />
                    </Td>
                    <Td>
                      <select
                        className="field-underline text-[12px]"
                        value={draft.fundId}
                        onChange={(e) =>
                          setDrafts((current) => ({
                            ...current,
                            [txn.id]: { fundId: e.target.value, categoryId: "" },
                          }))
                        }
                      >
                        <option value="">Choose…</option>
                        {assignable.map((fund) => (
                          <option key={fund.id} value={fund.id}>
                            {fund.kind === "personal"
                              ? "Personal"
                              : fund.kind === "savings"
                                ? `Savings — ${fund.name}`
                                : fund.name}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td>
                      <select
                        className="field-underline text-[12px]"
                        value={draft.categoryId}
                        disabled={!draft.fundId}
                        onChange={(e) =>
                          setDrafts((current) => ({
                            ...current,
                            [txn.id]: { ...draft, categoryId: e.target.value },
                          }))
                        }
                      >
                        <option value="">—</option>
                        {categoriesFor(draft.fundId).map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td right>
                      <button
                        className="btn-line btn-sm"
                        disabled={!draft.fundId || fileOne.isPending}
                        onClick={() => fileOne.mutate(txn)}
                      >
                        File
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Ledger>
        </>
      )}
    </Section>
  );
}
