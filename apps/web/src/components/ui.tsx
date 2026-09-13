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

/* ------------------------------------------------------------------ money */

export function Money({
  paise,
  compact = false,
  exact = false,
  signed = false,
  className,
}: {
  paise: number;
  compact?: boolean;
  exact?: boolean;
  signed?: boolean;
  className?: string;
}) {
  const tone = paise < 0 ? "text-neg" : signed && paise > 0 ? "text-pos" : "";
  const prefix = signed && paise > 0 ? "+" : "";
  return (
    <span
      className={cx("tabular", tone, className)}
      title={formatPaise(paise, true)}
    >
      {prefix}
      {compact ? formatCompact(paise) : formatPaise(paise, exact)}
    </span>
  );
}

/* ------------------------------------------------------------------ layout */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={cx("card", padded && "p-5", className)}>{children}</div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 mb-3">
      <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-ink-3 mt-1 text-[13px]">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

/* --------------------------------------------------------------------- kpi */

export function KpiTile({
  label,
  value,
  hint,
  tone = "neutral",
  compact = false,
  footer,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "neutral" | "accent" | "pos" | "neg" | "warn";
  compact?: boolean;
  footer?: React.ReactNode;
}) {
  const toneClass = {
    neutral: "text-ink",
    accent: "text-accent",
    pos: "text-pos",
    neg: "text-neg",
    warn: "text-warn",
  }[tone];

  return (
    <div className="card p-4 flex flex-col gap-1">
      <div className="label">{label}</div>
      <div className={cx("text-[22px] font-semibold tracking-tight", toneClass)}>
        <Money paise={value} compact={compact} />
      </div>
      {hint && <div className="text-2xs text-ink-3 leading-snug">{hint}</div>}
      {footer}
    </div>
  );
}

/* ------------------------------------------------------------------- chips */

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "pos" | "neg" | "warn";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2 border-line",
    accent: "bg-accent-soft text-accent border-accent/30",
    pos: "bg-pos-soft text-pos border-pos/30",
    neg: "bg-neg-soft text-neg border-neg/30",
    warn: "bg-warn-soft text-warn border-warn/30",
  }[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5",
        "font-mono text-2xs uppercase tracking-[0.08em] whitespace-nowrap",
        tones,
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- progress */

export function ProgressBar({
  percent,
  tone = "accent",
  height = 8,
}: {
  percent: number;
  tone?: "accent" | "pos" | "warn" | "neg";
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const over = percent > 100;
  const colour = { accent: "bg-accent", pos: "bg-pos", warn: "bg-warn", neg: "bg-neg" }[
    tone
  ];
  return (
    <div
      className="w-full rounded-full bg-surface-2 border border-line-soft overflow-hidden"
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cx("h-full rounded-full transition-[width] duration-500", colour)}
        style={{
          width: `${clamped}%`,
          // Overspend gets a hatched tail so it reads as "past the line".
          backgroundImage: over
            ? "repeating-linear-gradient(45deg, transparent, transparent 4px, rgb(255 255 255 / 0.28) 4px, rgb(255 255 255 / 0.28) 8px)"
            : undefined,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ states */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx("animate-pulse rounded bg-surface-2", className)}
      aria-hidden="true"
    />
  );
}

export function LoadingCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[92px]" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
  icon,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="card p-10 text-center">
      {icon && <div className="mb-3 flex justify-center text-ink-3">{icon}</div>}
      <h3 className="font-semibold text-[15px]">{title}</h3>
      <p className="text-ink-3 mt-1.5 text-[13px] max-w-md mx-auto leading-relaxed">
        {message}
      </p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="card border-neg/40 bg-neg-soft/40 p-6">
      <h3 className="font-semibold text-[15px] text-neg">Could not load this</h3>
      <p className="text-ink-2 mt-1.5 text-[13px]">{message}</p>
      {onRetry && (
        <button className="btn-ghost mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ toasts */

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
      4200,
    );
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-[min(360px,calc(100vw-2.5rem))]"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              "animate-slide rounded-lg border px-4 py-3 text-[13px] shadow-pop bg-surface",
              toast.tone === "ok" && "border-pos/40 text-ink",
              toast.tone === "error" && "border-neg/50 text-ink",
              toast.tone === "info" && "border-line text-ink",
            )}
          >
            <div className="flex gap-2.5">
              <span
                className={cx(
                  "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                  toast.tone === "ok" && "bg-pos",
                  toast.tone === "error" && "bg-neg",
                  toast.tone === "info" && "bg-accent",
                )}
              />
              <span className="leading-snug">{toast.message}</span>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------------ dialog */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
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
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-ink/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "relative card shadow-pop animate-in w-full my-auto",
          wide ? "max-w-4xl" : "max-w-lg",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft p-5">
          <div>
            <h2 className="font-semibold tracking-tight">{title}</h2>
            {description && (
              <p className="text-ink-3 mt-1 text-[13px]">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink text-lg leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- forms */

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
      <span className="label block mb-1.5">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-2xs text-ink-3">{hint}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------- table */

export function TableShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("card overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse">{children}</table>
    </div>
  );
}

export function Th({
  children,
  right = false,
  className,
}: {
  children?: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <th
      className={cx(
        "label border-b border-line bg-surface-2 px-3 py-2 font-medium whitespace-nowrap",
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
  right = false,
  className,
}: {
  children?: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cx(
        "border-b border-line-soft px-3 py-2.5 align-middle text-[13px]",
        right && "text-right tabular",
        className,
      )}
    >
      {children}
    </td>
  );
}
