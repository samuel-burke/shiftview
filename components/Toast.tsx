"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// Page-level messages — a failed load, a failed action, a published week — in
// a layer of their own, fixed over the content, so one showing up or going
// away never pushes the page. Phones stack them above the bottom tabs; larger
// screens at the bottom of the window. Above sheets and drawers too, so an
// action that fails inside one is still seen. Portaled to <body>: a sheet's
// transform would otherwise become the fixed position's frame.

type Tone = "error" | "warning" | "success";

const TONES: Record<Tone, string> = {
  error: "bg-red-500/10 border-red-500/25 text-red-400",
  warning: "bg-amber-500/10 border-amber-500/25 text-amber-400",
  success: "bg-emerald-500/10 border-emerald-500/25 text-emerald-400",
};

const noop = () => () => {};

export function ToastStack({ children }: { children: React.ReactNode }) {
  // No portal in the server HTML; a message only ever shows after a request.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-x-4 z-[80] mx-auto max-w-[448px] flex flex-col gap-2 pointer-events-none
                 bottom-[calc(env(safe-area-inset-bottom)+76px)] tablet:bottom-6"
    >
      {children}
    </div>,
    document.body,
  );
}

export function Toast({
  tone = "error",
  role,
  onDismiss,
  className = "",
  children,
  ...rest
}: {
  tone?: Tone;
  role?: "alert" | "status";
  onDismiss?: () => void;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "role" | "className" | "children">) {
  return (
    // The card behind keeps the tinted message readable over the page.
    <div className="toast-in pointer-events-auto rounded-xl bg-card shadow-xl shadow-black/40">
      <div
        role={role ?? (tone === "error" ? "alert" : "status")}
        className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${TONES[tone]} ${className}`}
        {...rest}
      >
        <div className="flex-1 min-w-0">{children}</div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="-my-1 -mr-2 size-7 shrink-0 rounded-lg flex items-center justify-center opacity-70 hover:opacity-100 cursor-pointer transition-opacity"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
