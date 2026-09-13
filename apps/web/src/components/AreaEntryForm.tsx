import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "../lib/api";
import { rupeesToPaise } from "../lib/money";
import type { Account, AreaKey, Category, Fund } from "../lib/types";
import { AREA_INK, Annot, Segmented, useToast } from "./ui";

type Direction = "debit" | "credit";

const OTHERS = "__others__";

/**
 * Record what you just spent or received, scoped to the area whose page you
 * are already on. No area chooser — the page you're standing on says which
 * fund this files against, so the form asks only what that area needs.
 *
 * "What for" and "Category" are one field: pick a category, or "Others" to
 * name your own on the spot. It becomes a real category, so it's there next
 * time too. This is the main way expenses get entered, so it stays a strip
 * on the page, not a dialog to open and dismiss.
 */
export default function AreaEntryForm({ area }: { area: AreaKey }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const amountRef = useRef<HTMLInputElement>(null);

  const [direction, setDirection] = useState<Direction>("debit");
  const [amount, setAmount] = useState("");
  const [categoryChoice, setCategoryChoice] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [note, setNote] = useState("");
  const [fundId, setFundId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));
  const [expanded, setExpanded] = useState(false);

  const accounts = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts"),
  });
  const categories = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const funds = useQuery<Fund[]>({
    queryKey: ["funds"],
    queryFn: () => api.get<Fund[]>("/funds"),
  });

  const isProfessional = area === "professional";
  const isSavings = area === "savings";
  const accent = AREA_INK[area];

  const projectFunds = (funds.data ?? []).filter((f) => f.kind === "project");
  const scope = isProfessional ? "project" : "personal";
  const categoryOptions = (categories.data ?? []).filter(
    (c) => c.scope === scope || c.scope === "both",
  );

  useEffect(() => {
    if (!accountId && accounts.data?.length) setAccountId(String(accounts.data[0].id));
  }, [accounts.data, accountId]);

  useEffect(() => {
    if (isProfessional && projectFunds.length && !fundId) {
      setFundId(String(projectFunds[0].id));
    }
  }, [isProfessional, projectFunds, fundId]);

  // E starts an expense, M starts money received, wherever on the page you are.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "e" || event.key === "m") {
        event.preventDefault();
        setDirection(event.key === "e" ? "debit" : "credit");
        amountRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const reset = () => {
    setAmount("");
    setCategoryChoice("");
    setCustomCategory("");
    setNote("");
    setWhen(new Date().toISOString().slice(0, 10));
    amountRef.current?.focus();
  };

  /** Resolve "Others" + a typed name into a real category, reusing one that
   * already exists under that name rather than creating a duplicate. */
  const resolveCategoryId = async (): Promise<number | null> => {
    if (isSavings) return null;
    if (categoryChoice && categoryChoice !== OTHERS) return Number(categoryChoice);
    const name = customCategory.trim();
    if (!name) return null;

    try {
      const created = await api.post<Category>("/categories", {
        name,
        scope,
        colour: accent,
      });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      return created.id;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const fresh = await api.get<Category[]>("/categories", { scope });
        const match = fresh.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (match) return match.id;
      }
      throw error;
    }
  };

  const record = useMutation({
    mutationFn: async () => {
      const paise = rupeesToPaise(amount);
      if (!paise || paise <= 0) throw new Error("Enter an amount.");
      if (!accountId) throw new Error("No account to record this against.");

      const target = isProfessional
        ? Number(fundId)
        : (funds.data ?? []).find((f) => f.kind === area)?.id;
      if (!target) throw new Error("No fund to file this against.");

      const categoryId = await resolveCategoryId();
      const categoryName =
        categoryChoice === OTHERS
          ? customCategory.trim()
          : categoryOptions.find((c) => c.id === Number(categoryChoice))?.name;

      const kind = isProfessional
        ? direction === "credit"
          ? "client_payment"
          : "vendor_payment"
        : direction === "credit"
          ? "personal_income"
          : "personal_spend";

      const description =
        note.trim() ||
        categoryName ||
        (direction === "debit" ? "Expense" : "Money received");

      return api.post("/transactions", {
        account_id: Number(accountId),
        value_date: when,
        direction,
        amount: paise,
        kind,
        description,
        splits: [{ fund_id: target, amount: paise, category_id: categoryId }],
      });
    },
    onSuccess: () => {
      toast.push(
        `${direction === "debit" ? "Recorded" : "Received"} ₹${amount}${
          note ? ` — ${note}` : ""
        }.`,
      );
      reset();
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  return (
    <div
      className="no-print mb-8 border border-rule"
      style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
    >
      <form
        className="p-4"
        onSubmit={(event) => {
          event.preventDefault();
          record.mutate();
        }}
      >
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="w-[176px] shrink-0">
            <Annot className="mb-1.5">Entry</Annot>
            <Segmented<Direction>
              value={direction}
              onChange={setDirection}
              colours={{ debit: "var(--oxide)", credit: "var(--sap)" }}
              options={[
                { value: "debit", label: "Spent" },
                { value: "credit", label: "Received" },
              ]}
            />
          </div>

          <div className="w-[152px] shrink-0">
            <Annot className="mb-1.5">Amount</Annot>
            <div className="flex items-baseline border-b border-ink">
              <span className="pb-1 pr-1.5 font-serif text-[22px] text-ink-3">₹</span>
              <input
                ref={amountRef}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                aria-label="Amount"
                className="w-full bg-transparent pb-1 font-serif text-[26px] leading-none
                           tnum outline-none placeholder:text-ink-3/50"
              />
            </div>
          </div>

          {isProfessional && (
            <div className="w-[170px] shrink-0">
              <Annot className="mb-1.5">Project</Annot>
              <select
                value={fundId}
                onChange={(e) => setFundId(e.target.value)}
                className="field-underline text-[13px]"
              >
                {projectFunds.length === 0 && <option value="">No projects yet</option>}
                {projectFunds.map((fund) => (
                  <option key={fund.id} value={fund.id}>
                    {fund.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isSavings ? (
            <div className="min-w-[200px] flex-1">
              <Annot className="mb-1.5">Note</Annot>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
                className="field-underline text-[15px]"
              />
            </div>
          ) : (
            <>
              <div className="w-[176px] shrink-0">
                <Annot className="mb-1.5">Category</Annot>
                <select
                  value={categoryChoice}
                  onChange={(e) => setCategoryChoice(e.target.value)}
                  className="field-underline text-[13px]"
                >
                  <option value="">Choose…</option>
                  {categoryOptions.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                  <option value={OTHERS}>Others…</option>
                </select>
              </div>
              {categoryChoice === OTHERS ? (
                <div className="min-w-[160px] flex-1">
                  <Annot className="mb-1.5">Name it</Annot>
                  <input
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="e.g. Pet care"
                    autoFocus
                    className="field-underline text-[15px]"
                  />
                </div>
              ) : (
                <div className="min-w-[160px] flex-1">
                  <Annot className="mb-1.5">Note</Annot>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional"
                    className="field-underline text-[15px]"
                  />
                </div>
              )}
            </>
          )}

          <button
            type="submit"
            disabled={record.isPending || !amount}
            className="btn-solid h-[34px] shrink-0 px-5"
          >
            {record.isPending ? "Saving…" : "Record"}
          </button>

          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="h-[34px] shrink-0 px-1 text-2xs text-ink-3 hover:text-ink"
            aria-expanded={expanded}
          >
            {expanded ? "Less" : "More"}
          </button>
        </div>

        {expanded && (
          <div className="animate-rise mt-3 flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-rule-soft pt-3">
            <div className="w-[150px]">
              <Annot className="mb-1.5">Date</Annot>
              <input
                type="date"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="field-underline text-[13px]"
              />
            </div>
            <div className="w-[180px]">
              <Annot className="mb-1.5">Account</Annot>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="field-underline text-[13px]"
              >
                {(accounts.data ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="ml-auto max-w-[36ch] pb-1 text-2xs leading-relaxed text-ink-3">
              Press E for an expense, M for money received. Enter records it.
            </p>
          </div>
        )}
      </form>
    </div>
  );
}
