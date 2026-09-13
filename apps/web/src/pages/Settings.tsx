import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  AREA_INK,
  Annot,
  Field,
  Ledger,
  Mark,
  Modal,
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
import { formatDate, rupeesToPaise } from "../lib/money";
import type {
  Account,
  Category,
  Fund,
  Integrity,
  Reconciliation,
  Rule,
} from "../lib/types";

const TABS = ["Accounts", "Categories", "Rules", "Bank check", "Integrity"] as const;

export default function Settings() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Accounts");

  return (
    <>
      <PageTitle>Settings</PageTitle>

      <div className="flex flex-wrap gap-x-7 border-b border-rule pb-0 pt-1">
        {TABS.map((option) => (
          <button
            key={option}
            onClick={() => setTab(option)}
            className={cx(
              "-mb-px border-b-2 pb-2.5 text-[13px] transition-colors",
              tab === option
                ? "border-ink text-ink"
                : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {option}
          </button>
        ))}
      </div>

      {tab === "Accounts" && <Accounts />}
      {tab === "Categories" && <Categories />}
      {tab === "Rules" && <Rules />}
      {tab === "Bank check" && <BankCheck />}
      {tab === "Integrity" && <IntegrityPanel />}
    </>
  );
}

/* ------------------------------------------------------------------ accounts */

function Accounts() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);

  const accounts = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts"),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/accounts", body),
    onSuccess: () => {
      toast.push("Account added. Its opening balance was posted as an entry.");
      setAdding(false);
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  return (
    <>
      <Section
        label="Accounts"
        index="01"
        action={
          <button className="btn-line btn-sm" onClick={() => setAdding(true)}>
            Add account
          </button>
        }
      >
        <p className="mb-5 max-w-measure text-[13px] leading-relaxed text-ink-2">
          Your starting balance lives here. Add a Cash account if you withdraw
          money to spend by hand — without one, a withdrawal reads as a large
          expense on the day and the actual payments never appear.
        </p>

        {accounts.isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <Ledger min={520}>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Checked to</Th>
                <Th right>Balance</Th>
              </tr>
            </thead>
            <tbody>
              {(accounts.data ?? []).map((account) => (
                <tr key={account.id}>
                  <Td>
                    {account.name}
                    {account.last4 && (
                      <span className="ml-2 text-3xs text-ink-3">••{account.last4}</span>
                    )}
                  </Td>
                  <Td>
                    <Mark
                      colour={
                        account.type === "cash" ? "var(--ochre)" : "var(--blueprint)"
                      }
                    >
                      {account.type}
                    </Mark>
                  </Td>
                  <Td className="text-ink-3">
                    {account.reconciled_through
                      ? formatDate(account.reconciled_through)
                      : "Never"}
                  </Td>
                  <Td right>
                    <Money paise={account.balance} exact />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Ledger>
        )}
      </Section>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add an account">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            create.mutate({
              name: String(form.get("name")),
              type: String(form.get("type")),
              bank_name: String(form.get("bank_name") || "") || null,
              last4: String(form.get("last4") || "") || null,
              opening_balance:
                rupeesToPaise(String(form.get("opening_balance") ?? "0")) ?? 0,
              opening_date: String(form.get("opening_date")),
            });
          }}
        >
          <Field label="Name">
            <input name="name" className="field" required placeholder="Bank account" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <select name="type" className="field" defaultValue="bank">
                <option value="bank">Bank</option>
                <option value="cash">Cash in hand</option>
                <option value="card">Credit card</option>
              </select>
            </Field>
            <Field label="Bank name">
              <input name="bank_name" className="field" />
            </Field>
            <Field label="Last 4 digits" hint="Never a full account number">
              <input name="last4" className="field" maxLength={4} />
            </Field>
            <Field label="Opening balance">
              <input name="opening_balance" className="field" placeholder="1,20,000" />
            </Field>
          </div>
          <Field label="Opening date">
            <input
              name="opening_date"
              type="date"
              className="field"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <div className="flex justify-end gap-3 border-t border-rule pt-4">
            <button type="button" className="btn-line" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-solid" disabled={create.isPending}>
              Add account
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- categories */

