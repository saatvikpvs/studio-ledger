import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { rupeesToPaise } from "../lib/money";
import type { Account, AreaKey, Category, Fund, SavingsGoal } from "../lib/types";
import { AREA_INK, Annot, Segmented, cx, useToast } from "./ui";

type Direction = "debit" | "credit";

/**
 * The daily workflow, and the reason this app exists: record what you just
 * spent in about five seconds.
 *
 * It is a strip on the page, not a modal — a dialog you have to open, fill and
 * dismiss is the difference between recording an expense and not bothering.
 * Amount is always focused first because it is the one field you always know.
 */
export default function QuickEntry({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const amountRef = useRef<HTMLInputElement>(null);

  const [direction, setDirection] = useState<Direction>("debit");
  const [area, setArea] = useState<AreaKey>("personal");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [fundId, setFundId] = useState("");
  const [goalId, setGoalId] = useState("");
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
  const goals = useQuery<SavingsGoal[]>({
    queryKey: ["goals"],
    queryFn: () => api.get<SavingsGoal[]>("/savings/goals"),
  });

  const projectFunds = (funds.data ?? []).filter((f) => f.kind === "project");
  const scope = area === "professional" ? "project" : "personal";
  const options = (categories.data ?? []).filter(
    (c) => c.scope === scope || c.scope === "both",
  );

  useEffect(() => {
    if (!accountId && accounts.data?.length) setAccountId(String(accounts.data[0].id));
  }, [accounts.data, accountId]);

  useEffect(() => {
    setCategoryId("");
    if (area === "professional" && projectFunds.length && !fundId) {
      setFundId(String(projectFunds[0].id));
    }
    if (area === "savings" && goals.data?.length && !goalId) {
      setGoalId(String(goals.data[0].id));
    }
  }, [area]); // eslint-disable-line react-hooks/exhaustive-deps

  // E records an expense, M records money in. Typing anywhere else is untouched.
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
    setNote("");
    setCategoryId("");
    setWhen(new Date().toISOString().slice(0, 10));
    amountRef.current?.focus();
  };

  const record = useMutation({
    mutationFn: async () => {
      const paise = rupeesToPaise(amount);
      if (!paise || paise <= 0) throw new Error("Enter an amount.");

      // Savings is a move between your own envelopes, not money leaving the
      // bank. Recording it as a transaction would invent cash that never moved.
      if (area === "savings") {
        if (!goalId) throw new Error("Pick a savings goal.");
        const path = direction === "debit" ? "/savings/contribute" : "/savings/withdraw";
        return api.post(path, {
          goal_id: Number(goalId),
          amount: paise,
          date: when,
          note: note || null,
        });
      }

      const personal = (funds.data ?? []).find((f) => f.kind === "personal");
      const target =
        area === "professional" ? Number(fundId) : personal?.id;
      if (!target) throw new Error("No fund to file this against.");

      const kind =
        area === "professional"
          ? direction === "credit"
            ? "client_payment"
            : "vendor_payment"
          : direction === "credit"
            ? "personal_income"
            : "personal_spend";

      return api.post("/transactions", {
        account_id: Number(accountId),
        value_date: when,
        direction,
        amount: paise,
        kind,
        description: note || (direction === "debit" ? "Expense" : "Money received"),
        splits: [
          {
            fund_id: target,
            amount: paise,
            category_id: categoryId ? Number(categoryId) : null,
          },
        ],
      });
    },
    onSuccess: () => {
      const verb =
        area === "savings"
          ? direction === "debit"
            ? "Set aside"
            : "Taken back"
          : direction === "debit"
            ? "Recorded"
            : "Received";
      toast.push(`${verb} ₹${amount}${note ? ` — ${note}` : ""}.`);
      reset();
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const isSavings = area === "savings";
  const accent = AREA_INK[area];

  return (
    <div
      className="no-print border-y border-rule bg-paper-2/40"
      style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
    >
      <form
        className="sheet py-3"
        onSubmit={(event) => {
          event.preventDefault();
          record.mutate();
        }}
      >
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          {/* what kind of movement --------------------------------------- */}
          <div className="w-[186px] shrink-0">
            <Annot className="mb-1.5">
              {isSavings ? "Savings" : "Entry"}
            </Annot>
            <Segmented<Direction>
              value={direction}
              onChange={setDirection}
              options={[
                { value: "debit", label: isSavings ? "Set aside" : "Spent" },
                { value: "credit", label: isSavings ? "Take out" : "Received" },
              ]}
            />
          </div>

          {/* amount — always first, always focused ------------------------ */}
          <div className="w-[168px] shrink-0">
            <Annot className="mb-1.5">Amount</Annot>
            <div className="flex items-baseline border-b border-ink">
              <span className="pb-1 pr-1.5 font-serif text-[22px] text-ink-3">₹</span>
              <input
                ref={amountRef}
                autoFocus
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

          {/* what for ----------------------------------------------------- */}
          <div className="min-w-[180px] flex-1">
            <Annot className="mb-1.5">What for</Annot>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                isSavings ? "Note (optional)" : "Lunch, cement, site travel…"
              }
              className="field-underline text-[15px]"
            />
          </div>

          {/* which area --------------------------------------------------- */}
          <div className="w-[272px] shrink-0">
            <Annot className="mb-1.5">Area</Annot>
            <Segmented<AreaKey>
              value={area}
              onChange={setArea}
              colourise
              options={[
                { value: "personal", label: "Personal" },
                { value: "professional", label: "Studio" },
                { value: "savings", label: "Savings" },
              ]}
            />
          </div>

          {/* the one extra field each area needs -------------------------- */}
          {isSavings ? (
            <div className="w-[168px] shrink-0">
              <Annot className="mb-1.5">Goal</Annot>
              <select
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
                className="field-underline text-[13px]"
              >
                {(goals.data ?? []).map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              {area === "professional" && (
                <div className="w-[160px] shrink-0">
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
              <div className="w-[152px] shrink-0">
                <Annot className="mb-1.5">Category</Annot>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="field-underline text-[13px]"
                >
                  <option value="">—</option>
                  {options.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
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

        {/* rarely-changed fields stay out of the way until asked for ------ */}
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
            {!isSavings && (
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
            )}
            <p className="ml-auto max-w-[38ch] pb-1 text-2xs leading-relaxed text-ink-3">
              {isSavings
                ? "Setting money aside moves it between your own envelopes. No bank transaction is created."
                : "Press E for an expense, M for money received. Enter records it."}
            </p>
          </div>
        )}
      </form>
    </div>
  );
}
