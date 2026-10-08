"use client";

import { useState, useEffect } from "react";
import { BREAKPOINTS } from "./useBreakpoint";

/*
 * True from the tablet size class up. Sheets and drawers use this to pick their
 * side-panel / centered-dialog variant instead of the phone's bottom sheet.
 */
export function useIsDesktop(breakpoint: number = BREAKPOINTS.tablet) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const check = () => setIsDesktop(mql.matches);
    check();
    mql.addEventListener("change", check);
    return () => mql.removeEventListener("change", check);
  }, [breakpoint]);

  return isDesktop;
}
