"use client";

import { useEffect, useRef } from "react";
import type { NavItem } from "./AppShell";

type Shortcut = { keys: string[]; action: string };

// Shortcuts that only exist on one page. Keep in sync with the pages' own
// keydown handlers (app/week/weekPageClient.tsx, app/requests/requestsPageClient.tsx).
const PAGE_SHORTCUTS: Partial<Record<NavItem, { title: string; shortcuts: Shortcut[] }>> = {
  week: {
    title: "Team week",
    shortcuts: [
      { keys: ["←", "→"], action: "Previous or next week" },
      { keys: ["T"], action: "Back to this week" },
    ],
  },
  requests: {
    title: "Requests",
    shortcuts: [
      { keys: ["↑", "↓"], action: "Move through the list" },
      { keys: ["A"], action: "Approve the selected request" },
      { keys: ["D"], action: "Deny the selected request" },
    ],
  },
};

const EVERYWHERE: Shortcut[] = [
  { keys: ["?"], action: "Show keyboard shortcuts" },
  { keys: ["Esc"], action: "Close a panel or dialog" },
];

function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

function Section({ title, shortcuts }: { title: string; shortcuts: Shortcut[] }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">{title}</h3>
      <dl className="flex flex-col gap-1.5">
        {shortcuts.map((s) => (
          <div key={s.action} className="flex items-center justify-between gap-4">
            <dt className="text-sm text-slate-200">{s.action}</dt>
            <dd className="flex gap-1 shrink-0">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="min-w-7 px-1.5 py-0.5 rounded-md border border-slate-700 border-b-2 bg-slate-800 text-center font-mono text-xs text-slate-100"
                >
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * "?" opens a list of the keyboard shortcuts for the current page and the ones
 * that work everywhere. Rendered once by AppShell; `open` is lifted there so a
 * sidebar button can open it too.
 */
export default function KeyboardShortcuts({
  active,
  open,
  onOpenChange,
}: {
  active: NavItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (open && e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || typingInField(e.target)) return;
      e.preventDefault();
      onOpenChange(!open);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Focus the dialog when it opens and hand focus back when it closes.
  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      closeRef.current?.focus();
    } else if (returnFocusRef.current) {
      returnFocusRef.current.focus?.();
      returnFocusRef.current = null;
    }
  }, [open]);

  if (!open) return null;
  const page = PAGE_SHORTCUTS[active];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-black/60" onClick={() => onOpenChange(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="relative w-full max-w-[420px] rounded-2xl border border-slate-800 bg-bg p-6 shadow-2xl flex flex-col gap-5"
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-lg font-extrabold text-slate-100">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="size-9 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {page && <Section title={page.title} shortcuts={page.shortcuts} />}
        <Section title="Everywhere" shortcuts={EVERYWHERE} />
      </div>
    </div>
  );
}
