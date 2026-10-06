"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Height for a chart that should keep a width:height ratio as its container
 * grows, clamped to [min, max]. A fixed height turns a chart into a thin strip
 * on wide screens; a pure aspect ratio makes it too short on phones.
 *
 * Returns a ref for the element whose width drives the height, and the height.
 * Starts at `min` (the phone size) so the first render matches the server.
 */
export function useAspectHeight<T extends HTMLElement = HTMLDivElement>({
  aspect,
  min,
  max,
}: {
  aspect: number;
  min: number;
  max: number;
}) {
  const [height, setHeight] = useState(min);
  const roRef = useRef<ResizeObserver | null>(null);

  const compute = useCallback(
    (width: number) => setHeight(Math.round(Math.min(max, Math.max(min, width / aspect)))),
    [aspect, min, max],
  );

  const ref = useCallback(
    (el: T | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      if (!el) return;
      compute(el.getBoundingClientRect().width);
      const ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width;
        if (w) compute(w);
      });
      ro.observe(el);
      roRef.current = ro;
    },
    [compute],
  );

  useEffect(() => () => roRef.current?.disconnect(), []);

  return [ref, height] as const;
}
