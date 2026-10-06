"use client";

import { useState, useEffect } from "react";

/*
 * Size-class thresholds in px. Mirrors the --breakpoint-* tokens in
 * app/globals.css — keep the two in sync. Layout itself should use the CSS
 * variants (tablet:, desk:, wide:) so the server-rendered HTML is already
 * correct; this hook is for behavior only (drag vs. no drag, sheet vs. panel).
 */
export const BREAKPOINTS = {
  tablet: 600,
  desk: 1024,
  wide: 1440,
} as const;

export type SizeClass = "compact" | "tablet" | "desk" | "wide";

export function sizeClassFor(width: number): SizeClass {
  if (width >= BREAKPOINTS.wide) return "wide";
  if (width >= BREAKPOINTS.desk) return "desk";
  if (width >= BREAKPOINTS.tablet) return "tablet";
  return "compact";
}

const QUERIES = (["wide", "desk", "tablet"] as const).map(
  (name) => [name, `(min-width: ${BREAKPOINTS[name]}px)`] as const,
);

/** Current size class. Starts as "compact" on the server and first render. */
export function useBreakpoint(): SizeClass {
  const [size, setSize] = useState<SizeClass>("compact");

  useEffect(() => {
    const mqls = QUERIES.map(([name, q]) => [name, window.matchMedia(q)] as const);
    const check = () => setSize(mqls.find(([, m]) => m.matches)?.[0] ?? "compact");
    check();
    mqls.forEach(([, m]) => m.addEventListener("change", check));
    return () => mqls.forEach(([, m]) => m.removeEventListener("change", check));
  }, []);

  return size;
}
