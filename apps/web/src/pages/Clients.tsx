import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  Card,
  EmptyState,
  Field,
  Modal,
  Money,
  PageHeader,
  Skeleton,
  Td,
  Th,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import type { Client } from "../lib/types";

export default function Clients() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);

  const clients = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: () => api.get<Client[]>("/clients"),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/clients", body),
    onSuccess: () => {
      toast.push("Client added.");
      setAdding(false);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error) => toast.push((error as Error).message, "error"),
  });

  const rows = clients.data ?? [];

  return (
    <>
      <PageHeader title="Clients" subtitle="Who the projects belong to">
        <button className="btn-primary" onClick={() => setAdding(true)}>
          Add client
        </button>
      </PageHeader>

      {clients.isLoading ? (
        <Skeleton className="h-64" />
      ) : !rows.length ? (
        <EmptyState
          title="No clients yet"
          message="Add a client, then create a project for them. Client money is tracked per project, not per client."
          action={
            <button className="btn-primary" onClick={() => setAdding(true)}>
              Add client
            </button>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Contact</Th>
                  <Th>Location</Th>
                  <Th>GSTIN</Th>
                  <Th right>Projects</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((client) => (
                  <tr key={client.id}>
                    <Td className="font-medium">{client.name}</Td>
                    <Td className="text-ink-2">
                      {client.phone ?? "—"}
                      {client.email && (
                        <span className="block text-2xs text-ink-3">{client.email}</span>
                      )}
                    </Td>
                    <Td className="max-w-[220px] truncate text-ink-2">
                      {client.address ?? "—"}
                    </Td>
                    <Td className="font-mono text-2xs text-ink-3">
                      {client.gstin ?? "—"}
                    </Td>
                    <Td right className="text-ink-2">
                      {client.project_count}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a client">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            create.mutate({
              name: String(form.get("name")),
              phone: String(form.get("phone") ?? "") || null,
              email: String(form.get("email") ?? "") || null,
              address: String(form.get("address") ?? "") || null,
              gstin: String(form.get("gstin") ?? "") || null,
              notes: null,
            });
          }}
          className="space-y-4"
        >
          <Field label="Name">
            <input name="name" className="field" required placeholder="Rao Sudhir" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <input name="phone" className="field" placeholder="+91 98450 11223" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" className="field" />
            </Field>
          </div>
          <Field label="Address">
            <input name="address" className="field" placeholder="Jayanagar, Bengaluru" />
          </Field>
          <Field
            label="GSTIN"
            hint="Needed on invoices if the client is GST-registered"
          >
            <input name="gstin" className="field" placeholder="29ABCDE1234F1Z5" />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Add client"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
