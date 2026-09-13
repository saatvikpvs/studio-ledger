import { formatCompact, formatPaise } from "../lib/money";
import { AREA_INK, Annot, cx, type Area } from "./ui";

export interface Band {
  area: Area;
  label: string;
  amount: number;
  href?: string;
}

/**
 * A section through the money.
 *
 * One bank balance, cut open to show what it is made of. Each band is poché —
 * hatched in its area's ink, the way cut material is filled on a section — with
 * a dimension string beneath carrying the figures. It replaces four KPI tiles
 * and a pie chart with one drawing that states the model outright: these bands
 * are the bank balance, exactly, always.
 */
export default function SectionBar({
  bands,
  total,
  height = 58,
}: {
  bands: Band[];
  total: number;
  height?: number;
}) {
  const positive = bands.filter((band) => band.amount > 0);
  const negative = bands.filter((band) => band.amount < 0);
  const spread = positive.reduce((sum, band) => sum + band.amount, 0) || 1;

  if (!positive.length) {
    return (
      <div className="border border-dashed border-rule px-5 py-8 text-center">
        <p className="text-[13px] text-ink-2">
          Nothing recorded yet. Set your opening balance or record your first
          entry and this section fills in.
        </p>
      </div>
    );
  }

  return (
    <figure className="m-0">
      {/* --- the cut ------------------------------------------------------ */}
      <div
        className="flex w-full border border-ink"
        style={{ height }}
        role="img"
        aria-label={`${formatPaise(total)} divided across ${positive
          .map((b) => `${b.label} ${formatPaise(b.amount)}`)
          .join(", ")}`}
      >
        {positive.map((band, index) => {
          const ink = AREA_INK[band.area];
          const share = (band.amount / spread) * 100;
          return (
            <div
              key={band.label}
              className={cx(
                "relative origin-left animate-draw",
                index > 0 && "border-l border-ink",
              )}
              style={{
                width: `${share}%`,
                // Poché: hatched fill in the area's ink, not a flat block.
                backgroundImage: `repeating-linear-gradient(45deg, ${ink} 0 1.5px, transparent 1.5px 6px)`,
                backgroundColor: "transparent",
                opacity: 0.9,
              }}
              title={`${band.label} — ${formatPaise(band.amount)}`}
            >
              <span
                className="absolute inset-x-0 top-0 block h-[3px]"
                style={{ background: ink }}
              />
            </div>
          );
        })}
      </div>

      {/* --- dimension string --------------------------------------------- */}
      <div className="flex w-full">
        {positive.map((band) => {
          const ink = AREA_INK[band.area];
          const share = (band.amount / spread) * 100;
          return (
            <div
              key={band.label}
              className="min-w-0 pr-3"
              style={{ width: `${share}%` }}
            >
              {/* tick, rule, tick — a dimension line */}
              <div className="relative h-3">
                <span className="absolute left-0 top-0 h-2 w-px bg-rule" />
                <span className="absolute left-0 right-3 top-[7px] h-px bg-rule" />
                <span className="absolute right-3 top-0 h-2 w-px bg-rule" />
              </div>
              <div className="annot truncate" style={{ color: ink }}>
                {band.label}
              </div>
              <div className="mt-0.5 truncate font-serif text-[17px] leading-tight">
                {share < 9 ? formatCompact(band.amount) : formatPaise(band.amount)}
              </div>
              <div className="text-3xs text-ink-3 tnum">
                {Math.round(share)}%
              </div>
            </div>
          );
        })}
      </div>

      {negative.length > 0 && (
        <figcaption className="mt-4 border-l-2 border-oxide pl-3 text-2xs leading-relaxed text-ink-2">
          {negative.map((band) => (
            <div key={band.label}>
              <span className="text-oxide">{band.label}</span> is short{" "}
              <span className="tnum">{formatPaise(Math.abs(band.amount))}</span> —
              it has been covered by another area.
            </div>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
