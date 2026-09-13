import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { formatCompact, formatPaise } from "../lib/money";

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

export type Area = "personal" | "professional" | "savings" | "unassigned";

/** The three areas are told apart by a keyline colour, never by a filled panel. */
export const AREA_INK: Record<Area, string> = {
  personal: "var(--graphite)",
  professional: "var(--blueprint)",
  savings: "var(--patina)",
  unassigned: "var(--ochre)",
};

export const AREA_LABEL: Record<Area, string> = {
  personal: "Personal",
  professional: "Professional",
  savings: "Savings",
  unassigned: "Unfiled",
};

/* ------------------------------------------------------------- annotation */

export function Annot({
  children,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "span" | "h2" | "h3";
}) {
  return <Tag className={cx("annot", className)}>{children}</Tag>;
}

/* ------------------------------------------------------------------ money */

export function Money({
  paise,
  compact = false,
  exact = false,
  signed = false,
  tone = "auto",
  className,
}: {
  paise: number;
  compact?: boolean;
  exact?: boolean;
  signed?: boolean;
  /** "auto" colours negatives oxide; "plain" leaves everything ink. */
  tone?: "auto" | "plain" | "in" | "out";
  className?: string;
}) {
  const colour =
    tone === "in"
      ? "text-sap"
      : tone === "out"
        ? "text-oxide"
        : tone === "auto" && paise < 0
          ? "text-oxide"
          : "";
  return (
    <span
      className={cx("tnum", colour, className)}
      title={formatPaise(paise, true)}
    >
      {signed && paise > 0 ? "+" : ""}
      {compact ? formatCompact(paise) : formatPaise(paise, exact)}
    </span>
  );
}

/**
 * A headline figure: tiny tracked label above, the number set large in the
 * editorial serif. This is the page's typographic anchor.
 */
