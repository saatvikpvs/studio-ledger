/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    // Nothing is rounded. A drawing has corners.
    borderRadius: { none: "0", DEFAULT: "0", sm: "1px", md: "2px", full: "9999px" },
    extend: {
      colors: {
        paper: "var(--paper)",
        "paper-2": "var(--paper-2)",
        "paper-3": "var(--paper-3)",
        rule: "var(--rule)",
        "rule-soft": "var(--rule-soft)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        graphite: "var(--graphite)",
        blueprint: "var(--blueprint)",
        patina: "var(--patina)",
        oxide: "var(--oxide)",
        sap: "var(--sap)",
        ochre: "var(--ochre)",
      },
      fontFamily: {
        // Editorial display: the wordmark, section titles, headline figures.
        serif: ["Instrument Serif", "Georgia", "Times New Roman", "serif"],
        // Everything operational: data, controls, annotation caps.
        sans: ["Archivo", "Helvetica Neue", "Arial", "sans-serif"],
      },
      fontSize: {
        "3xs": ["0.625rem", { lineHeight: "0.875rem" }],
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      letterSpacing: {
        annot: "0.16em",
        wordmark: "0.28em",
      },
      maxWidth: { measure: "68ch", sheet: "1320px" },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(3px)" }, to: { opacity: "1", transform: "none" } },
        draw: { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
      },
      animation: {
        rise: "rise 160ms ease-out",
        draw: "draw 600ms cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};