function Categories() {
  const categories = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });

  const personal = (categories.data ?? []).filter((c) => c.scope === "personal");
  const professional = (categories.data ?? []).filter((c) => c.scope !== "personal");

  return (
    <Section label="Categories" index="01">
      <div className="grid gap-10 lg:grid-cols-2">
        {[
          ["Personal", personal, AREA_INK.personal] as const,
          ["Professional", professional, AREA_INK.professional] as const,
        ].map(([title, rows, ink]) => (
          <div key={title}>
            <div className="annot mb-3" style={{ color: ink }}>
              {title}
            </div>
            <div className="border-t border-rule-soft">
              {rows.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between gap-3 border-b border-rule-soft py-2"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="h-[10px] w-[2px] shrink-0"
                      style={{ background: category.colour }}
                    />
                    <span className="truncate text-[13px]">{category.name}</span>
                  </span>
                  {!category.reimbursable && category.scope !== "personal" && (
                    <span className="shrink-0 text-3xs uppercase tracking-annot text-ink-3">
                      studio bears
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 max-w-measure border-l-2 border-rule pl-3 text-2xs leading-relaxed text-ink-3">
        Professional categories marked <em>studio bears</em> are costs you carry
        yourself — software, printing, your own consultants. They reduce your
        margin; everything else passes through to the client.
      </p>
    </Section>
  );
}

/* --------------------------------------------------------------------- rules */

function Rules() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const rules = useQuery<Rule[]>({
    queryKey: ["rules"],
    queryFn: () => api.get<Rule[]>("/rules"),
  });

  const applyRetro = useMutation({
    mutationFn: (id: number) => api.post(`/rules/${id}/apply-retroactive`),
    onSuccess: (result) => {
      const count = (result as { applied: number }).applied;
      toast.push(`Applied to ${count} past ${count === 1 ? "entry" : "entries"}.`);
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/rules/${id}`),
    onSuccess: () => {
      toast.push("Rule deleted.");
      queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
  });

  return (
    <Section label="Filing rules" index="01">
      <p className="mb-5 max-w-measure text-[13px] leading-relaxed text-ink-2">
        Rules file imported entries for you. Match counts are shown so rules that
        never fire are easy to spot and remove.
      </p>
      {rules.isLoading ? (
        <Skeleton className="h-32" />
      ) : !rules.data?.length ? (
        <p className="text-[13px] text-ink-3">
          No rules yet. They are easiest to create from a filed entry.
        </p>
      ) : (
        <Ledger min={640}>
          <thead>
            <tr>
              <Th>Rule</Th>
              <Th>When</Th>
              <Th>Then</Th>
              <Th right>Matches</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rules.data.map((rule) => (
              <tr key={rule.id}>
                <Td>{rule.name}</Td>
                <Td className="text-3xs text-ink-3">
                  {Object.entries(rule.conditions)
                    .map(([k, v]) => `${k}=${String(v)}`)
                    .join(" · ")}
                </Td>
                <Td className="text-3xs text-ink-3">
                  {Object.entries(rule.actions)
                    .map(([k, v]) => `${k}=${String(v)}`)
                    .join(" · ")}
                </Td>
                <Td right className="text-ink-3">{rule.match_count}</Td>
                <Td right>
                  <span className="flex justify-end gap-4">
                    <button
                      className="btn-quiet"
                      onClick={() => applyRetro.mutate(rule.id)}
                    >
                      Apply to past
                    </button>
                    <button className="btn-quiet" onClick={() => remove.mutate(rule.id)}>
                      Delete
                    </button>
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Ledger>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- bank check */

function BankCheck() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [result, setResult] = useState<{
    id: number;
    difference: number;
    balanced: boolean;
    calculated_balance: number;
    suspects: { kind: string; message: string }[];
  } | null>(null);

  const accounts = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts"),
  });
  const history = useQuery<Reconciliation[]>({
    queryKey: ["reconciliations"],
    queryFn: () => api.get<Reconciliation[]>("/reconciliations"),
  });

  const start = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/reconciliations", body),
    onSuccess: (data) => {
      setResult(data as never);
      queryClient.invalidateQueries({ queryKey: ["reconciliations"] });
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const close = useMutation({
    mutationFn: (id: number) => api.post(`/reconciliations/${id}/close`),
    onSuccess: (data) => {
      toast.push((data as { message: string }).message);
      setResult(null);
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  return (
    <Section label="Check against the bank" index="01">
      <p className="mb-5 max-w-measure text-[13px] leading-relaxed text-ink-2">
        Enter the closing balance from your statement. When the difference is
        zero you can lock the period, so an old month cannot change under you.
      </p>

      <form
        className="grid gap-5 sm:grid-cols-4 sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const balance = rupeesToPaise(String(form.get("balance") ?? ""));
          if (balance === null) {
            toast.push("Enter the closing balance.", "error");
            return;
          }
          start.mutate({
            account_id: Number(form.get("account_id")),
            period_start: String(form.get("period_start")),
            period_end: String(form.get("period_end")),
            statement_closing_balance: balance,
          });
        }}
      >
        <Field label="Account">
          <select name="account_id" className="field-underline" required>
            {(accounts.data ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input name="period_start" type="date" className="field-underline" required />
        </Field>
        <Field label="To">
          <input name="period_end" type="date" className="field-underline" required />
        </Field>
        <Field label="Closing balance">
          <input name="balance" className="field-underline" required placeholder="1,97,728" />
        </Field>
        <div className="sm:col-span-4">
          <button className="btn-solid" disabled={start.isPending}>
            {start.isPending ? "Checking…" : "Check"}
          </button>
        </div>
      </form>

      {result && (
        <div
          className="mt-7 border-l-2 pl-4"
          style={{
            borderColor: result.balanced ? "var(--sap)" : "var(--ochre)",
          }}
        >
          <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
            <div>
              <Annot>Difference</Annot>
              <div className="font-serif text-[30px] leading-none">
                <Money paise={result.difference} exact />
              </div>
            </div>
            <div>
              <Annot>Ledger says</Annot>
              <div className="text-[15px]">
                <Money paise={result.calculated_balance} exact />
              </div>
            </div>
          </div>

          {result.balanced ? (
            <div className="mt-4">
              <p className="mb-3 text-[13px] text-sap">
                The ledger matches the statement exactly.
              </p>
              <button
                className="btn-solid"
                onClick={() => close.mutate(result.id)}
                disabled={close.isPending}
              >
                Lock this period
              </button>
            </div>
          ) : (
            <ul className="mt-4 space-y-1.5">
              {result.suspects.map((suspect, index) => (
                <li key={index} className="max-w-measure text-2xs leading-relaxed text-ink-2">
                  — {suspect.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(history.data ?? []).length > 0 && (
        <div className="mt-8 border-t border-rule-soft pt-5">
          <Annot className="mb-3">Previous checks</Annot>
          <Ledger min={600}>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Period</Th>
                <Th right>Statement</Th>
                <Th right>Ledger</Th>
                <Th right>Difference</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((rec) => (
                <tr key={rec.id}>
                  <Td>{rec.account_name}</Td>
                  <Td className="whitespace-nowrap text-ink-3">
                    {formatDate(rec.period_start)} — {formatDate(rec.period_end)}
                  </Td>
                  <Td right><Money paise={rec.statement_closing_balance} exact /></Td>
                  <Td right><Money paise={rec.calculated_balance} exact /></Td>
                  <Td right><Money paise={rec.difference} exact /></Td>
                  <Td>
                    <Mark
                      colour={rec.status === "closed" ? "var(--sap)" : "var(--ochre)"}
                    >
                      {rec.status}
                    </Mark>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Ledger>
        </div>
      )}
    </Section>
  );
}

/* ----------------------------------------------------------------- integrity */

function IntegrityPanel() {
  const integrity = useQuery<Integrity>({
    queryKey: ["integrity"],
    queryFn: () => api.get<Integrity>("/health/integrity"),
  });
  const funds = useQuery<Fund[]>({
    queryKey: ["funds"],
    queryFn: () => api.get<Fund[]>("/funds"),
  });

  const data = integrity.data;

  return (
    <Section label="Integrity" index="01">
      <p className="mb-6 max-w-measure text-[13px] leading-relaxed text-ink-2">
        Two checks most expense trackers cannot make: every entry's parts must
        sum to its amount, and Personal plus Professional plus Savings plus
        Unfiled must equal the money actually in the bank.
      </p>

      {integrity.isLoading || !data ? (
        <Skeleton className="h-32" />
      ) : (
        <>
          <div
            className="mb-7 border-l-2 pl-4"
            style={{ borderColor: data.ok ? "var(--sap)" : "var(--oxide)" }}
          >
            <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
              <div>
                <Annot>Status</Annot>
                <div
                  className="font-serif text-[24px] leading-none"
                  style={{ color: data.ok ? "var(--sap)" : "var(--oxide)" }}
                >
                  {data.ok ? "Consistent" : `${data.problems.length} problems`}
                </div>
              </div>
              <div>
                <Annot>In the bank</Annot>
                <div className="text-[15px]"><Money paise={data.cash_balance} exact /></div>
              </div>
              <div>
                <Annot>Sum of areas</Annot>
                <div className="text-[15px]"><Money paise={data.fund_total} exact /></div>
              </div>
              <div>
                <Annot>Difference</Annot>
                <div className="text-[15px]">
                  <Money paise={data.cash_balance - data.fund_total} exact />
                </div>
              </div>
            </div>
            {!data.ok && (
              <ul className="mt-4 space-y-1">
                {data.problems.map((problem, index) => (
                  <li key={index} className="text-3xs text-oxide">
                    {JSON.stringify(problem)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Ledger min={420}>
            <thead>
              <tr>
                <Th>Fund</Th>
                <Th>Area</Th>
                <Th right>Balance</Th>
              </tr>
            </thead>
            <tbody>
              {(funds.data ?? []).map((fund) => (
                <tr key={fund.id}>
                  <Td>{fund.name}</Td>
                  <Td>
                    <Mark
                      colour={
                        fund.kind === "project"
                          ? AREA_INK.professional
                          : fund.kind === "savings"
                            ? AREA_INK.savings
                            : fund.kind === "personal"
                              ? AREA_INK.personal
                              : AREA_INK.unassigned
                      }
                    >
                      {fund.kind === "project"
                        ? "professional"
                        : fund.kind === "unassigned"
                          ? "unfiled"
                          : fund.kind}
                    </Mark>
                  </Td>
                  <Td right><Money paise={fund.balance} exact /></Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td className="font-medium">Total</Td>
                <Td />
                <Td right className="font-medium">
                  <Money paise={data.fund_total} exact />
                </Td>
              </tr>
            </tfoot>
          </Ledger>
        </>
      )}
    </Section>
  );
}
