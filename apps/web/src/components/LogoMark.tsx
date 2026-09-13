/**
 * The Spatial Anthology mark.
 *
 * A solid tile rather than overlapping glyphs on the bare page: a fixed ink
 * fill with the initials reversed out in paper colour. A filled chip
 * guarantees legible contrast against either theme's ground on its own
 * terms, instead of depending on two overlapping letterforms to read clearly
 * at 26px. Aubergine and Rust are reserved for the interface — buttons,
 * active states, focus, delete — the mark itself stays neutral ink/paper so
 * it reads as identity, not as one more interactive element.
 */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <rect x="0" y="0" width="100" height="100" fill="var(--ink)" />
      <text
        x="50"
        y="63"
        textAnchor="middle"
        fontFamily="Archivo, sans-serif"
        fontWeight="600"
        fontSize="46"
        letterSpacing="-1"
        fill="var(--paper)"
      >
        SA
      </text>
    </svg>
  );
}
