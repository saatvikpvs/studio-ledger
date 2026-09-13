/**
 * Money formatting. Paise in, Indian-grouped string out.
 *
 * This is the only place Intl.NumberFormat is configured, so grouping is the
 * Indian convention everywhere: 5,00,000 rather than 500,000.
 */

const FULL = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const WHOLE = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const PLAIN = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Exact figure, e.g. "₹5,00,000.00". */
export function formatPaise(paise: number, showPaise = false): string {
  const rupees = paise / 100;
  return (showPaise ? FULL : WHOLE).format(rupees);
}

/** Short form for tight tiles and chart axes: "₹2.15L", "₹1.2Cr". */
export function formatCompact(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const n = Math.abs(paise);
  if (n >= 1_00_00_000_00) return `${sign}₹${PLAIN.format(round(n / 1_00_00_000_00))}Cr`;
  if (n >= 1_00_000_00) return `${sign}₹${PLAIN.format(round(n / 1_00_000_00))}L`;
  if (n >= 1_000_00) return `${sign}₹${PLAIN.format(round(n / 1_000_00))}K`;
  return `${sign}₹${PLAIN.format(n / 100)}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Axis ticks: no currency symbol, just the magnitude. */
export function axisTick(paise: number): string {
  const n = Math.abs(paise);
  if (n >= 1_00_00_000_00) return `${round(paise / 1_00_00_000_00)}Cr`;
  if (n >= 1_00_000_00) return `${round(paise / 1_00_000_00)}L`;
  if (n >= 1_000_00) return `${round(paise / 1_000_00)}K`;
  return String(paise / 100);
}

/**
 * Parse what someone types into a rupee field. Accepts "5,00,000", "500000.50",
 * "₹ 5000". Returns paise, or null when it isn't a number.
 */
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "").trim();
  if (!cleaned || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function paiseToRupeeInput(paise: number): string {
  return (paise / 100).toFixed(2).replace(/\.00$/, "");
}

export function formatDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function formatMonth(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", { month: "short" });
}

/** "vendor_payment" -> "Vendor payment" */
export function humanise(value: string | null | undefined): string {
  if (!value) return "";
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
