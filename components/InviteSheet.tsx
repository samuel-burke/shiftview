"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useIsDesktop } from "../hooks/useIsDesktop";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onSubmit?: (name: string, email: string) => Promise<void>;
};

export default function InviteSheet({ open, onClose, onSuccess, onSubmit }: Props) {
  const isDesktop = useIsDesktop();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setError(null);
      setSent(false);
    }
  }, [open]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && open) onClose();
  }, [open, onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  async function handleSubmit() {
    if (!name.trim()) { setError("Name is required."); return; }
    if (!email.trim()) { setError("Email is required."); return; }
    setSaving(true);
    setError(null);
    try {
      if (onSubmit) {
        await onSubmit(name.trim(), email.trim());
      } else {
        const res = await fetch("/api/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), email: email.trim() }),
        });
        const json = await res.json();
        if (!res.ok) { setError(json.error ?? "Failed to send invite"); return; }
      }
      setSent(true);
      onSuccess();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            className="fixed inset-0 bg-black/60 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          {isDesktop ? (
            <motion.div
              key="panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="invite-sheet-title"
              className="fixed top-1/2 left-1/2 z-50 bg-bg border border-slate-800 rounded-[20px] w-[420px]"
              initial={{ opacity: 0, scale: 0.96, x: "-50%", y: "-48%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.96, x: "-50%", y: "-48%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
            >
              {sheetContent()}
            </motion.div>
          ) : (
            <motion.div
              key="panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="invite-sheet-title"
              className="fixed bottom-0 left-0 right-0 z-50 bg-bg border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 300 }}
            >
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-slate-700" />
              </div>
              {sheetContent()}
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  );

  function sheetContent() {
    const padding = isDesktop ? "px-7 pt-6 pb-7" : "px-6 pt-2 pb-11";
    return (
      <div className={padding}>
        <div className="flex items-center justify-between mb-6">
          <div id="invite-sheet-title" className="text-lg font-bold text-slate-100">Add Employee</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="size-10 rounded-full bg-slate-800 border-none text-slate-400 cursor-pointer flex items-center justify-center hover:bg-slate-700 hover:text-slate-200 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {sent ? (
          <div className="text-center py-6">
            <div className="text-[32px] mb-3">✉️</div>
            <div className="text-base font-semibold text-slate-100 mb-2">Invite sent!</div>
            <div className="text-[13px] text-slate-400 mb-6">
              {name} will receive an email to set up their account.
            </div>
            <button
              onClick={onClose}
              className="px-8 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 font-semibold text-sm cursor-pointer hover:bg-slate-700 hover:text-slate-200 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {[
              { label: "Full Name", id: "invite-name",  val: name, set: setName, type: "text",  placeholder: "Alice Smith",       autoFocus: true  },
              { label: "Email",     id: "invite-email", val: email, set: setEmail, type: "email", placeholder: "alice@example.com", autoFocus: false },
            ].map(({ label, id, val, set, type, placeholder, autoFocus }) => (
              <div key={label}>
                <label htmlFor={id} className="text-[11px] text-slate-400 uppercase tracking-[0.08em] mb-1.5 block">
                  {label}
                </label>
                <input
                  id={id}
                  type={type}
                  value={val}
                  placeholder={placeholder}
                  autoFocus={autoFocus}
                  onChange={(e) => { set(e.target.value); setError(null); }}
                  className="w-full bg-card border border-slate-700 rounded-[10px] px-[14px] py-3 text-slate-100 text-base [color-scheme:dark]"
                />
              </div>
            ))}

            {error && (
              <div role="alert" className="text-xs text-red-400 text-center">{error}</div>
            )}

            <button
              onClick={handleSubmit}
              disabled={saving}
              className={`py-[14px] rounded-xl mt-1 bg-gradient-to-r from-blue-500 to-violet-500 border-none text-white font-bold text-sm cursor-pointer transition-opacity hover:brightness-110 ${saving ? "opacity-70" : "opacity-100"}`}
            >
              {saving ? "Sending…" : "Send Invite"}
            </button>

            <button
              onClick={onClose}
              disabled={saving}
              className="py-[14px] rounded-xl bg-transparent border-none text-slate-400 font-semibold text-sm cursor-pointer hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }
}
