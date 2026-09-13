import { axisTick, formatCompact, formatMonth, formatPaise } from "../lib/money";
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

/**
 * The ring at the top of Overview: total money, cut into Personal /
 * Professional / Savings (and Unfiled, if anything sits there) as arcs with
 * a percentage each, hand-drawn with stroke-dasharray rather than pulled from
 * a charting library — consistent with every other drawing in this app, and
 * the one visualisation the brief asked for by name: a ring with clean
 * percentage indicators, legible at a glance.
 */
export interface DonutSlice {
  label: string;
  amount: number;
  colour: string;
}

export function AreaDonut({
  slices,
  total,
  size = 220,
}: {
  slices: DonutSlice[];
  total: number;
  size?: number;
}) {
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  const positive = slices.filter((s) => s.amount > 0);
  const sum = positive.reduce((s, slice) => s + slice.amount, 0) || 1;

  let offset = 0;
  const arcs = positive.map((slice) => {
    const fraction = slice.amount / sum;
    const length = fraction * circumference;
    const dasharray = `${length} ${circumference - length}`;
    const dashoffset = -offset;
    offset += length;
    return { ...slice, fraction, dasharray, dashoffset };
  });

  return (
    <div className="flex flex-wrap items-center gap-8">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          viewBox="0 0 180 180"
          width={size}
          height={size}
          role="img"
          aria-label={`Total ${formatPaise(total)}, divided across ${positive
            .map((s) => `${s.label} ${Math.round((s.amount / sum) * 100)} percent`)
            .join(", ")}`}
        >
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke="var(--rule)"
            strokeWidth="20"
          />
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx="90"
              cy="90"
              r={radius}
              fill="none"
              stroke={arc.colour}
              strokeWidth="20"
              strokeDasharray={arc.dasharray}
              strokeDashoffset={arc.dashoffset}
              strokeLinecap={arc.fraction < 0.02 ? "round" : "butt"}
              transform="rotate(-90 90 90)"
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="annot">Total</span>
          <span className="mt-1 font-serif text-[22px] leading-none">
            {formatCompact(total)}
          </span>
        </div>
      </div>

      <ul className="min-w-[200px] flex-1 space-y-3">
        {slices.map((slice) => {
          const percent = Math.round((slice.amount / sum) * 100);
          return (
            <li key={slice.label} className="flex items-baseline justify-between gap-4">
              <span className="flex min-w-0 items-baseline gap-2.5">
                <span
                  className="inline-block h-[10px] w-[10px] shrink-0"
                  style={{ background: slice.colour }}
                  aria-hidden="true"
                />
                <span className="truncate text-[14px]">{slice.label}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-3">
                <Money paise={slice.amount} className="text-[14px]" />
                <span className="w-10 text-right text-2xs tnum text-ink-3">
                  {slice.amount > 0 ? `${percent}%` : "—"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
