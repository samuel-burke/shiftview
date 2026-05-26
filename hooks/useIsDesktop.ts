"use client";

import { useState, useEffect } from "react";

export function useIsDesktop(breakpoint = 900) {
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
