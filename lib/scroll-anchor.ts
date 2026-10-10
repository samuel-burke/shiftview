"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

// Keeps what the reader is looking at where it is when an update they didn't
// ask for (a realtime change, a background refresh) adds, removes or resizes
// content above it.
//
// Call the returned `preserve()` right before applying such an update. It
// notes the first anchor (an element with data-scroll-anchor) at the top of
// the visible area; after React commits the update, the page scrolls by
// however far that anchor moved, so it stays put on screen. Nothing happens at the very top of the page (new content
// there is meant to be seen) or where the browser already does this itself
// (CSS scroll anchoring: Chrome, Firefox, Edge — not Safari).

export const nativeAnchoring =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("overflow-anchor", "auto");

type Pending = { key: string; top: number };

export function useScrollAnchor() {
  const pending = useRef<Pending | null>(null);

  // After every commit of the calling component: put the anchor back.
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const el = document.querySelector<HTMLElement>(`[data-scroll-anchor="${p.key.replace(/["\\]/g, "\\$&")}"]`);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - p.top;
    if (Math.abs(delta) < 1) return;
    window.scrollBy(0, delta);
  });

  return useCallback(() => {
    if (nativeAnchoring || window.scrollY <= 0) return;
    // The top of the visible area: the bottom of the page's sticky header
    // (data-sticky-header), if one is showing.
    const header = document.querySelector<HTMLElement>("[data-sticky-header]");
    const top = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
    const anchors = document.querySelectorAll<HTMLElement>("[data-scroll-anchor]");
    for (const el of anchors) {
      const r = el.getBoundingClientRect();
      // The first one that starts in view.
      if (r.height > 0 && r.top >= top) {
        pending.current = { key: el.dataset.scrollAnchor!, top: r.top };
        return;
      }
    }
  }, []);
}
