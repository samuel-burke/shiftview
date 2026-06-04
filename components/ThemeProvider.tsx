"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const THEME_META_COLORS: Record<"light" | "dark", string> = {
  dark: "#0a1628",
  light: "#f1f5f9",
};

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
  if (meta) meta.content = THEME_META_COLORS[scheme];
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
