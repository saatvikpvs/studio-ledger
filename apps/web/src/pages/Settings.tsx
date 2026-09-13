import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  AREA_INK,
  Annot,
  Empty,
  ErrorNote,
  Field,
  Ledger,
  Mark,
  Modal,
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
import { formatDate, formatDateShort, rupeesToPaise } from "../lib/money";
import type {
  Account,
  AreaKey,
  Category,
  Fund,
  ImportBatch,
  ImportPreview,
  Integrity,
  Reconciliation,
  Rule,
  StagedRow,
  Transaction,
  TransactionPage,
} from "../lib/types";

const TABS = [
  "Import",
  "Accounts",
  "Categories",
  "Rules",
  "Bank check",
  "Integrity",
] as const;

export default function Settings() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Import");

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
                ? "text-ink"
                : "border-transparent text-ink-3 hover:text-ink",
            )}
            style={tab === option ? { borderBottomColor: "var(--accent)" } : undefined}
          >
            {option}
          </button>
        ))}
      </div>

      {tab === "Import" && (
        <>
          <ImportSection />
          <UnfiledSection />
        </>
      )}
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

const STATE_NOTE: Record<StagedRow["state"], { label: string; colour: string }> = {
  new: { label: "New", colour: "var(--sap)" },
  manual_match: { label: "Already entered", colour: "var(--blueprint)" },
  duplicate: { label: "Already imported", colour: "var(--ink-3)" },
  possible_duplicate: { label: "Possible duplicate", colour: "var(--ochre)" },
  error: { label: "Unreadable", colour: "var(--oxide)" },
  committed: { label: "Imported", colour: "var(--ink-3)" },
};

/* ============================================ import & unfiled queue === */

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
