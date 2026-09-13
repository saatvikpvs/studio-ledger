import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { api } from "../lib/api";
import type { Integrity, Owner } from "../lib/types";
import { cx } from "./ui";

type Item = { to: string; label: string; badge?: "review"; end?: boolean };
type Group = { heading?: string; items: Item[] };

const NAV: Group[] = [
  {
    items: [
      { to: "/", label: "Dashboard", end: true },
      { to: "/review", label: "Review", badge: "review" },
    ],
  },
  {
    heading: "Work",
    items: [
      { to: "/projects", label: "Projects" },
      { to: "/clients", label: "Clients" },
      { to: "/payments", label: "Client payments" },
    ],
  },
  {
    heading: "Money",
    items: [
      { to: "/transactions", label: "Transactions" },
      { to: "/expenses", label: "Project expenses" },
      { to: "/personal", label: "Personal" },
    ],
  },
  {
    heading: "Admin",
    items: [
      { to: "/import", label: "Import statement" },
      { to: "/reports", label: "Reports" },
      { to: "/settings", label: "Settings" },
    ],
  },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<string>(
    () => document.documentElement.getAttribute("data-theme") ?? "system",
  );

  const { data: owner } = useQuery<Owner>({
    queryKey: ["me"],
    queryFn: () => api.get<Owner>("/auth/me"),
  });

  const { data: dashboard } = useQuery<{ review_count: number }>({
    queryKey: ["dashboard"],
    queryFn: () => api.get("/dashboard/summary"),
  });

  const { data: integrity } = useQuery<Integrity>({
    queryKey: ["integrity"],
    queryFn: () => api.get<Integrity>("/health/integrity"),
    refetchInterval: 120_000,
  });

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("sl-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("sl-theme", theme);
    }
  }, [theme]);

  const signOut = async () => {
    await api.post("/auth/logout");
    queryClient.clear();
    navigate("/login");
  };

  const reviewCount = dashboard?.review_count ?? 0;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      {/* ---------------------------------------------------------- sidebar */}
      <aside
        className={cx(
          "bg-surface border-r border-line flex flex-col",
          "fixed inset-y-0 left-0 z-30 w-[236px] transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="px-5 py-5 border-b border-line-soft">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded bg-accent flex items-center justify-center shrink-0">
              <span className="font-mono text-[13px] font-semibold text-white">SL</span>
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-[13px] leading-tight truncate">
                Studio Ledger
              </div>
              <div className="text-2xs text-ink-3 truncate">
                {owner?.practice_name ?? "…"}
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV.map((group, index) => (
            <div key={index} className={index ? "mt-5" : ""}>
              {group.heading && (
                <div className="label px-2 mb-1.5">{group.heading}</div>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cx(
                          "flex items-center justify-between gap-2 rounded-md px-2.5 py-[7px] text-[13px] transition-colors",
                          isActive
                            ? "bg-accent-soft text-accent font-medium"
                            : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                        )
                      }
                    >
                      <span>{item.label}</span>
                      {item.badge === "review" && reviewCount > 0 && (
                        <span className="rounded-full bg-warn px-1.5 py-px font-mono text-[10px] font-semibold text-white tabular">
                          {reviewCount}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line-soft p-3 space-y-2">
          <div
            className="flex rounded-md border border-line p-0.5"
            role="group"
            aria-label="Theme"
          >
            {(["light", "system", "dark"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setTheme(option)}
                className={cx(
                  "flex-1 rounded px-1 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  theme === option
                    ? "bg-surface-2 text-ink"
                    : "text-ink-3 hover:text-ink-2",
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            onClick={signOut}
            className="w-full rounded-md px-2.5 py-1.5 text-left text-[12px] text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
          >
            Sign out {owner?.display_name ? `— ${owner.display_name}` : ""}
          </button>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-20 bg-ink/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ------------------------------------------------------------- main */}
      <div className="min-w-0">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
          <button
            onClick={() => setOpen(true)}
            className="btn-ghost btn-sm"
            aria-label="Open navigation"
          >
            Menu
          </button>
          <span className="font-semibold text-[13px]">Studio Ledger</span>
          {reviewCount > 0 && (
            <span className="ml-auto rounded-full bg-warn px-1.5 py-px font-mono text-[10px] font-semibold text-white">
              {reviewCount}
            </span>
          )}
        </header>

        {integrity && !integrity.ok && (
          <div className="border-b border-neg/40 bg-neg-soft px-5 py-2.5 text-[13px] text-neg">
            <strong className="font-semibold">Ledger integrity check failed.</strong>{" "}
            Fund balances no longer sum to the bank balance. Nothing was written
            outside the ledger service — see Settings › Integrity.
          </div>
        )}

        <main className="p-5 lg:p-8 max-w-[1400px]">{children}</main>
      </div>
    </div>
  );
}
