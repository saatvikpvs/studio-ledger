import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { CategoryRules } from "../components/Graphs";
import {
  AREA_INK,
  Annot,
  Bar,
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
import { formatCompact, formatDateShort, rupeesToPaise } from "../lib/money";
import type {
  CategorySlice,
  Client,
  ClientPayment,
  Overview,
  ProjectSummary,
} from "../lib/types";

export default function StudioArea() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState<"project" | "client" | null>(null);

  const overview = useQuery<Overview>({
    queryKey: ["overview"],
    queryFn: () => api.get<Overview>("/overview"),
  });
  const projects = useQuery<ProjectSummary[]>({
    queryKey: ["projects", "active"],
    queryFn: () => api.get<ProjectSummary[]>("/projects", { status: "active" }),
  });
  const clients = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: () => api.get<Client[]>("/clients"),
  });
  const payments = useQuery<ClientPayment[]>({
    queryKey: ["client-payments"],
    queryFn: () => api.get<ClientPayment[]>("/charts/client-payments"),
  });
  const breakdown = useQuery<CategorySlice[]>({
    queryKey: ["category-breakdown", "project"],
    queryFn: () =>
      api.get<CategorySlice[]>("/charts/category-breakdown", { scope: "project" }),
  });

  const createProject = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/projects", body),
    onSuccess: () => {
      toast.push("Project created, with its own fund.");
      setCreating(null);
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const createClient = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/clients", body),
    onSuccess: () => {
      toast.push("Client added.");
      setCreating(null);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  if (projects.isError) {
    return <ErrorNote error={projects.error} onRetry={() => projects.refetch()} />;
  }

  const area = overview.data?.professional;
  const rows = projects.data ?? [];

  return (
    <>
      <PageTitle
        sub="Spatial Anthology. Client money is held against the project it was paid for — spending it never touches your personal balance."
        right={
          <>
            <button className="btn-line" onClick={() => setCreating("client")}>
              Add client
            </button>
            <button className="btn-solid" onClick={() => setCreating("project")}>
              New project
            </button>
          </>
        }
      >
        Professional
      </PageTitle>

      <Section label="Standing" index="01">
        {!area ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <Figure
              label="Client money held"
              paise={area.balance}
              accent={AREA_INK.professional}
              note="Received but not yet spent — this is not yours"
            />
            <Figure
              label="Still owed to you"
              paise={area.receivable}
              size="sm"
              tone="plain"
            />
            <Figure
              label="Project spend this month"
              paise={area.out_month}
              size="sm"
              tone="out"
            />
            <Figure
              label="Fee earned this year"
              paise={area.fee_earned_fy}
              size="sm"
              tone="in"
              note="What the studio actually earns, not what passes through it"
            />
          </div>
        )}
      </Section>

      <Section label="Projects" index="02">
        {projects.isLoading ? (
          <Skeleton className="h-52" />
        ) : !rows.length ? (
          <Empty
            title="No active projects"
            body="Create a project and any advance you receive for it is held in its own fund, separate from your own money."
            action={
              <button className="btn-solid" onClick={() => setCreating("project")}>
                Create a project
              </button>
            }
          />
        ) : (
          <div className="border-t border-rule-soft">
            {rows.map((project) => (
              <Link
                key={project.project_id}
                to={`/projects/${project.project_id}`}
                className="grid gap-x-8 gap-y-3 border-b border-rule-soft py-5 transition-colors hover:bg-paper-2/50 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="truncate font-serif text-[19px] leading-tight">
                      {project.name}
                    </h3>
                    <span className="shrink-0 text-3xs uppercase tracking-annot">
                      {project.alert === "critical" ? (
                        <span className="text-oxide">
                          short {formatCompact(Math.abs(project.in_hand))}
                        </span>
                      ) : project.alert === "warning" ? (
                        <span className="text-ochre">
                          {Math.round(project.percent_of_received)}% spent
                        </span>
                      ) : (
                        <span className="text-ink-3">on track</span>
                      )}
                    </span>
                  </div>
                  <div className="annot mt-1 truncate">
                    {[project.client_name, project.location, project.project_type]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div className="mt-3">
                    <Bar
                      percent={project.percent_of_received}
                      over={project.percent_of_received > 100}
                      colour={
                        project.alert === "critical"
                          ? "var(--oxide)"
                          : project.alert === "warning"
                            ? "var(--ochre)"
                            : AREA_INK.professional
                      }
                    />
                  </div>
                </div>

                <dl className="grid grid-cols-3 gap-4 self-center">
                  {(
                    [
                      ["Received", project.received],
                      ["Spent", project.spent],
                      ["In hand", project.in_hand],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <Annot>{label}</Annot>
                      <div className="mt-0.5 font-serif text-[17px] leading-tight">
                        <Money paise={value} compact />
                      </div>
                    </div>
                  ))}
                  {project.drawn > 0 && (
                    <div className="col-span-3 text-3xs text-ink-3">
                      <Money paise={project.drawn} compact /> fee drawn to Personal
                    </div>
                  )}
                </dl>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section label="Studio spend" index="03">
        {breakdown.isLoading ? (
          <Skeleton className="h-56" />
        ) : (
          <div className="grid gap-10 lg:grid-cols-2">
            <CategoryRules
              data={breakdown.data ?? []}
              limit={10}
              accent={AREA_INK.professional}
            />
            <div className="lg:border-l lg:border-rule lg:pl-10">
              <div className="annot mb-3">Client payments received</div>
              {!payments.data?.length ? (
                <p className="text-[13px] text-ink-3">
                  No client payments recorded yet.
                </p>
              ) : (
                <Ledger min={320}>
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Project</Th>
                      <Th right>Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...payments.data].reverse().slice(0, 10).map((payment, index) => (
                      <tr key={index}>
                        <Td className="whitespace-nowrap text-ink-3">
                          {formatDateShort(payment.date)}
                        </Td>
                        <Td className="max-w-[180px] truncate">{payment.project}</Td>
                        <Td right>
                          <Money paise={payment.amount} tone="in" />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Ledger>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* ------------------------------------------------------- new client */}
      <Modal
        open={creating === "client"}
        onClose={() => setCreating(null)}
        title="Add a client"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            createClient.mutate({
              name: String(form.get("name")),
              phone: String(form.get("phone") || "") || null,
              email: String(form.get("email") || "") || null,
              address: String(form.get("address") || "") || null,
              gstin: String(form.get("gstin") || "") || null,
              notes: null,
            });
          }}
        >
          <Field label="Name">
            <input name="name" className="field" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <input name="phone" className="field" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" className="field" />
            </Field>
          </div>
          <Field label="Address">
            <input name="address" className="field" />
          </Field>
          <Field label="GSTIN" hint="Optional">
            <input name="gstin" className="field" />
          </Field>
          <div className="flex justify-end gap-3 border-t border-rule pt-4">
            <button type="button" className="btn-line" onClick={() => setCreating(null)}>
              Cancel
            </button>
            <button type="submit" className="btn-solid" disabled={createClient.isPending}>
              Add client
            </button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------------ new project */}
      <Modal
        open={creating === "project"}
        onClose={() => setCreating(null)}
        title="New project"
        note="A fund is created automatically to hold this project's money."
        wide
      >
        {!clients.data?.length ? (
          <div>
            <p className="text-[13px] text-ink-2">
              Add a client first — every project belongs to one.
            </p>
            <button
              className="btn-solid mt-4"
              onClick={() => setCreating("client")}
            >
              Add a client
            </button>
          </div>
        ) : (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const get = (key: string) => String(form.get(key) ?? "");
              createProject.mutate({
                name: get("name"),
                client_id: Number(get("client_id")),
                code: get("code") || null,
                location: get("location") || null,
                project_type: get("project_type") || null,
                start_date: get("start_date") || null,
                due_date: get("due_date") || null,
                budget: rupeesToPaise(get("budget")) ?? 0,
                expected_total: rupeesToPaise(get("expected_total")) ?? 0,
                fee_model: get("fee_model") || "percent_of_cost",
                fee_percent: Number(get("fee_percent") || 8),
                fee_lump_sum: rupeesToPaise(get("fee_lump_sum")) ?? 0,
                status: "active",
              });
            }}
          >
            <Field label="Project name">
              <input name="name" className="field" required />
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
              <input name="code" className="field" placeholder="SA-01" />
            </Field>
            <Field label="Type">
              <input name="project_type" className="field" placeholder="Residential" />
            </Field>
            <Field label="Location">
              <input name="location" className="field" />
            </Field>
            <Field label="Start date">
              <input name="start_date" type="date" className="field" />
            </Field>
            <Field label="Budget" hint="Total cost you expect to spend">
              <input name="budget" className="field" placeholder="32,00,000" />
            </Field>
            <Field label="Expected from client">
              <input name="expected_total" className="field" placeholder="28,00,000" />
            </Field>

            <div className="border-t border-rule pt-4 sm:col-span-2">
              <p className="mb-3 max-w-measure text-2xs leading-relaxed text-ink-3">
                Your fee is what the studio actually earns — the rest of the
                client's money passes through you to suppliers. Setting it here
                makes profitability a real figure rather than unspent client cash.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Fee model">
                  <select name="fee_model" className="field" defaultValue="percent_of_cost">
                    <option value="percent_of_cost">Percent of cost</option>
                    <option value="lump_sum">Lump sum</option>
                    <option value="none">Not tracked</option>
                  </select>
                </Field>
                <Field label="Fee percent">
                  <input name="fee_percent" className="field" defaultValue="8" />
                </Field>
                <Field label="Lump sum fee">
                  <input name="fee_lump_sum" className="field" />
                </Field>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-rule pt-4 sm:col-span-2">
              <button type="button" className="btn-line" onClick={() => setCreating(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-solid" disabled={createProject.isPending}>
                Create project
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
