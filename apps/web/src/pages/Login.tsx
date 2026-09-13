import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError, api } from "../lib/api";
import { Field } from "../components/ui";

export default function Login() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("ananya@iyerassociates.in");
  const [password, setPassword] = useState("studioledger2026");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { email, password });
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not reach the server.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-5">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <span className="font-mono text-[15px] font-semibold text-white">SL</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Studio Ledger</h1>
            <p className="text-[12px] text-ink-3">
              Project and personal money, one account
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <Field label="Email">
            <input
              type="email"
              className="field"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>

          <Field label="Password">
            <input
              type="password"
              className="field"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          {error && (
            <p className="rounded-md border border-neg/40 bg-neg-soft px-3 py-2 text-[12px] text-neg">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <p className="border-t border-line-soft pt-3 text-2xs leading-relaxed text-ink-3">
            This app never asks for a bank password, UPI PIN, card PIN or OTP.
            It only reads statements you download yourself.
          </p>
        </form>

        <p className="mt-4 text-center text-2xs text-ink-3">
          Demo credentials are pre-filled.
        </p>
      </div>
    </div>
  );
}