export function Figure({
  label,
  paise,
  note,
  size = "md",
  tone = "auto",
  compact = false,
  accent,
}: {
  label: string;
  paise: number;
  note?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: "auto" | "plain" | "in" | "out";
  compact?: boolean;
  accent?: string;
}) {
  const type = {
    sm: "text-[22px] leading-[1.1]",
    md: "text-[32px] leading-[1.05]",
    lg: "text-[clamp(2.6rem,5vw,4rem)] leading-[0.98]",
  }[size];

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {accent && (
          <span
            className="inline-block h-[9px] w-[2px] shrink-0"
            style={{ background: accent }}
            aria-hidden="true"
          />
        )}
        <Annot>{label}</Annot>
      </div>
      <div className={cx("font-serif mt-1.5", type)}>
        <Money paise={paise} tone={tone} compact={compact} />
      </div>
      {note && (
        <div className="mt-1.5 text-2xs leading-snug text-ink-3">{note}</div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- layout */

/** A ruled section with its label in the left gutter, the way a plan is keyed. */
export function Section({
  label,
  index,
  children,
  action,
  className,
}: {
  label: string;
  index?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("section", className)}>
      <div className="flex items-baseline justify-between gap-3 lg:block">
        <div>
          {index && (
            <div className="font-sans text-3xs tracking-annot text-ink-3">{index}</div>
          )}
          <h2 className="mt-0.5 font-serif text-[17px] leading-tight">{label}</h2>
        </div>
        {action && <div className="lg:hidden">{action}</div>}
        {action && <div className="mt-3 hidden lg:block">{action}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function PageTitle({
  children,
  sub,
  right,
}: {
  children: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 pb-6 pt-8">
      <div className="min-w-0">
        <h1 className="font-serif text-[clamp(1.75rem,3.4vw,2.4rem)] leading-[1.05]">
          {children}
        </h1>
        {sub && <div className="mt-2 max-w-measure text-ink-2">{sub}</div>}
      </div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- bars */

/** A ruled progress bar. Flat, square, with the fill drawn from the left. */
export function Bar({
  percent,
  colour = "var(--ink)",
  height = 6,
  over = false,
}: {
  percent: number;
  colour?: string;
  height?: number;
  over?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="w-full border border-rule bg-paper-2"
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full origin-left animate-draw"
        style={{
          width: `${clamped}%`,
          background: colour,
          // Past the line, the fill is hatched — a drawing convention, not a colour change.
          backgroundImage: over
            ? "repeating-linear-gradient(45deg, transparent 0 3px, rgba(239,238,233,.45) 3px 6px)"
            : undefined,
        }}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- tables */

/**
 * A ledger: hairline rows on paper, no outer box, no zebra. Column headings
 * are annotation caps.
 */
export function Ledger({
  children,
  min = 640,
  className,
}: {
  children: React.ReactNode;
  min?: number;
  className?: string;
}) {
  return (
    <div className={cx("-mx-1 overflow-x-auto px-1", className)}>
      <table
        className="w-full border-collapse text-left"
        style={{ minWidth: min }}
      >
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  right,
  className,
}: {
  children?: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <th
      className={cx(
        "annot whitespace-nowrap border-b border-rule pb-2 pt-0 font-medium",
        right ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  right,
  className,
}: {
  children?: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cx(
        "border-b border-rule-soft py-2.5 align-middle text-[13px]",
        right && "text-right tnum",
        className,
      )}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------------------ marks */

/** A small keyed mark — the area a row belongs to, or a state. */
export function Mark({
  children,
  colour,
  className,
}: {
  children: React.ReactNode;
  colour?: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-sans text-3xs uppercase tracking-annot",
        className,
      )}
      style={{ color: colour ?? "var(--ink-3)" }}
    >
      {colour && (
        <span
          className="inline-block h-[8px] w-[2px]"
          style={{ background: colour }}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- states */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx("animate-pulse bg-paper-2", className)}
      aria-hidden="true"
    />
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="border border-dashed border-rule px-6 py-10 text-center">
      <h3 className="font-serif text-[18px]">{title}</h3>
      <p className="mx-auto mt-2 max-w-[46ch] text-[13px] leading-relaxed text-ink-2">
        {body}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="border-l-2 border-oxide bg-paper-2 px-4 py-3">
      <Annot className="text-oxide">Could not load</Annot>
      <p className="mt-1.5 text-[13px] text-ink-2">{message}</p>
      {onRetry && (
        <button className="btn-quiet mt-3" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- toasts */

type Toast = { id: number; message: string; tone: "ok" | "error" | "info" };

const ToastContext = createContext<{
  push: (message: string, tone?: Toast["tone"]) => void;
}>({ push: () => {} });

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(
      () => setToasts((current) => current.filter((t) => t.id !== id)),
      4000,
    );
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="no-print pointer-events-none fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center gap-px"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-rise w-full border-t border-ink bg-paper px-5 py-3 text-center text-[13px]"
            style={{
              borderTopColor:
                toast.tone === "error" ? "var(--oxide)" : "var(--ink)",
            }}
          >
            <span className="mx-auto flex max-w-sheet items-center justify-center gap-2.5">
              <span
                className="inline-block h-[10px] w-[2px]"
                style={{
                  background:
                    toast.tone === "error" ? "var(--oxide)" : "var(--sap)",
                }}
              />
              {toast.message}
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------------ modal */

export function Modal({
  open,
  onClose,
  title,
  note,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  note?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4 sm:p-10">
      <div
        className="fixed inset-0 bg-ink/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "animate-rise relative my-auto w-full border border-ink bg-paper",
          wide ? "max-w-3xl" : "max-w-md",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
          <div>
            <h2 className="font-serif text-[19px] leading-tight">{title}</h2>
            {note && <p className="mt-1 text-2xs text-ink-3">{note}</p>}
          </div>
          <button
            onClick={onClose}
            className="-mr-1 px-1 text-lg leading-none text-ink-3 hover:text-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <Annot className="mb-1.5">{label}</Annot>
      {children}
      {hint && <span className="mt-1 block text-2xs text-ink-3">{hint}</span>}
    </label>
  );
}

/** A segmented control drawn as adjoining ruled cells. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  colourise = false,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  colourise?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("flex border border-rule", className)} role="group">
      {options.map((option, index) => {
        const active = option.value === value;
        const ink = colourise
          ? AREA_INK[option.value as Area] ?? "var(--ink)"
          : "var(--ink)";
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cx(
              "flex-1 whitespace-nowrap px-3 py-1.5 text-2xs uppercase tracking-annot transition-colors",
              index > 0 && "border-l border-rule",
              active ? "text-paper" : "text-ink-3 hover:text-ink",
            )}
            style={active ? { background: ink } : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
