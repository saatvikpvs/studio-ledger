import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Annot, Field } from "../components/ui";
import { ApiError, api } from "../lib/api";

export default function Login() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("studio@spatialanthology.in");
  const [password, setPassword] = useState("spatialanthology");
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
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_460px]">
      {/* The sheet: a title block and nothing else. */}
      <div className="hidden flex-col justify-between border-r border-ink p-12 lg:flex">
        <div>
          <div className="font-serif text-[34px] leading-none">Spatial</div>
          <div className="mt-1 font-sans text-xs uppercase tracking-wordmark text-ink-3">
            Anthology
          </div>
        </div>

        <div
          className="my-12 h-px w-full"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, var(--rule) 0 6px, transparent 6px 12px)",
          }}
          aria-hidden="true"
        />

        <div className="max-w-[46ch]">
          <p className="font-serif text-[26px] leading-[1.25]">
            Personal, professional and savings — kept apart in software, though
            the bank keeps them in one account.
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-rule pt-5">
            {[
              ["Personal", "var(--graphite)"],
              ["Professional", "var(--blueprint)"],
              ["Savings", "var(--patina)"],
            ].map(([label, ink]) => (
              <div key={label}>
                <span
                  className="mb-2 block h-[3px] w-full"
                  style={{ background: ink }}
                />
                <dt className="annot">{label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* The form. */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-[320px]">
          <div className="lg:hidden">
            <div className="font-serif text-[26px] leading-none">Spatial</div>
            <div className="mt-1 font-sans text-xs uppercase tracking-wordmark text-ink-3">
              Anthology
            </div>
            <div className="mb-10 mt-6 h-px w-full bg-rule" />
          </div>

          <Annot>Sign in</Annot>

          <form onSubmit={submit} className="mt-5 space-y-5">
            <Field label="Email">
              <input
                type="email"
                className="field-underline"
                value={email}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>

            <Field label="Password">
              <input
                type="password"
                className="field-underline"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>

            {error && (
              <p className="border-l-2 border-oxide pl-3 text-[13px] text-oxide">
                {error}
              </p>
            )}

            <button type="submit" className="btn-solid w-full" disabled={busy}>
              {busy ? "Signing in…" : "Enter"}
            </button>
          </form>

          <p className="mt-8 border-t border-rule pt-4 text-2xs leading-relaxed text-ink-3">
            This ledger never asks for a bank password, UPI PIN, card PIN or OTP.
            It only reads statements you download yourself.
          </p>
        </div>
      </div>
    </div>
  );
}
