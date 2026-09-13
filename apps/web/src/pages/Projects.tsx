import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import ProjectCard from "../components/ProjectCard";
import { BulletBar } from "../components/charts";
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Money,
  PageHeader,
  SectionTitle,
  Skeleton,
  cx,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { rupeesToPaise } from "../lib/money";
import type { Client, ProjectSummary } from "../lib/types";

const FILTERS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
] as const;

export default function Projects() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<string>("active");
  const [creating, setCreating] = useState(false);

  const projects = useQuery<ProjectSummary[]>({
    queryKey: ["projects", filter],
    queryFn: () => api.get<ProjectSummary[]>("/projects", { status: filter }),
  });

  const clients = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: () => api.get<Client[]>("/clients"),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/projects", body),
    onSuccess: () => {
      toast.push("Project created, with its own fund.");
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const get = (key: string) => String(form.get(key) ?? "");
    create.mutate({
      name: get("name"),
      client_id: Number(get("client_id")),
      code: get("code") || null,
      location: get("location") || null,
      project_type: get("project_type") || null,
      start_date: get("start_date") || null,
      due_date: get("due_date") || null,
      budget: rupeesToPaise(get("budget")) ?? 0,
      expected_total: rupeesToPaise(get("expected_total")) ?? 0,
      fee_model: get("fee_model"),
      fee_percent: Number(get("fee_percent") || 8),
      fee_lump_sum: rupeesToPaise(get("fee_lump_sum")) ?? 0,
      status: get("status") || "active",
    });
  };

  if (projects.isError) {
    return <ErrorState error={projects.error} onRetry={() => projects.refetch()} />;
  }

  const rows = projects.data ?? [];

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Each project holds its own fund, separate from your personal money"
      >
        <button className="btn-primary" onClick={() => setCreating(true)}>
          New project
        </button>
      </PageHeader>

      <div className="mb-5 flex gap-1 rounded-md border border-line bg-surface p-1 w-fit">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            onClick={() => setFilter(option.key)}
            className={cx(
              "rounded px-3 py-1.5 text-[13px] transition-colors",
              filter === option.key
                ? "bg-accent-soft font-medium text-accent"
                : "text-ink-2 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {projects.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[188px]" />
          ))}
        </div>
      ) : !rows.length ? (
        <EmptyState
          title="No projects here"
          message="Create a project and any client money you receive for it is tracked in its own fund — spending it never touches your personal balance."
          action={
            <button className="btn-primary" onClick={() => setCreating(true)}>
              Create a project
            </button>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((project) => (
              <ProjectCard key={project.project_id} project={project} />
            ))}
          </div>

          <Card className="mt-6">
            <SectionTitle>Budget against actual</SectionTitle>
            <p className="mb-4 text-[12px] text-ink-3">
              Solid bar is spent, pale band is received, the vertical rule is budget.
            </p>
            <div className="space-y-4">
              {rows.map((project) => (
                <div key={project.project_id}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="truncate font-medium">{project.name}</span>
                    <span className="shrink-0 text-ink-3">
                      spent <Money paise={project.spent} compact /> of budget{" "}
                      <Money paise={project.budget} compact />
                    </span>
                  </div>
                  <BulletBar
                    spent={project.spent}
                    received={project.received}
                    budget={project.budget}
                  />
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New project"
        description="A fund is created automatically to hold this project's money."
        wide
      >
        {!clients.data?.length ? (
          <p className="text-[13px] text-ink-2">
            Add a client first — every project belongs to one.
          </p>
        ) : (
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label="Project name">
              <input name="name" className="field" required placeholder="Rao Residence" />
            </Field>
            <Field label="Client">
              <select name="client_id" className="field" required>
                {clients.data.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Code">
              <input name="code" className="field" placeholder="RAO-01" />
            </Field>
            <Field label="Type">
              <input name="project_type" className="field" placeholder="Residential" />
            </Field>
            <Field label="Location">
              <input name="location" className="field" placeholder="Jayanagar, Bengaluru" />
            </Field>
            <Field label="Status">
              <select name="status" className="field" defaultValue="active">
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="on_hold">On hold</option>
                <option value="completed">Completed</option>
              </select>
            </Field>
            <Field label="Start date">
              <input name="start_date" type="date" className="field" />
            </Field>
            <Field label="Expected completion">
              <input name="due_date" type="date" className="field" />
            </Field>
            <Field label="Budget" hint="Total project cost you expect to spend">
              <input name="budget" className="field" placeholder="32,00,000" />
            </Field>
            <Field
              label="Expected from client"
              hint="Drives the outstanding receivable figure"
            >
              <input name="expected_total" className="field" placeholder="28,00,000" />
            </Field>

            <div className="sm:col-span-2 border-t border-line-soft pt-4">
              <p className="mb-3 text-[12px] leading-relaxed text-ink-3">
                Your fee is what you actually earn — the rest of the client's money
                passes through you to suppliers. Setting it here makes profitability
                a real number rather than unspent client cash.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Fee model">
                  <select name="fee_model" className="field" defaultValue="percent_of_cost">
                    <option value="percent_of_cost">Percent of cost</option>
                    <option value="lump_sum">Lump sum</option>
                    <option value="none">No fee tracked</option>
                  </select>
                </Field>
                <Field label="Fee percent">
                  <input name="fee_percent" className="field" defaultValue="8" />
                </Field>
                <Field label="Lump sum fee">
                  <input name="fee_lump_sum" className="field" placeholder="7,50,000" />
                </Field>
              </div>
            </div>

            <div className="flex justify-end gap-2 sm:col-span-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
