import {
  Area,
  AreaChart,
  Bar,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { axisTick, formatDateShort, formatMonth, formatPaise } from "../lib/money";
import type { BalancePoint, CategorySlice, FundSlice, MonthlyFlow } from "../lib/types";
import { Money, cx } from "./ui";

/** Read a CSS token at render time so charts follow the theme. */
const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
  "#888888";

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[];
  label?: string;
  labelFormatter?: (value: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-pop">
      {label !== undefined && (
        <div className="label mb-1.5">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 text-[12px]"
          >
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: entry.color }}
              />
              <span className="text-ink-2">{entry.name}</span>
            </span>
            <Money paise={Number(entry.value ?? 0)} exact className="font-medium" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------- cash in vs out by month */

export function CashFlowChart({ data }: { data: MonthlyFlow[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <XAxis
          dataKey="month"
          tickFormatter={formatMonth}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={axisTick}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          content={<ChartTooltip labelFormatter={formatMonth} />}
          cursor={{ fill: token("--surface-2"), opacity: 0.55 }}
        />
        <ReferenceLine y={0} stroke={token("--line")} />
        <Bar dataKey="cash_in" name="Cash in" fill={token("--pos")} radius={[2, 2, 0, 0]} />
        <Bar dataKey="cash_out" name="Cash out" fill={token("--neg")} radius={[2, 2, 0, 0]} />
        <Line
          type="monotone"
          dataKey="net"
          name="Net"
          stroke={token("--accent")}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------- running balance */

export function BalanceTrendChart({ data }: { data: BalancePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={token("--accent")} stopOpacity={0.28} />
            <stop offset="100%" stopColor={token("--accent")} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tickFormatter={formatDateShort}
          axisLine={false}
          tickLine={false}
          minTickGap={48}
        />
        <YAxis
          tickFormatter={axisTick}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          content={<ChartTooltip labelFormatter={(v) => formatDateShort(v)} />}
        />
        <Area
          type="monotone"
          dataKey="balance"
          name="Bank balance"
          stroke={token("--accent")}
          strokeWidth={2}
          fill="url(#balanceFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------ category spend, sorted, bars */

export function CategoryBars({
  data,
  limit = 10,
}: {
  data: CategorySlice[];
  limit?: number;
}) {
  const rows = data.slice(0, limit);
  const max = Math.max(...rows.map((r) => r.amount), 1);

  if (!rows.length) {
    return (
      <p className="py-8 text-center text-[13px] text-ink-3">
        Nothing spent in this period yet.
      </p>
    );
  }

  // Horizontal bars beat a pie here: readable labels, exact values, sorted.
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.category}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[12px]">
            <span className="truncate text-ink-2">{row.category}</span>
            <Money paise={row.amount} className="shrink-0 font-medium" />
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${(row.amount / max) * 100}%`,
                background: row.colour,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------- personal spend, donut */

export function CategoryDonut({ data }: { data: CategorySlice[] }) {
  const rows = data.slice(0, 8);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  if (!total) {
    return (
      <p className="py-8 text-center text-[13px] text-ink-3">
        No personal spending recorded yet.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="amount"
              nameKey="category"
              innerRadius={58}
              outerRadius={86}
              paddingAngle={2}
              stroke="none"
            >
              {rows.map((row) => (
                <Cell key={row.category} fill={row.colour} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="label">Total</div>
          <Money paise={total} compact className="text-[15px] font-semibold" />
        </div>
      </div>
      <ul className="min-w-[180px] flex-1 space-y-1.5">
        {rows.map((row) => (
          <li
            key={row.category}
            className="flex items-center justify-between gap-3 text-[12px]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ background: row.colour }}
              />
              <span className="truncate text-ink-2">{row.category}</span>
            </span>
            <span className="shrink-0 tabular text-ink-3">
              {Math.round((row.amount / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------- how the bank balance divides by fund */

export function FundAllocationBar({ data }: { data: FundSlice[] }) {
  const positive = data.filter((d) => d.balance > 0);
  const negative = data.filter((d) => d.balance < 0);
  const total = positive.reduce((sum, d) => sum + d.balance, 0);

  const colourFor = (kind: string, index: number) => {
    if (kind === "personal") return token("--ink-3");
    if (kind === "unassigned") return token("--warn");
    const shades = ["--accent", "--pos", "--warn"];
    return token(shades[index % shades.length]);
  };

  if (!total) {
    return <p className="text-[13px] text-ink-3">No funds hold money yet.</p>;
  }

  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-md border border-line">
        {positive.map((slice, index) => (
          <div
            key={slice.fund_id}
            className="group relative transition-opacity hover:opacity-85"
            style={{
              width: `${(slice.balance / total) * 100}%`,
              background: colourFor(slice.kind, index),
            }}
            title={`${slice.name} — ${formatPaise(slice.balance)}`}
          />
        ))}
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {[...positive, ...negative].map((slice, index) => (
          <li
            key={slice.fund_id}
            className="flex items-center justify-between gap-3 text-[12px]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{
                  background:
                    slice.balance < 0 ? token("--neg") : colourFor(slice.kind, index),
                }}
              />
              <span className="truncate text-ink-2">{slice.name}</span>
            </span>
            <Money paise={slice.balance} className="shrink-0 font-medium" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------- budget vs actual, bullet chart */

export function BulletBar({
  spent,
  received,
  budget,
}: {
  spent: number;
  received: number;
  budget: number;
}) {
  const scale = Math.max(spent, received, budget, 1);
  const pct = (value: number) => `${Math.min(100, (value / scale) * 100)}%`;
  const over = budget > 0 && spent > budget;

  return (
    <div className="relative h-5 w-full rounded bg-surface-2 border border-line-soft">
      {/* received = the money actually available */}
      <div
        className="absolute inset-y-0 left-0 rounded-l bg-accent/20"
        style={{ width: pct(received) }}
      />
      {/* spent = the actual bar */}
      <div
        className={cx(
          "absolute inset-y-[5px] left-0 rounded-sm",
          over ? "bg-neg" : "bg-accent",
        )}
        style={{ width: pct(spent) }}
      />
      {/* budget = the target marker */}
      {budget > 0 && (
        <div
          className="absolute inset-y-0 w-[2px] bg-ink"
          style={{ left: pct(budget) }}
          title={`Budget ${formatPaise(budget)}`}
        />
      )}
    </div>
  );
}
