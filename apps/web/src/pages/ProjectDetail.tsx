import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { BulletBar, CategoryBars } from "../components/charts";
import {
  Card,
  Chip,
  ErrorState,
  Field,
  Modal,
  Money,
  PageHeader,
  ProgressBar,
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
  CategorySlice,
  ClientPayment,
  Fund,
  ProjectSummary,
  Transaction,
  TransactionPage,
} from "../lib/types";

interface Detail {
  project: Record<string, string | number | null>;
  summary: ProjectSummary;
  breakdown: CategorySlice[];
  payments: ClientPayment[];
  fund_id: number;
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [drawing, setDrawing] = useState(false);

  const detail = useQuery<Detail>({
    queryKey: ["project", id],
    queryFn: () => api.get<Detail>(`/projects/${id}`),
    enabled: Boolean(id),
  });

  const expenses = useQuery<TransactionPage>({
    queryKey: ["project-expenses", detail.data?.fund_id],
    queryFn: () =>
      api.get<TransactionPage>("/transactions", {
        fund_id: detail.data?.fund_id,
        limit: 100,
      }),
    enabled: Boolean(detail.data?.fund_id),
  });

  const funds = useQuery<Fund[]>({
    queryKey: ["funds"],
    queryFn: () => api.get<Fund[]>("/funds"),
  });

