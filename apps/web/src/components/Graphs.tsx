import { axisTick, formatMonth, formatPaise } from "../lib/money";
import type { CategorySlice, MonthlyFlow } from "../lib/types";
import { Annot, Money, cx } from "./ui";

/**
 * Two drawings, both hand-set rather than pulled from a charting library.
 *
 * A chart library would give this page rounded bars, a legend, a grid and a
 * default palette — the exact generic look this interface is built to avoid.
 * These are simple enough to draw as ruled elements, so they match the rest of
 * the sheet and cost nothing to load.
 */

/** Spend by category: a ruled list, sorted, with the figure on the line. */
export function CategoryRules({
  data,
  limit = 12,
  accent = "var(--ink)",
}: {
  data: CategorySlice[];
  limit?: number;
  accent?: string;
}) {
  const rows = data.slice(0, limit);
  const max = Math.max(...rows.map((row) => row.amount), 1);
  const total = data.reduce((sum, row) => sum + row.amount, 0);

  if (!rows.length) {
    return (
      <p className="py-6 text-[13px] text-ink-3">
        Nothing spent in this period yet.
      </p>
    );
  }

  return (
    <div>
      {rows.map((row) => (
        <div key={row.category} className="border-b border-rule-soft py-2">
          <div className="flex items-baseline justify-between gap-4">
            <span className="truncate text-[13px]">{row.category}</span>
            <span className="flex shrink-0 items-baseline gap-3">
              <span className="text-3xs tnum text-ink-3">
                {Math.round((row.amount / (total || 1)) * 100)}%
              </span>
              <Money paise={row.amount} className="text-[13px]" />
            </span>
          </div>
          <div className="mt-1.5 h-[3px] w-full bg-paper-2">
            <div
              className="h-full origin-left animate-draw"
              style={{
                width: `${(row.amount / max) * 100}%`,
                background: row.colour || accent,
              }}
            />
          </div>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 pt-2.5">
        <Annot>Total</Annot>
        <Money paise={total} className="font-serif text-[17px]" />
      </div>
    </div>
  );
}

/**
 * Money in and out by month, drawn as a pair of columns on a baseline.
 * Received rises above the rule, spent falls below it — a section, not a chart.
 */
export function MonthStrip({
  data,
  months = 6,
  accent = "var(--ink)",
}: {
  data: MonthlyFlow[];
  months?: number;
  accent?: string;
}) {
  const rows = data.slice(-months);
  const peak = Math.max(
    ...rows.map((row) => Math.max(row.cash_in, row.cash_out)),
    1,
  );

  if (!rows.some((row) => row.cash_in || row.cash_out)) {
    return (
      <p className="py-6 text-[13px] text-ink-3">
        Not enough months recorded yet to draw a trend.
      </p>
    );
  }

  return (
    <figure className="m-0">
      <div className="flex items-stretch gap-px">
        {rows.map((row) => (
          <div key={row.month} className="flex min-w-0 flex-1 flex-col">
            {/* above the rule: received */}
            <div className="flex h-[46px] items-end justify-center px-1">
              <div
                className="w-full max-w-[26px] origin-bottom"
                style={{
                  height: `${(row.cash_in / peak) * 100}%`,
                  background: "var(--sap)",
                }}
                title={`In ${formatPaise(row.cash_in)}`}
              />
            </div>
            <div className="h-px bg-ink" />
            {/* below the rule: spent */}
            <div className="flex h-[46px] items-start justify-center px-1">
              <div
                className="w-full max-w-[26px] origin-top"
                style={{
                  height: `${(row.cash_out / peak) * 100}%`,
                  background: "var(--oxide)",
                }}
                title={`Out ${formatPaise(row.cash_out)}`}
              />
            </div>
            <div className="mt-1.5 truncate text-center text-3xs uppercase tracking-annot text-ink-3">
              {formatMonth(row.month)}
            </div>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-rule-soft pt-2.5">
        <Legend colour="var(--sap)" label="Received" />
        <Legend colour="var(--oxide)" label="Spent" />
        <span className="ml-auto text-3xs tnum text-ink-3">
          peak {axisTick(peak)}
        </span>
      </figcaption>
    </figure>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-3xs uppercase tracking-annot text-ink-3">
      <span className="inline-block h-[8px] w-[2px]" style={{ background: colour }} />
      {label}
    </span>
  );
}

/** A goal's progress: a ruled bar with the target marked on it. */
export function GoalRule({
  balance,
  target,
  colour = "var(--patina)",
}: {
  balance: number;
  target: number;
  colour?: string;
}) {
  const percent = target ? Math.min(100, (balance / target) * 100) : 0;
  return (
    <div className="relative h-[10px] w-full border border-rule bg-paper-2">
      <div
        className="h-full origin-left animate-draw"
        style={{ width: `${percent}%`, background: colour }}
      />
      {target > 0 && (
        <span
          className="absolute -top-1 bottom-[-4px] right-0 w-px bg-ink"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
