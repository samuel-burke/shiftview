"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "sv_sidebar_expanded";
// Same-tab writes don't fire "storage", so setters announce changes with this.
const CHANGE_EVENT = "sv-sidebar-expanded";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

// Used when storage is unavailable (blocked by policy or private mode), so the
// toggle still works for the life of the page.
let fallback = false;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return fallback;
  }
}

/**
 * Whether the user widened the desk-size nav rail into the full sidebar.
 * Remembered per device. Always false on the server and during hydration, so
 * the server HTML (rail) matches the first client render.
 */
export function useSidebarExpanded(): [boolean, (expanded: boolean) => void] {
  const expanded = useSyncExternalStore(subscribe, read, () => false);
  const setExpanded = useCallback((value: boolean) => {
    fallback = value;
    try {
      if (value) localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
    } catch {
      // Not persisted; `fallback` keeps this page in sync.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [expanded, setExpanded];
}
