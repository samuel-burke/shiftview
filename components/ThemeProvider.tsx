"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

function resolvedScheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function applyTheme(mode: ThemeMode) {
  const scheme = resolvedScheme(mode);
  document.documentElement.setAttribute("data-theme", scheme);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  // The browser chrome matches the page: the theme's --color-bg (app/globals.css).
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim() || meta.content;
}

const ThemeContext = createContext<{
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}>({ mode: "system", setMode: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    const stored = (localStorage.getItem("theme") as ThemeMode | null) ?? "system";
    setModeState(stored);
    applyTheme(stored);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onSystemChange() {
      if ((localStorage.getItem("theme") ?? "system") === "system") applyTheme("system");
    }
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, []);

  function setMode(m: ThemeMode) {
    setModeState(m);
    localStorage.setItem("theme", m);
    applyTheme(m);
  }

  return (
    <ThemeContext.Provider value={{ mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}
