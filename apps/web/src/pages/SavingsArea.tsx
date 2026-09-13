import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { GoalRule } from "../components/Graphs";
import {
  AREA_INK,
  Annot,
  Empty,
  ErrorNote,
  Field,
  Figure,
  Ledger,
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
import type { FundTransfer, Overview, SavingsGoal } from "../lib/types";

export default function SavingsArea() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<SavingsGoal | "new" | null>(null);

  const overview = useQuery<Overview>({
    queryKey: ["overview"],
    queryFn: () => api.get<Overview>("/overview"),
  });

  const goals = useQuery<SavingsGoal[]>({
    queryKey: ["goals"],
    queryFn: () => api.get<SavingsGoal[]>("/savings/goals"),
  });

  const transfers = useQuery<FundTransfer[]>({
    queryKey: ["fund-transfers"],
    queryFn: () => api.get<FundTransfer[]>("/fund-transfers"),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing && editing !== "new"
        ? api.patch(`/savings/goals/${editing.id}`, body)
        : api.post("/savings/goals", body),
    onSuccess: () => {
      toast.push(editing === "new" ? "Goal created." : "Goal updated.");
      setEditing(null);
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const archive = useMutation({
    mutationFn: (id: number) => api.del(`/savings/goals/${id}`),
    onSuccess: (result) => {
      toast.push((result as { message: string }).message);
      queryClient.invalidateQueries();
    },
  });

  if (goals.isError) {
    return <ErrorNote error={goals.error} onRetry={() => goals.refetch()} />;
  }

  const area = overview.data?.savings;
  const rows = goals.data ?? [];
  const savingsMoves = (transfers.data ?? []).filter((t) =>
    t.reason.startsWith("savings"),
  );

  return (
    <>
      <PageTitle
        sub="Money you have set aside. It is still in the same bank account — putting it here reserves it, so the rest of the dashboard stops counting it as spendable."
        right={
          <button className="btn-line" onClick={() => setEditing("new")}>
            New goal
          </button>
        }
      >
        Savings
      </PageTitle>

      <Section label="Set aside" index="01">
        {!area ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="grid gap-8 sm:grid-cols-3">
            <Figure
              label="Total saved"
              paise={area.balance}
              accent={AREA_INK.savings}
            />
            <Figure
              label="Added this month"
              paise={area.contributed_month}
              size="sm"
              tone="in"
            />
            <Figure
              label="Total targets"
              paise={rows.reduce((sum, goal) => sum + goal.target_amount, 0)}
              size="sm"
              tone="plain"
              note={`${rows.length} ${rows.length === 1 ? "goal" : "goals"}`}
            />
          </div>
        )}
      </Section>

      <Section label="Goals" index="02">
        {goals.isLoading ? (
          <Skeleton className="h-56" />
        ) : !rows.length ? (
          <Empty
            title="No goals yet"
            body="A goal is a named envelope — an emergency fund, new equipment, a trip. Set a target and put money aside against it from the strip at the top."
            action={
              <button className="btn-solid" onClick={() => setEditing("new")}>
                Create a goal
              </button>
            }
          />
        ) : (
          <div className="border-t border-rule-soft">
            {rows.map((goal) => {
              const met = goal.target_amount > 0 && goal.balance >= goal.target_amount;
              return (
                <div
                  key={goal.id}
                  className="grid gap-x-8 gap-y-3 border-b border-rule-soft py-5 md:grid-cols-[minmax(0,1fr)_220px]"
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-4">
                      <h3 className="truncate font-serif text-[19px] leading-tight">
                        {goal.name}
                      </h3>
                      <span className="shrink-0 text-3xs uppercase tracking-annot text-ink-3">
                        {met ? (
                          <span className="text-patina">Reached</span>
                        ) : goal.target_amount ? (
                          `${Math.round(goal.percent)}%`
                        ) : (
                          "No target"
                        )}
                      </span>
                    </div>

                    <div className="mt-3">
                      <GoalRule
                        balance={goal.balance}
                        target={goal.target_amount}
                      />
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-2xs text-ink-3">
                      <span>
                        Saved <Money paise={goal.balance} className="text-ink" />
                      </span>
                      {goal.target_amount > 0 && (
                        <>
                          <span>
                            Target <Money paise={goal.target_amount} />
                          </span>
                          {!met && (
                            <span>
                              <Money paise={goal.remaining} /> to go
                            </span>
                          )}
                        </>
                      )}
                      {goal.target_date && (
                        <span>By {formatDate(goal.target_date)}</span>
                      )}
                    </div>
                    {goal.note && (
                      <p className="mt-2 max-w-measure text-2xs text-ink-3">
                        {goal.note}
                      </p>
                    )}
                  </div>

                  <div className="flex items-start gap-4 md:justify-end">
                    <button
                      className="btn-quiet"
                      onClick={() => setEditing(goal)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-quiet"
                      onClick={() => archive.mutate(goal.id)}
                    >
                      Archive
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section label="Movements" index="03">
        {!savingsMoves.length ? (
          <p className="text-[13px] text-ink-3">
            Nothing set aside yet. Choose “Savings” in the strip at the top of
            the page to move money into a goal.
          </p>
        ) : (
          <Ledger min={560}>
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
              {savingsMoves.map((move) => (
                <tr key={move.id}>
                  <Td className="whitespace-nowrap text-ink-3">
                    {formatDateShort(move.date)}
                  </Td>
                  <Td>{move.from_fund}</Td>
                  <Td>{move.to_fund}</Td>
                  <Td className="text-ink-3">{humanise(move.reason)}</Td>
                  <Td right>
                    <Money paise={move.amount} exact />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Ledger>
        )}
        <p className="mt-4 max-w-measure border-l-2 border-rule pl-3 text-2xs leading-relaxed text-ink-3">
          These are moves between your own envelopes, so no bank transaction is
          created and nothing is counted as income or expense.
        </p>
      </Section>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New savings goal" : "Edit goal"}
        note="A goal reserves money that is already in your account."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            save.mutate({
              name: String(form.get("name")),
              target_amount: rupeesToPaise(String(form.get("target") ?? "0")) ?? 0,
              target_date: String(form.get("target_date") || "") || null,
              note: String(form.get("note") || "") || null,
            });
          }}
        >
          <Field label="Name">
            <input
              name="name"
              className="field"
              required
              placeholder="Emergency fund"
              defaultValue={editing && editing !== "new" ? editing.name : ""}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Target amount">
              <input
                name="target"
                className="field"
                placeholder="3,00,000"
                defaultValue={
                  editing && editing !== "new" && editing.target_amount
                    ? String(editing.target_amount / 100)
                    : ""
                }
              />
            </Field>
            <Field label="By when" hint="Optional">
              <input
                name="target_date"
                type="date"
                className="field"
                defaultValue={
                  editing && editing !== "new" ? editing.target_date ?? "" : ""
                }
              />
            </Field>
          </div>
          <Field label="Note" hint="Optional">
            <input
              name="note"
              className="field"
              defaultValue={editing && editing !== "new" ? editing.note ?? "" : ""}
            />
          </Field>
          <div className="flex justify-end gap-3 border-t border-rule pt-4">
            <button
              type="button"
              className="btn-line"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
            <button type="submit" className="btn-solid" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save goal"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
