"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ResponsiveContainer, type ResponsiveContainerProps } from "recharts";

type Size = { width: number; height: number };

/**
 * A ResponsiveContainer that mounts only once its box has a size.
 *
 * Recharts starts every ResponsiveContainer at -1×-1 and measures in an effect,
 * so each mount (and any time the box is hidden) logs "The width(-1) and
 * height(-1) of chart should be greater than 0". Measuring here, before paint,
 * lets the chart mount at its real size. The box fills its parent, so the
 * parent's CSS still sets the chart's size.
 */
export default function SizedResponsiveContainer(props: ResponsiveContainerProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    function update(width: number, height: number) {
      const next = width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
      // Only re-render when the box gains or loses a size; recharts follows
      // ordinary resizes itself.
      setSize((prev) => (prev && next ? prev : next));
    }
    const rect = box.getBoundingClientRect();
    update(rect.width, rect.height);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} style={{ width: "100%", height: "100%" }}>
      {size && <ResponsiveContainer width="100%" height="100%" {...props} initialDimension={size} />}
    </div>
  );
}
