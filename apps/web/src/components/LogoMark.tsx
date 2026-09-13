/**
 * The Spatial Anthology mark.
 *
 * A type-based monogram rather than a hand-traced icon: real letterforms in
 * the app's own faces, coloured from the same ink/ink-3/oxide tokens as
 * everything else, so it inverts correctly in dark mode instead of shipping
 * as a fixed-colour raster that would fight the theme.
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
      <text
        x="4"
        y="76"
        fontFamily="Archivo, sans-serif"
        fontWeight="600"
        fontSize="74"
        fill="var(--ink)"
      >
        S
      </text>
      <text
        x="38"
        y="80"
        fontFamily="Archivo, sans-serif"
        fontWeight="600"
        fontSize="70"
        fill="var(--ink-3)"
      >
        A
      </text>
      <rect x="47" y="62" width="9" height="9" fill="var(--oxide)" />
    </svg>
  );
}
