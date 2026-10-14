// Theme colors for inline styles. Components pass semantic CSS variables
// ("var(--status-ok)", SHIFT_COLORS.opener…) rather than hex; app/globals.css
// defines each one for both themes.

/**
 * The mark twin of a theme color: var(--x) → var(--x-mark, var(--x)). Light
 * mode draws text in a darker shade than marks and tints (see the -mark
 * tokens in app/globals.css); dark mode's are the same. Anything that isn't a
 * single var() (a position's own hex, say) comes back unchanged.
 */
export function markColor(color: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color.trim());
  return m ? `var(${m[1]}-mark, var(${m[1]}))` : color;
}

/** A translucent tint of a theme color, mixed from its mark twin. */
export function tint(color: string, percent: number, over = "transparent"): string {
  // oklab, as Tailwind's own opacity modifiers: several palette colors sit
  // outside sRGB, and an sRGB mix of them fringes on anti-aliased edges.
  return `color-mix(in oklab, ${markColor(color)} ${percent}%, ${over})`;
}

/** Recharts tooltip box, themed by the chart tokens in app/globals.css. */
export const CHART_TOOLTIP_STYLE = {
  background: "var(--chart-tooltip-bg)",
  border: "1px solid var(--chart-tooltip-border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--chart-tooltip-fg)",
} as const;
