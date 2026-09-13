import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  Card,
  Chip,
  Field,
  Modal,
  Money,
  PageHeader,
  SectionTitle,
  Skeleton,
  Td,
  Th,
  cx,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDate, humanise, rupeesToPaise } from "../lib/money";
import type {
  Account,
  Category,
  Fund,
  FundTransfer,
  Integrity,
  Reconciliation,
  Rule,
  Vendor,
} from "../lib/types";

const TABS = [
  { key: "accounts", label: "Accounts" },
  { key: "rules", label: "Rules" },
  { key: "categories", label: "Categories" },
  { key: "vendors", label: "Vendors" },
  { key: "transfers", label: "Fund transfers" },
  { key: "reconciliation", label: "Reconciliation" },
  { key: "integrity", label: "Integrity" },
] as const;

export default function Settings() {
  const [tab, setTab] = useState<string>("accounts");

  return (
    <>
      <PageHeader title="Settings" />

      <div className="mb-5 flex flex-wrap gap-1 rounded-md border border-line bg-surface p-1 w-fit">
        {TABS.map((option) => (
          <button
            key={option.key}
            onClick={() => setTab(option.key)}
            className={cx(
              "rounded px-3 py-1.5 text-[13px] transition-colors",
              tab === option.key
                ? "bg-accent-soft font-medium text-accent"
                : "text-ink-2 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tab === "accounts" && <Accounts />}
      {tab === "rules" && <Rules />}
      {tab === "categories" && <Categories />}
      {tab === "vendors" && <Vendors />}
      {tab === "transfers" && <Transfers />}
      {tab === "reconciliation" && <Reconcile />}
      {tab === "integrity" && <IntegrityPanel />}
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
      toast.push("Account added. Its opening balance was posted as a transaction.");
      setAdding(false);
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  return (
    <>
      <SectionTitle
        action={
          <button className="btn-primary btn-sm" onClick={() => setAdding(true)}>
            Add account
          </button>
        }
      >
        Accounts
      </SectionTitle>
      <p className="mb-3 max-w-2xl text-[12px] leading-relaxed text-ink-3">
        Add a Cash account if you withdraw money to pay labour. Without one, a
        withdrawal reads as a large expense on the day and the actual payments
        never appear.
      </p>

      {accounts.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <Card padded={false}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Reconciled through</Th>
                <Th right>Balance</Th>
              </tr>
            </thead>
            <tbody>
              {(accounts.data ?? []).map((account) => (
                <tr key={account.id}>
                  <Td className="font-medium">
                    {account.name}
                    {account.last4 && (
                      <span className="ml-1.5 font-mono text-2xs text-ink-3">
                        ••{account.last4}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Chip tone={account.type === "cash" ? "warn" : "accent"}>
                      {account.type}
                    </Chip>
                  </Td>
                  <Td className="text-ink-2">
                    {account.reconciled_through
                      ? formatDate(account.reconciled_through)
                      : "Never"}
                  </Td>
                  <Td right>
                    <Money paise={account.balance} exact className="font-medium" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add an account">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            create.mutate({
              name: String(form.get("name")),
              type: String(form.get("type")),
              bank_name: String(form.get("bank_name") ?? "") || null,
              last4: String(form.get("last4") ?? "") || null,
              opening_balance: rupeesToPaise(String(form.get("opening_balance") ?? "0")) ?? 0,
              opening_date: String(form.get("opening_date")),
            });
          }}
          className="space-y-4"
        >
          <Field label="Name">
            <input name="name" className="field" required placeholder="HDFC Current" />
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
              <input name="bank_name" className="field" placeholder="HDFC Bank" />
            </Field>
            <Field label="Last 4 digits" hint="We never store a full account number">
              <input name="last4" className="field" maxLength={4} placeholder="4417" />
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
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              Add account
            </button>
          </div>
        </form>
      </Modal>
    </>
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
      toast.push(`Applied to ${count} past transaction${count === 1 ? "" : "s"}.`);
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
    <>
      <SectionTitle>Categorisation rules</SectionTitle>
      <p className="mb-3 max-w-2xl text-[12px] leading-relaxed text-ink-3">
        Rules run first, before any other suggestion. Match counts are shown so
        rules that never fire are easy to spot and prune.
      </p>

      {rules.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <Card padded={false}>
          <table className="w-full border-collapse">
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
              {(rules.data ?? []).map((rule) => (
                <tr key={rule.id}>
                  <Td className="font-medium">
                    {rule.name}
                    {rule.auto_apply && (
                      <Chip tone="accent" className="ml-2">
                        auto
                      </Chip>
                    )}
                  </Td>
                  <Td className="font-mono text-2xs text-ink-2">
                    {Object.entries(rule.conditions)
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join(" · ")}
                  </Td>
                  <Td className="font-mono text-2xs text-ink-2">
                    {Object.entries(rule.actions)
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join(" · ")}
                  </Td>
                  <Td right className="text-ink-2">{rule.match_count}</Td>
                  <Td right>
                    <div className="flex justify-end gap-2">
                      <button
                        className="text-2xs text-accent hover:underline"
                        onClick={() => applyRetro.mutate(rule.id)}
                      >
                        Apply to past
                      </button>
                      <button
                        className="text-2xs text-ink-3 hover:text-neg"
                        onClick={() => remove.mutate(rule.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- categories */

function Categories() {
  const categories = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });

  const groups = {
    project: (categories.data ?? []).filter((c) => c.scope !== "personal"),
    personal: (categories.data ?? []).filter((c) => c.scope === "personal"),
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {(["project", "personal"] as const).map((scope) => (
        <Card key={scope}>
          <SectionTitle>{scope === "project" ? "Project" : "Personal"}</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {groups[scope].map((category) => (
              <span
                key={category.id}
                className="inline-flex items-center gap-1.5 rounded border border-line px-2 py-1 text-[12px]"
                title={
                  category.reimbursable
                    ? "Passes through to the client"
                    : "The practice bears this cost — it reduces your fee"
                }
              >
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ background: category.colour }}
                />
                {category.name}
                {!category.reimbursable && (
                  <span className="font-mono text-[9px] text-ink-3">own</span>
                )}
              </span>
            ))}
          </div>
          {scope === "project" && (
            <p className="mt-3 text-2xs leading-relaxed text-ink-3">
              Categories marked <span className="font-mono">own</span> are costs
              you bear yourself — software, printing, your own consultants. They
              reduce your margin; everything else passes through to the client.
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- vendors */

function Vendors() {
  const vendors = useQuery<Vendor[]>({
    queryKey: ["vendors"],
    queryFn: () => api.get<Vendor[]>("/vendors"),
  });

  return (
    <>
      <SectionTitle>Vendors</SectionTitle>
      <p className="mb-3 max-w-2xl text-[12px] text-ink-3">
        Match patterns feed the classifier — the strongest signal it has.
      </p>
      <Card padded={false}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Vendor</Th>
              <Th>Matches on</Th>
              <Th>GSTIN</Th>
            </tr>
          </thead>
          <tbody>
            {(vendors.data ?? []).map((vendor) => (
              <tr key={vendor.id}>
                <Td className="font-medium">{vendor.name}</Td>
                <Td className="font-mono text-2xs text-ink-2">
                  {vendor.match_patterns.join(" · ") || "—"}
                </Td>
                <Td className="font-mono text-2xs text-ink-3">{vendor.gstin ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/* ----------------------------------------------------------------- transfers */

function Transfers() {
  const transfers = useQuery<FundTransfer[]>({
    queryKey: ["fund-transfers"],
    queryFn: () => api.get<FundTransfer[]>("/fund-transfers"),
  });

  return (
    <>
      <SectionTitle>Fund transfers</SectionTitle>
      <p className="mb-3 max-w-2xl text-[12px] leading-relaxed text-ink-3">
        Money moved between funds. No bank transaction exists for any of these —
        they are never counted as income or as expense.
      </p>
      <Card padded={false}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th>Reason</Th>
              <Th right>Amount</Th>
            </tr>
          </thead>
          <tbody>
            {(transfers.data ?? []).map((transfer) => (
              <tr key={transfer.id}>
                <Td className="whitespace-nowrap text-ink-2">
                  {formatDate(transfer.date)}
                </Td>
                <Td>{transfer.from_fund}</Td>
                <Td>{transfer.to_fund}</Td>
                <Td className="text-ink-3">{humanise(transfer.reason)}</Td>
                <Td right>
                  <Money paise={transfer.amount} exact className="font-medium" />
                </Td>
              </tr>
            ))}
            {!transfers.data?.length && (
              <tr>
                <Td className="py-8 text-center text-ink-3">No fund transfers yet.</Td>
                <Td /><Td /><Td /><Td />
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ reconciliation */

function Reconcile() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [result, setResult] = useState<{
    difference: number;
    balanced: boolean;
    calculated_balance: number;
    suspects: { kind: string; message: string }[];
    id: number;
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
    <>
      <SectionTitle>Reconcile against a statement</SectionTitle>
      <p className="mb-3 max-w-2xl text-[12px] leading-relaxed text-ink-3">
        Enter the closing balance from your bank statement. When the difference
        reaches zero you can close the period, which locks those transactions
        so last quarter's report cannot change under you.
      </p>

      <Card className="mb-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const balance = rupeesToPaise(String(form.get("balance") ?? ""));
            if (balance === null) {
              toast.push("Enter the statement's closing balance.", "error");
              return;
            }
            start.mutate({
              account_id: Number(form.get("account_id")),
              period_start: String(form.get("period_start")),
              period_end: String(form.get("period_end")),
              statement_closing_balance: balance,
            });
          }}
          className="grid gap-4 sm:grid-cols-4 sm:items-end"
        >
          <Field label="Account">
            <select name="account_id" className="field" required>
              {(accounts.data ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period start">
            <input name="period_start" type="date" className="field" required />
          </Field>
          <Field label="Period end">
            <input name="period_end" type="date" className="field" required />
          </Field>
          <Field label="Statement closing balance">
            <input name="balance" className="field" required placeholder="8,42,221" />
          </Field>
          <div className="sm:col-span-4">
            <button className="btn-primary" disabled={start.isPending}>
              {start.isPending ? "Checking…" : "Check"}
            </button>
          </div>
        </form>
      </Card>

      {result && (
        <Card
          className={cx("mb-3", result.balanced ? "border-pos/40" : "border-warn/40")}
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <span className="label block">Difference</span>
              <span className="text-2xl font-semibold">
                <Money paise={result.difference} exact />
              </span>
            </div>
            <div className="text-right">
              <span className="label block">Ledger says</span>
              <Money paise={result.calculated_balance} exact className="text-[15px]" />
            </div>
          </div>

          {result.balanced ? (
            <>
              <p className="mb-3 text-[13px] text-pos">
                The ledger matches the statement exactly.
              </p>
              <button
                className="btn-primary"
                onClick={() => close.mutate(result.id)}
                disabled={close.isPending}
              >
                Close and lock this period
              </button>
            </>
          ) : (
            <>
              <p className="mb-2 text-[13px] text-ink-2">Most likely causes:</p>
              <ul className="space-y-1.5">
                {result.suspects.map((suspect, index) => (
                  <li key={index} className="flex gap-2 text-[12px] text-ink-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warn" />
                    {suspect.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {(history.data ?? []).length > 0 && (
        <Card padded={false}>
          <table className="w-full border-collapse">
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
                  <Td className="whitespace-nowrap text-ink-2">
                    {formatDate(rec.period_start)} — {formatDate(rec.period_end)}
                  </Td>
                  <Td right>
                    <Money paise={rec.statement_closing_balance} exact />
                  </Td>
                  <Td right>
                    <Money paise={rec.calculated_balance} exact />
                  </Td>
                  <Td right>
                    <Money paise={rec.difference} exact />
                  </Td>
                  <Td>
                    <Chip tone={rec.status === "closed" ? "pos" : "warn"}>
                      {rec.status}
                    </Chip>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
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
    <>
      <SectionTitle>Ledger integrity</SectionTitle>
      <p className="mb-3 max-w-2xl text-[12px] leading-relaxed text-ink-3">
        Two checks most expense trackers cannot make: every transaction's
        allocations must sum to its amount, and every fund balance together must
        equal the bank balance. If either fails, something was written outside
        the ledger service.
      </p>

      {integrity.isLoading || !data ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <Card className={cx("mb-3", data.ok ? "border-pos/40" : "border-neg/50")}>
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <span className="label block">Status</span>
                <span
                  className={cx(
                    "text-lg font-semibold",
                    data.ok ? "text-pos" : "text-neg",
                  )}
                >
                  {data.ok ? "Consistent" : `${data.problems.length} problems`}
                </span>
              </div>
              <div>
                <span className="label block">Bank balance</span>
                <Money paise={data.cash_balance} exact className="text-[15px] font-medium" />
              </div>
              <div>
                <span className="label block">Sum of funds</span>
                <Money paise={data.fund_total} exact className="text-[15px] font-medium" />
              </div>
              <div>
                <span className="label block">Difference</span>
                <Money
                  paise={data.cash_balance - data.fund_total}
                  exact
                  className="text-[15px] font-medium"
                />
              </div>
            </div>

            {!data.ok && (
              <ul className="mt-4 space-y-1.5 border-t border-line-soft pt-3">
                {data.problems.map((problem, index) => (
                  <li key={index} className="font-mono text-2xs text-neg">
                    {JSON.stringify(problem)}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padded={false}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Fund</Th>
                  <Th>Kind</Th>
                  <Th right>Balance</Th>
                </tr>
              </thead>
              <tbody>
                {(funds.data ?? []).map((fund) => (
                  <tr key={fund.id}>
                    <Td className="font-medium">{fund.name}</Td>
                    <Td>
                      <Chip
                        tone={
                          fund.kind === "unassigned"
                            ? "warn"
                            : fund.kind === "personal"
                              ? "neutral"
                              : "accent"
                        }
                      >
                        {fund.kind}
                      </Chip>
                    </Td>
                    <Td right>
                      <Money paise={fund.balance} exact className="font-medium" />
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2">
                  <Td className="font-semibold">Total</Td>
                  <Td />
                  <Td right className="font-semibold">
                    <Money paise={data.fund_total} exact />
                  </Td>
                </tr>
              </tfoot>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
