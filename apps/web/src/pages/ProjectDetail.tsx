import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { CategoryRules } from "../components/Graphs";
import {
  AREA_INK,
  Annot,
  Bar,
  ErrorNote,
  Field,
  Figure,
  Ledger,
  Mark,
  Modal,
  Money,
  PageTitle,
  Section,
  Skeleton,
  Td,
  Th,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDate, formatDateShort, humanise, rupeesToPaise } from "../lib/money";
import type {
  CategorySlice,
  ClientPayment,
  Fund,
  ProjectSummary,
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

  const entries = useQuery<TransactionPage>({
    queryKey: ["project-entries", detail.data?.fund_id],
    queryFn: () =>
      api.get<TransactionPage>("/transactions", {
        fund_id: detail.data?.fund_id,
        limit: 200,
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
    return <ErrorNote error={detail.error} onRetry={() => detail.refetch()} />;
  }
  if (detail.isLoading || !detail.data) {
    return <Skeleton className="mt-10 h-64" />;
  }

  const { summary, breakdown, payments, fund_id, project } = detail.data;
  const personalFund = funds.data?.find((f) => f.kind === "personal");
  const debits = (entries.data?.items ?? []).filter((t) => t.direction === "debit");

  return (
    <>
      <div className="pt-8">
        <Link to="/studio" className="btn-quiet">
          ← Professional
        </Link>
      </div>

      <PageTitle
        sub={[summary.client_name, summary.location, summary.project_type]
          .filter(Boolean)
          .join(" · ")}
        right={
          <>
            <Mark
              colour={
                summary.alert === "critical"
                  ? "var(--oxide)"
                  : summary.alert === "warning"
                    ? "var(--ochre)"
                    : AREA_INK.professional
              }
            >
              {humanise(summary.status)}
            </Mark>
            <button
              className="btn-line"
              onClick={() => setDrawing(true)}
              disabled={summary.in_hand <= 0}
            >
              Draw fee
            </button>
          </>
        }
      >
        {summary.name}
      </PageTitle>

      <Section label="Standing" index="01">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div>
            <div className="grid grid-cols-3 gap-6">
              <Figure label="Received" paise={summary.received} size="sm" />
              <Figure label="Spent" paise={summary.spent} size="sm" />
              <Figure label="In hand" paise={summary.in_hand} size="sm" />
            </div>

            <div className="mt-6">
              <Bar
                percent={summary.percent_of_received}
                over={summary.percent_of_received > 100}
                height={10}
                colour={
                  summary.alert === "critical"
                    ? "var(--oxide)"
                    : summary.alert === "warning"
                      ? "var(--ochre)"
                      : AREA_INK.professional
                }
              />
              <div className="mt-2 flex justify-between text-3xs uppercase tracking-annot text-ink-3">
                <span>{Math.round(summary.percent_of_received)}% of money received</span>
                <span>{Math.round(summary.percent_of_budget)}% of budget</span>
              </div>
            </div>

            {summary.drawn > 0 && (
              <p className="mt-5 max-w-measure border-l-2 border-rule pl-3 text-2xs leading-relaxed text-ink-2">
                <Money paise={summary.drawn} /> has been drawn from this project to
                Personal as your fee. That is why <em>in hand</em> is lower than
                received minus spent — no bank transaction was involved.
              </p>
            )}
          </div>

          <dl className="space-y-3.5 lg:border-l lg:border-rule lg:pl-10">
            <Line
              label="Cash still in hand"
              value={summary.in_hand}
              note="Can you pay the contractor tomorrow?"
            />
            <Line
              label="Budget headroom"
              value={summary.headroom}
              note={`Budget ${(summary.budget / 100).toLocaleString("en-IN")} less spend`}
            />
            <Line
              label="Client still owes"
              value={summary.receivable}
              note={`Expected ${(summary.expected_total / 100).toLocaleString("en-IN")} in total`}
            />
            <div className="border-t border-rule-soft pt-3.5">
              <Line
                label="Fee earned to date"
                value={summary.fee_earned}
                note={
                  project.fee_model === "percent_of_cost"
                    ? `${project.fee_percent}% of cost incurred`
                    : "Recognised against progress"
                }
              />
              {summary.own_costs > 0 && (
                <div className="mt-3.5">
                  <Line
                    label="Margin after own costs"
                    value={summary.margin}
                    note={`${(summary.own_costs / 100).toLocaleString("en-IN")} borne by the studio`}
                  />
                </div>
              )}
            </div>
          </dl>
        </div>
      </Section>

      <Section label="Where the money went" index="02">
        <div className="grid gap-10 lg:grid-cols-2">
          <CategoryRules data={breakdown} limit={12} accent={AREA_INK.professional} />
          <div className="lg:border-l lg:border-rule lg:pl-10">
            <Annot className="mb-3">Client payments</Annot>
            {payments.length ? (
              <div className="border-t border-rule-soft">
                {payments.map((payment, index) => (
                  <div
                    key={index}
                    className="flex items-baseline justify-between gap-4 border-b border-rule-soft py-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px]">
                        {formatDate(payment.date)}
                      </span>
                      {payment.reference && (
                        <span className="block text-3xs text-ink-3">
                          {payment.reference}
                        </span>
                      )}
                    </span>
                    <Money paise={payment.amount} tone="in" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-ink-3">No payments recorded yet.</p>
            )}
          </div>
        </div>
      </Section>

      <Section label="Expenses" index="03">
        {!debits.length ? (
          <p className="text-[13px] text-ink-3">Nothing spent on this project yet.</p>
        ) : (
          <Ledger min={640}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Entry</Th>
                <Th>Category</Th>
                <Th>Kind</Th>
                <Th right>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {debits.map((txn) => {
                const share = txn.allocations
                  .filter((a) => a.fund_id === fund_id)
                  .reduce((sum, a) => sum + a.amount, 0);
                const category = txn.allocations.find(
                  (a) => a.fund_id === fund_id,
                )?.category_name;
                return (
                  <tr key={txn.id}>
                    <Td className="whitespace-nowrap text-ink-3">
                      {formatDateShort(txn.value_date)}
                    </Td>
                    <Td className="max-w-[300px]">
                      <span className="block truncate" title={txn.description_raw}>
                        {txn.description_norm || txn.description_raw}
                      </span>
                      {txn.allocations.length > 1 && (
                        <span className="text-3xs text-ink-3">
                          split across {txn.allocations.length} areas
                        </span>
                      )}
                    </Td>
                    <Td className="text-ink-2">{category ?? "—"}</Td>
                    <Td className="text-ink-3">{humanise(txn.kind)}</Td>
                    <Td right>
                      <Money paise={share} exact tone="out" />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Ledger>
        )}
      </Section>

      <Modal
        open={drawing}
        onClose={() => setDrawing(false)}
        title="Draw your fee"
        note="Moves money from this project to Personal. No bank transaction is created."
      >
        <form
          className="space-y-4"
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
        >
          <p className="border-l-2 border-rule pl-3 text-2xs text-ink-2">
            Fee earned to date <Money paise={summary.fee_earned} />
            {summary.drawn > 0 && (
              <>
                {" · "}already drawn <Money paise={summary.drawn} />
              </>
            )}
          </p>
          <Field label="Amount">
            <input
              name="amount"
              className="field"
              required
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
          <div className="flex justify-end gap-3 border-t border-rule pt-4">
            <button type="button" className="btn-line" onClick={() => setDrawing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-solid" disabled={drawFee.isPending}>
              Draw fee
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function Line({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div className="min-w-0">
        <dt className="text-[13px] text-ink-2">{label}</dt>
        <dd className="text-3xs text-ink-3">{note}</dd>
      </div>
      <Money paise={value} className="shrink-0 text-[15px]" />
    </div>
  );
}
