"use client";

import { useState, useEffect } from "react";
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
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-[250ms] ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      />
      {isDesktop ? (
        <div
          className={`fixed top-1/2 left-1/2 z-50 bg-bg border border-slate-800 rounded-[20px] w-[420px] transition-[opacity,transform] duration-200 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          style={{ transform: open ? "translate(-50%, -50%)" : "translate(-50%, -48%)" }}
        >
          {sheetContent()}
        </div>
      ) : (
        <div
          className={`fixed bottom-0 left-0 right-0 z-50 bg-bg border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? "translate-y-0" : "translate-y-full"}`}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-slate-700" />
          </div>
          {sheetContent()}
        </div>
      )}
    </>
  );

  function sheetContent() {
    const padding = isDesktop ? "px-7 pt-6 pb-7" : "px-6 pt-2 pb-11";
    return (
      <div className={padding}>
        <div className="flex items-center justify-between mb-6">
          <div className="text-lg font-bold text-slate-100">Add Employee</div>
          <button
            onClick={onClose}
            className="size-10 rounded-full bg-slate-800 border-none text-slate-400 text-base cursor-pointer flex items-center justify-center"
          >
            ✕
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
              className="px-8 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 font-semibold text-sm cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {[
              { label: "Full Name", val: name, set: setName, type: "text", placeholder: "Alice Smith" },
              { label: "Email",     val: email, set: setEmail, type: "email", placeholder: "alice@example.com" },
            ].map(({ label, val, set, type, placeholder }) => (
              <div key={label}>
                <div className="text-[11px] text-slate-400 uppercase tracking-[0.08em] mb-1.5">
                  {label}
                </div>
                <input
                  type={type}
                  value={val}
                  placeholder={placeholder}
                  onChange={(e) => { set(e.target.value); setError(null); }}
                  className="w-full bg-card border border-slate-700 rounded-[10px] px-[14px] py-3 text-slate-100 text-base [color-scheme:dark]"
                />
              </div>
            ))}

            {error && (
              <div className="text-xs text-red-400 text-center">{error}</div>
            )}

            <button
              onClick={handleSubmit}
              disabled={saving}
              className={`py-[14px] rounded-xl mt-1 bg-gradient-to-r from-blue-500 to-violet-500 border-none text-white font-bold text-sm cursor-pointer transition-opacity ${saving ? "opacity-70" : "opacity-100"}`}
            >
              {saving ? "Sending…" : "Send Invite"}
            </button>

            <button
              onClick={onClose}
              disabled={saving}
              className="py-[14px] rounded-xl bg-transparent border-none text-slate-400 font-semibold text-sm cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }
}
