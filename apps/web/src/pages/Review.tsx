import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Money,
  PageHeader,
  Skeleton,
  cx,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDateShort, humanise } from "../lib/money";
import type { Category, Fund, Transaction, TransactionPage } from "../lib/types";

/** Fund + direction determine the kind. Keeps review to two decisions a row. */
function deriveKind(fundKind: string | undefined, direction: string): string {
  if (fundKind === "project") {
    return direction === "credit" ? "client_payment" : "vendor_payment";
  }
  if (fundKind === "personal") {
    return direction === "credit" ? "personal_income" : "personal_spend";
  }
  return "uncategorised";
}

type Draft = { fundId: number | null; categoryId: number | null };

export default function Review() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [grouped, setGrouped] = useState(false);
  const [bulkFund, setBulkFund] = useState<string>("");
  const [bulkCategory, setBulkCategory] = useState<string>("");
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const queue = useQuery<TransactionPage>({
    queryKey: ["review"],
    queryFn: () =>
      api.get<TransactionPage>("/transactions", {
        needs_review: true,
        limit: 200,
      }),
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

  const categoriesFor = (fundId: number | null) => {
    const fund = assignable.find((f) => f.id === fundId);
    const scope = fund?.kind === "personal" ? "personal" : "project";
    return (categories.data ?? []).filter(
      (c) => c.scope === scope || c.scope === "both",
    );
  };

  const draftFor = (txn: Transaction): Draft =>
    drafts[txn.id] ?? {
      fundId: txn.suggestion?.fund_id ?? null,
      categoryId: txn.suggestion?.category_id ?? null,
    };

  const setDraft = (id: number, patch: Partial<Draft>) =>
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { fundId: null, categoryId: null }), ...patch },
    }));

  /* ----------------------------------------------------------- mutations */

  const confirmOne = useMutation({
    mutationFn: async (txn: Transaction) => {
      const draft = draftFor(txn);
      if (!draft.fundId) throw new Error("Choose a fund first");
      const fund = assignable.find((f) => f.id === draft.fundId);
      return api.patch(`/transactions/${txn.id}`, {
        kind: deriveKind(fund?.kind, txn.direction),
        splits: [
          {
            fund_id: draft.fundId,
            amount: txn.amount,
            category_id: draft.categoryId,
          },
        ],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const confirmMany = useMutation({
    mutationFn: async () => {
      const fundId = Number(bulkFund);
      const fund = assignable.find((f) => f.id === fundId);
      const ids = [...selected];
      const sample = rows.find((r) => r.id === ids[0]);
      return api.post("/transactions/bulk-categorise", {
        transaction_ids: ids,
        fund_id: fundId,
        category_id: bulkCategory ? Number(bulkCategory) : null,
        kind: deriveKind(fund?.kind, sample?.direction ?? "debit"),
      });
    },
    onSuccess: (result) => {
      const count = (result as { updated: number }).updated;
      toast.push(`Categorised ${count} transaction${count === 1 ? "" : "s"}.`);
      setSelected(new Set());
      setBulkFund("");
      setBulkCategory("");
      queryClient.invalidateQueries({ queryKey: ["review"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (!rows.length) return;

      const txn = rows[cursor];
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((c) => Math.min(rows.length - 1, c + 1));
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (event.key === "x" && txn) {
        event.preventDefault();
        setSelected((current) => {
          const next = new Set(current);
          next.has(txn.id) ? next.delete(txn.id) : next.add(txn.id);
          return next;
        });
      } else if (event.key === "e" && txn) {
        event.preventDefault();
        const personal = assignable.find((f) => f.kind === "personal");
        if (personal) setDraft(txn.id, { fundId: personal.id });
      } else if (event.key === "Enter" && txn) {
        event.preventDefault();
        confirmOne.mutate(txn);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, cursor, assignable, drafts]);

  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  /* -------------------------------------------------------------- render */

  const merchantGroups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const txn of rows) {
      const key = txn.description_norm || txn.description_raw || "Unknown";
      map.set(key, [...(map.get(key) ?? []), txn]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rows]);

  if (queue.isError) {
    return <ErrorState error={queue.error} onRetry={() => queue.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title="Review"
        subtitle="Transactions sitting in the Unassigned fund until you classify them"
      >
        <button
          className="btn-ghost"
          onClick={() => setGrouped((g) => !g)}
          disabled={!rows.length}
        >
          {grouped ? "Show as list" : "Group by merchant"}
        </button>
      </PageHeader>

      {queue.isLoading ? (
        <Skeleton className="h-80" />
      ) : !rows.length ? (
        <EmptyState
          title="Nothing to review"
          message="Every transaction is attributed to a fund. Import a statement or add an expense and anything unclassified will appear here."
        />
      ) : (
        <>
          {/* ----------------------------------------------------- bulk bar */}
          {selected.size > 0 && (
            <Card className="mb-3 animate-in border-accent/40 bg-accent-soft" padded={false}>
              <div className="flex flex-wrap items-center gap-3 p-3">
                <span className="text-[13px] font-medium">
                  {selected.size} selected
                </span>
                <select
                  className="field w-auto min-w-[180px] py-1.5 text-[13px]"
                  value={bulkFund}
                  onChange={(e) => {
                    setBulkFund(e.target.value);
                    setBulkCategory("");
                  }}
                >
                  <option value="">Assign to fund…</option>
                  {assignable.map((fund) => (
                    <option key={fund.id} value={fund.id}>
                      {fund.kind === "personal" ? "Personal" : fund.name}
                    </option>
                  ))}
                </select>
                <select
                  className="field w-auto min-w-[160px] py-1.5 text-[13px]"
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  disabled={!bulkFund}
                >
                  <option value="">Category (optional)</option>
                  {categoriesFor(bulkFund ? Number(bulkFund) : null).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-primary btn-sm"
                  disabled={!bulkFund || confirmMany.isPending}
                  onClick={() => confirmMany.mutate()}
                >
                  {confirmMany.isPending ? "Applying…" : `Apply to ${selected.size}`}
                </button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </button>
              </div>
            </Card>
          )}

          {grouped && (
            <Card className="mb-3">
              <p className="mb-3 text-[12px] text-ink-3">
                Same merchant, one decision. Click a group to select all of its rows.
              </p>
              <div className="flex flex-wrap gap-2">
                {merchantGroups.map(([name, group]) => (
                  <button
                    key={name}
                    onClick={() =>
                      setSelected(new Set(group.map((txn) => txn.id)))
                    }
                    className="rounded border border-line px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
                  >
                    {name.slice(0, 32)}
                    <span className="ml-1.5 font-mono text-2xs text-ink-3">
                      ×{group.length}
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse">
              <thead>
                <tr>
                  <th className="w-9 border-b border-line bg-surface-2 px-3 py-2">
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
                  </th>
                  <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left font-medium">
                    Date
                  </th>
                  <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left font-medium">
                    Description
                  </th>
                  <th className="label border-b border-line bg-surface-2 px-3 py-2 text-right font-medium">
                    Amount
                  </th>
                  <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left font-medium">
                    Fund
                  </th>
                  <th className="label border-b border-line bg-surface-2 px-3 py-2 text-left font-medium">
                    Category
                  </th>
                  <th className="w-24 border-b border-line bg-surface-2 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((txn, index) => {
                  const draft = draftFor(txn);
                  const isCursor = index === cursor;
                  return (
                    <tr
                      key={txn.id}
                      ref={(el) => (rowRefs.current[index] = el)}
                      onClick={() => setCursor(index)}
                      className={cx(
                        "border-b border-line-soft transition-colors",
                        isCursor && "bg-accent-soft/50",
                        selected.has(txn.id) && "bg-accent-soft",
                      )}
                    >
                      <td className="px-3 py-2.5">
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
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[12px] tabular text-ink-2">
                        {formatDateShort(txn.value_date)}
                      </td>
                      <td className="max-w-[300px] px-3 py-2.5">
                        <div className="truncate text-[13px]" title={txn.description_raw}>
                          {txn.description_norm || txn.description_raw}
                        </div>
                        {txn.suggestion?.reason && (
                          <div className="mt-1 flex items-center gap-1.5">
                            <Chip
                              tone={
                                txn.suggestion.confidence >= 0.85 ? "accent" : "neutral"
                              }
                            >
                              {txn.suggestion.reason}
                            </Chip>
                            {(txn.suggestion.fund_id || txn.suggestion.category_id) && (
                              <button
                                className="text-2xs text-accent hover:underline"
                                onClick={() =>
                                  setDraft(txn.id, {
                                    fundId: txn.suggestion?.fund_id ?? draft.fundId,
                                    categoryId:
                                      txn.suggestion?.category_id ?? draft.categoryId,
                                  })
                                }
                              >
                                use
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <Money
                          paise={txn.signed_amount}
                          signed
                          exact
                          className="text-[13px] font-medium"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          className="field py-1 text-[12px]"
                          value={draft.fundId ?? ""}
                          onChange={(e) =>
                            setDraft(txn.id, {
                              fundId: e.target.value ? Number(e.target.value) : null,
                              categoryId: null,
                            })
                          }
                        >
                          <option value="">Choose…</option>
                          {assignable.map((fund) => (
                            <option key={fund.id} value={fund.id}>
                              {fund.kind === "personal" ? "Personal" : fund.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          className="field py-1 text-[12px]"
                          value={draft.categoryId ?? ""}
                          disabled={!draft.fundId}
                          onChange={(e) =>
                            setDraft(txn.id, {
                              categoryId: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                        >
                          <option value="">—</option>
                          {categoriesFor(draft.fundId).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          className="btn-primary btn-sm"
                          disabled={!draft.fundId || confirmOne.isPending}
                          onClick={() => confirmOne.mutate(txn)}
                        >
                          Confirm
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 font-mono text-2xs text-ink-3">
            <kbd className="rounded border border-line px-1">J</kbd>
            <kbd className="ml-1 rounded border border-line px-1">K</kbd> move ·{" "}
            <kbd className="rounded border border-line px-1">X</kbd> select ·{" "}
            <kbd className="rounded border border-line px-1">E</kbd> personal ·{" "}
            <kbd className="rounded border border-line px-1">Enter</kbd> confirm
          </p>
        </>
      )}
    </>
  );
}
