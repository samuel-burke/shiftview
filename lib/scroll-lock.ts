"use client";

import { useEffect } from "react";

// Locks the page's scroll while a modal sheet or drawer is open. Counted, so a
// second overlay (the time card over the employee drawer) closing doesn't
// unlock the page under the first. The page keeps its width while locked:
// <html> reserves the scrollbar's gutter (scrollbar-gutter in globals.css), so
// hiding the scrollbar doesn't slide the content sideways.
let locks = 0;

export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (locks++ === 0) document.body.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) document.body.style.overflow = "";
  };
}

/** Locks the page's scroll while `active`. */
export function useScrollLock(active: boolean) {
  useEffect(() => (active ? lockScroll() : undefined), [active]);
}
