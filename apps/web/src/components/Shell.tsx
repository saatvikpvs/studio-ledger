import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { api } from "../lib/api";
import { formatDate } from "../lib/money";
import type { Integrity, Overview, Owner } from "../lib/types";
import QuickEntry from "./QuickEntry";
import { AREA_INK, Annot, cx } from "./ui";

const AREAS = [
  { to: "/personal", label: "Personal", area: "personal" as const },
  { to: "/studio", label: "Professional", area: "professional" as const },
  { to: "/savings", label: "Savings", area: "savings" as const },
];

const LEDGER = [
  { to: "/entries", label: "Entries" },
  { to: "/reconcile", label: "Reconcile", badge: true },
  { to: "/reports", label: "Reports" },
  { to: "/settings", label: "Settings" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<string>(
    () => document.documentElement.getAttribute("data-theme") ?? "system",
  );

  const { data: owner } = useQuery<Owner>({
    queryKey: ["me"],
    queryFn: () => api.get<Owner>("/auth/me"),
  });
  const { data: overview } = useQuery<Overview>({
    queryKey: ["overview"],
    queryFn: () => api.get<Overview>("/overview"),
  });
  const { data: integrity } = useQuery<Integrity>({
    queryKey: ["integrity"],
    queryFn: () => api.get<Integrity>("/health/integrity"),
    refetchInterval: 180_000,
  });

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("sa-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("sa-theme", theme);
    }
  }, [theme]);

  const signOut = async () => {
    await api.post("/auth/logout");
    queryClient.clear();
    navigate("/login");
  };

  const unfiled = overview?.unassigned.count ?? 0;
  const practice = owner?.practice_name || "Spatial Anthology";
  const [family, given] = practice.split(" ");

  return (
    <div className="min-h-screen">
      {/* ================================================== title block === */}
      <header className="no-print border-b border-ink">
        <div className="sheet flex items-stretch justify-between gap-6">
          {/* wordmark */}
          <NavLink to="/" className="group flex shrink-0 items-center py-4">
            <span className="block">
              <span className="block font-serif text-[19px] leading-none">
                {family}
              </span>
              <span className="mt-[3px] block font-sans text-3xs uppercase tracking-wordmark text-ink-3">
                {given ?? "Ledger"}
              </span>
            </span>
          </NavLink>

          {/* navigation — typographic, with the area keyline under each */}
          <nav className="hidden flex-1 items-stretch justify-center gap-7 lg:flex">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                cx(
                  "flex items-center border-b-2 pt-4 text-[13px] transition-colors",
                  isActive
                    ? "border-ink text-ink"
                    : "border-transparent text-ink-3 hover:text-ink",
                )
              }
            >
              Overview
            </NavLink>
            {AREAS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cx(
                    "flex items-center border-b-2 pt-4 text-[13px] transition-colors",
                    isActive ? "text-ink" : "border-transparent text-ink-3 hover:text-ink",
                  )
                }
                style={({ isActive }) =>
                  isActive ? { borderBottomColor: AREA_INK[item.area] } : undefined
                }
              >
                {item.label}
              </NavLink>
            ))}
            <span className="my-4 w-px bg-rule" aria-hidden="true" />
            {LEDGER.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cx(
                    "flex items-center gap-1.5 border-b-2 pt-4 text-[13px] transition-colors",
                    isActive
                      ? "border-ink text-ink"
                      : "border-transparent text-ink-3 hover:text-ink",
                  )
                }
              >
                {item.label}
                {item.badge && unfiled > 0 && (
                  <span className="tnum text-3xs text-ochre">{unfiled}</span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* sheet metadata, right-aligned like a title block */}
          <div className="hidden shrink-0 items-center gap-5 py-4 xl:flex">
            <div className="text-right">
              <Annot>As at</Annot>
              <div className="text-[13px] tnum">
                {overview ? formatDate(overview.as_of) : "—"}
              </div>
            </div>
            <div className="h-8 w-px bg-rule" aria-hidden="true" />
            <div className="text-right">
              <Annot>In the bank</Annot>
              <div className="font-serif text-[17px] leading-tight tnum">
                {overview
                  ? (overview.bank_balance / 100).toLocaleString("en-IN", {
                      style: "currency",
                      currency: "INR",
                      maximumFractionDigits: 0,
                    })
                  : "—"}
              </div>
            </div>
          </div>

          <button
            className="btn-line my-3 shrink-0 lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
          >
            Menu
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-rule lg:hidden">
            <div className="sheet grid grid-cols-2 gap-x-6 py-3 sm:grid-cols-4">
              {[{ to: "/", label: "Overview" }, ...AREAS, ...LEDGER].map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    cx(
                      "border-b border-rule-soft py-2 text-[13px]",
                      isActive ? "text-ink" : "text-ink-3",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* ================================================== quick entry === */}
      <QuickEntry />

      {integrity && !integrity.ok && (
        <div className="no-print border-b border-oxide bg-paper-2">
          <div className="sheet py-2.5 text-[13px] text-oxide">
            Ledger integrity check failed — the areas no longer sum to the bank
            balance. See Settings › Integrity.
          </div>
        </div>
      )}

      {/* ========================================================= body === */}
      <main className="sheet pb-24">{children}</main>

      {/* ====================================================== colophon === */}
      <footer className="no-print border-t border-ink">
        <div className="sheet flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-5">
          <div className="annot">
            {practice} · Ledger
            {overview && (
              <>
                {" · "}FY {overview.fiscal_year.start.slice(0, 4)}–
                {overview.fiscal_year.end.slice(2, 4)}
              </>
            )}
          </div>

          <div className="flex items-center gap-5">
            <div className="flex border border-rule" role="group" aria-label="Theme">
              {(["light", "system", "dark"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setTheme(option)}
                  className={cx(
                    "px-2 py-1 text-3xs uppercase tracking-annot transition-colors",
                    theme === option
                      ? "bg-ink text-paper"
                      : "text-ink-3 hover:text-ink",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            <button onClick={signOut} className="btn-quiet">
              Sign out{owner?.display_name ? ` — ${owner.display_name}` : ""}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
