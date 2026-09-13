/**
 * The Spatial Anthology mark.
 *
 * The studio's actual artwork (public/logo-mark.png — the icon cropped from
 * public/spatial-anthology-logo.jpeg, wordmark trimmed since "Spatial /
 * Anthology" is already set live in type beside it). Fixed brand colours,
 * on a white ground, exactly as supplied — not re-themed per light/dark,
 * because it is an identity mark, not an interface element.
 */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/logo-mark.png"
      alt="Spatial Anthology"
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        display: "block",
        border: "1px solid var(--rule)",
      }}
    />
  );
}
