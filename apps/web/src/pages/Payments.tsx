import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import {
  Card,
  EmptyState,
  Field,
  KpiTile,
  Modal,
  Money,
  PageHeader,
  SectionTitle,
  Skeleton,
  Td,
  Th,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { formatDate, rupeesToPaise } from "../lib/money";
import type { Account, ClientPayment, ProjectSummary } from "../lib/types";

export default function Payments() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [recording, setRecording] = useState(false);

  const payments = useQuery<ClientPayment[]>({
    queryKey: ["client-payments"],
    queryFn: () => api.get<ClientPayment[]>("/charts/client-payments"),
  });

  const projects = useQuery<ProjectSummary[]>({
    queryKey: ["projects", ""],
    queryFn: () => api.get<ProjectSummary[]>("/projects"),
  });

  const accounts = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts"),
  });

  const record = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/transactions", body),
    onSuccess: () => {
      toast.push("Payment recorded against the project fund.");
      setRecording(false);
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const rows = [...(payments.data ?? [])].reverse();
  const total = rows.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = (projects.data ?? []).reduce((sum, p) => sum + p.receivable, 0);

  const fundIdFor = (projectId: number) =>
    // The project detail endpoint owns the fund id; look it up on demand.
    api.get<{ fund_id: number }>(`/projects/${projectId}`).then((d) => d.fund_id);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = rupeesToPaise(String(form.get("amount") ?? ""));
    if (!amount) {
      toast.push("Enter a valid amount.", "error");
      return;
    }
    const projectId = Number(form.get("project_id"));
    const fundId = await fundIdFor(projectId);
    const client = (projects.data ?? []).find((p) => p.project_id === projectId);

    record.mutate({
      account_id: Number(form.get("account_id")),
      value_date: String(form.get("value_date")),
      direction: "credit",
      amount,
      kind: "client_payment",
      description:
        String(form.get("description") || "") ||
        `Payment from ${client?.client_name ?? "client"}`,
      external_ref: String(form.get("external_ref") ?? "") || null,
      splits: [{ fund_id: fundId, amount, category_id: null }],
    });
  };

  return (
    <>
      <PageHeader
        title="Client payments"
        subtitle="Money received from clients, held against each project's fund"
      >
        <button className="btn-primary" onClick={() => setRecording(true)}>
          Record payment
        </button>
      </PageHeader>

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <KpiTile
          label="Received to date"
          value={total}
          tone="accent"
          hint="Across every project"
        />
        <KpiTile
          label="Still outstanding"
          value={outstanding}
          tone={outstanding > 0 ? "warn" : "neutral"}
          hint="Expected total less received"
        />
        <KpiTile
          label="Payments recorded"
          value={rows.length * 100}
          hint="Count, not an amount"
        />
      </div>

      {payments.isLoading ? (
        <Skeleton className="h-80" />
      ) : !rows.length ? (
        <EmptyState
          title="No client payments yet"
          message="Record an advance or a milestone payment and it is held in that project's fund until you spend it."
          action={
            <button className="btn-primary" onClick={() => setRecording(true)}>
              Record payment
            </button>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="p-5 pb-0">
            <SectionTitle>Payment ledger</SectionTitle>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Project</Th>
                  <Th>Reference / UTR</Th>
                  <Th>Description</Th>
                  <Th right>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((payment, index) => (
                  <tr key={index}>
                    <Td className="whitespace-nowrap text-ink-2">
                      {formatDate(payment.date)}
                    </Td>
                    <Td>
                      <Link
                        to={`/projects/${payment.project_id}`}
                        className="text-accent hover:underline"
                      >
                        {payment.project}
                      </Link>
                    </Td>
                    <Td className="font-mono text-2xs text-ink-3">
                      {payment.reference ?? "—"}
                    </Td>
                    <Td className="max-w-[280px] truncate text-ink-2">
                      {payment.description}
                    </Td>
                    <Td right>
                      <Money paise={payment.amount} exact className="font-medium text-pos" />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={recording}
        onClose={() => setRecording(false)}
        title="Record a client payment"
        description="This credits the project's fund. It is money you are holding, not income."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Project">
            <select name="project_id" className="field" required>
              {(projects.data ?? []).map((project) => (
                <option key={project.project_id} value={project.project_id}>
                  {project.name} — {project.client_name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount">
              <input name="amount" className="field" required placeholder="2,00,000" />
            </Field>
            <Field label="Date">
              <input
                name="value_date"
                type="date"
                className="field"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </Field>
            <Field label="Into account">
              <select name="account_id" className="field" required>
                {(accounts.data ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reference / UTR">
              <input name="external_ref" className="field" placeholder="AXISP00234519" />
            </Field>
          </div>
          <Field label="Description">
            <input
              name="description"
              className="field"
              placeholder="NEFT CR-RAO SUDHIR-STAGE PAYMENT"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setRecording(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={record.isPending}>
              {record.isPending ? "Saving…" : "Record payment"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