  const drawFee = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/fund-transfers", body),
    onSuccess: () => {
      toast.push("Fee moved to Personal. No bank transaction was created.");
      setDrawing(false);
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  if (detail.isError) {
    return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  }
  if (detail.isLoading || !detail.data) {
    return (
      <>
        <Skeleton className="mb-6 h-10 w-72" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px]" />
          ))}
        </div>
      </>
    );
  }

  const { summary, breakdown, payments, fund_id, project } = detail.data;
  const personalFund = funds.data?.find((f) => f.kind === "personal");
  const tone =
    summary.alert === "critical" ? "neg" : summary.alert === "warning" ? "warn" : "accent";

  const debits = (expenses.data?.items ?? []).filter((t) => t.direction === "debit");

  return (
    <>
      <div className="mb-1">
        <Link to="/projects" className="text-[12px] text-ink-3 hover:text-accent">
          ← Projects
        </Link>
      </div>

      <PageHeader
        title={summary.name}
        subtitle={[summary.client_name, summary.location, summary.project_type]
          .filter(Boolean)
          .join(" · ")}
      >
        <Chip
          tone={
            summary.alert === "critical"
              ? "neg"
              : summary.alert === "warning"
                ? "warn"
                : "pos"
          }
        >
          {humanise(summary.status)}
        </Chip>
        <button
          className="btn-ghost"
          onClick={() => setDrawing(true)}
          disabled={summary.in_hand <= 0}
        >
          Draw fee
        </button>
      </PageHeader>

      {/* --------------------------------------------------- the three figures */}
      <Card className="mb-3">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="mb-4 grid grid-cols-3 gap-4">
              <div>
                <div className="label">Received</div>
                <div className="mt-0.5 text-xl font-semibold">
                  <Money paise={summary.received} />
                </div>
              </div>
              <div>
                <div className="label">Spent</div>
                <div className="mt-0.5 text-xl font-semibold">
                  <Money paise={summary.spent} />
                </div>
              </div>
              <div>
                <div className="label">In hand</div>
                <div className="mt-0.5 text-xl font-semibold">
                  <Money paise={summary.in_hand} />
                </div>
              </div>
            </div>

            <ProgressBar percent={summary.percent_of_received} tone={tone} height={10} />
            <div className="mt-2 flex justify-between text-2xs text-ink-3">
              <span className="tabular">
                {Math.round(summary.percent_of_received)}% of money received
              </span>
              <span className="tabular">
                {Math.round(summary.percent_of_budget)}% of budget
              </span>
            </div>

            {summary.drawn > 0 && (
              <p className="mt-3 rounded-md border border-line-soft bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
                <Money paise={summary.drawn} className="font-medium" /> has been
                drawn from this project to Personal as your fee. That is why
                <em> in hand</em> is lower than received minus spent — no bank
                transaction was involved.
              </p>
            )}
          </div>

          {/* "Remaining" is three different questions. Answer all three. */}
          <div className="space-y-3 lg:border-l lg:border-line-soft lg:pl-6">
            <Row
              label="Cash still in hand"
              value={summary.in_hand}
              hint="Can you pay the contractor tomorrow?"
            />
            <Row
              label="Budget headroom"
              value={summary.headroom}
              hint={`Budget ${(summary.budget / 100).toLocaleString("en-IN")} less spend`}
            />
            <Row
              label="Client still owes"
              value={summary.receivable}
              hint={`Expected ${(summary.expected_total / 100).toLocaleString("en-IN")} in total`}
            />
            <div className="border-t border-line-soft pt-3">
              <Row
                label="Fee earned to date"
                value={summary.fee_earned}
                hint={
                  project.fee_model === "percent_of_cost"
                    ? `${project.fee_percent}% of cost incurred`
                    : "Recognised against progress"
                }
              />
              {summary.own_costs > 0 && (
                <Row
                  label="Margin after own costs"
                  value={summary.margin}
                  hint={`${(summary.own_costs / 100).toLocaleString("en-IN")} of non-reimbursable spend`}
                />
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <SectionTitle>Where the money went</SectionTitle>
          <CategoryBars data={breakdown} limit={12} />
        </Card>

        <Card>
          <SectionTitle>Budget against actual</SectionTitle>
          <div className="mt-6">
            <BulletBar
              spent={summary.spent}
              received={summary.received}
              budget={summary.budget}
            />
            <div className="mt-3 space-y-1.5 text-[12px]">
              <Legend colour="bg-accent" label="Spent" value={summary.spent} />
              <Legend colour="bg-accent/25" label="Received" value={summary.received} />
              <Legend colour="bg-ink" label="Budget" value={summary.budget} />
            </div>
          </div>

          <SectionTitle>
            <span className="mt-6 block">Client payments</span>
          </SectionTitle>
          {payments.length ? (
            <ul className="space-y-2">
              {payments.map((payment, index) => (
                <li
                  key={index}
                  className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-2 text-[12px] last:border-0"
                >
                  <span>
                    <span className="block text-ink-2">{formatDate(payment.date)}</span>
                    {payment.reference && (
                      <span className="block font-mono text-2xs text-ink-3">
                        {payment.reference}
                      </span>
                    )}
                  </span>
                  <Money paise={payment.amount} className="font-medium" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">No payments recorded yet.</p>
          )}
        </Card>
      </div>

      <Card className="mt-3" padded={false}>
        <div className="p-5 pb-0">
          <SectionTitle>Expenses on this project</SectionTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th>Category</Th>
                <Th>Kind</Th>
                <Th right>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {debits.map((txn) => (
                <ExpenseRow key={txn.id} txn={txn} fundId={fund_id} />
              ))}
              {!debits.length && (
                <tr>
                  <Td className="py-8 text-center text-ink-3">
                    Nothing spent on this project yet.
                  </Td>
                  <Td /> <Td /> <Td /> <Td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={drawing}
        onClose={() => setDrawing(false)}
        title="Draw your fee"
        description="Moves money from this project's fund to Personal. No bank transaction is created — the bank never sees this."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const amount = rupeesToPaise(String(form.get("amount") ?? ""));
            if (!amount || !personalFund) {
              toast.push("Enter a valid amount.", "error");
              return;
            }
            drawFee.mutate({
              from_fund_id: fund_id,
              to_fund_id: personalFund.id,
              amount,
              date: String(form.get("date")),
              reason: "fee_draw",
              note: String(form.get("note") || ""),
            });
          }}
          className="space-y-4"
        >
          <div className="rounded-md border border-line-soft bg-surface-2 px-3 py-2.5 text-[12px] text-ink-2">
            Fee earned to date: <Money paise={summary.fee_earned} className="font-medium" />
            {summary.drawn > 0 && (
              <>
                {" · "}already drawn:{" "}
                <Money paise={summary.drawn} className="font-medium" />
              </>
            )}
          </div>
          <Field label="Amount">
            <input
              name="amount"
              className="field"
              required
              placeholder="1,00,000"
              defaultValue={
                summary.fee_earned > summary.drawn
                  ? String((summary.fee_earned - summary.drawn) / 100)
                  : ""
              }
            />
          </Field>
          <Field label="Date">
            <input
              name="date"
              type="date"
              className="field"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Field label="Note">
            <input name="note" className="field" placeholder="Stage 1 design fee" />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setDrawing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={drawFee.isPending}>
              {drawFee.isPending ? "Moving…" : "Draw fee"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13px] text-ink-2">{label}</div>
        <div className="text-2xs text-ink-3">{hint}</div>
      </div>
      <Money paise={value} className="shrink-0 text-[15px] font-medium" />
    </div>
  );
}

function Legend({
  colour,
  label,
  value,
}: {
  colour: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-ink-2">
        <span className={cx("h-2 w-2 rounded-sm", colour)} />
        {label}
      </span>
      <Money paise={value} className="text-ink-3" />
    </div>
  );
}

function ExpenseRow({ txn, fundId }: { txn: Transaction; fundId: number }) {
  const share = txn.allocations
    .filter((a) => a.fund_id === fundId)
    .reduce((sum, a) => sum + a.amount, 0);
  const category = txn.allocations.find((a) => a.fund_id === fundId)?.category_name;
  const split = txn.allocations.length > 1;

  return (
    <tr>
      <Td className="whitespace-nowrap text-ink-2">{formatDate(txn.value_date)}</Td>
      <Td>
        <span className="block max-w-[320px] truncate" title={txn.description_raw}>
          {txn.description_norm || txn.description_raw}
        </span>
        {split && (
          <Chip tone="neutral" className="mt-1">
            split across {txn.allocations.length} funds
          </Chip>
        )}
      </Td>
      <Td className="text-ink-2">{category ?? "—"}</Td>
      <Td className="text-ink-3">{humanise(txn.kind)}</Td>
      <Td right>
        <Money paise={share} exact className="font-medium" />
      </Td>
    </tr>
  );
}
