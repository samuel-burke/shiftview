"use client";

import { useEffect, useState } from "react";
import { pinProblem } from "@/lib/kiosk";

// A kiosk PIN: set one (4-6 digits), generate one, or remove it. For the
// signed-in employee themselves (no employeeId) or, for a manager, any
// employee of the store. The PIN is never shown again after it is set, except
// a generated one, once. Keeps a fixed height while it loads.
export default function KioskPinSection({ employeeId, compact = false }: { employeeId?: number; compact?: boolean }) {
  const [status, setStatus] = useState<{ hasPin: boolean } | null>(null);
  const [pin, setPin] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const query = employeeId != null ? `?employeeId=${employeeId}` : "";

  useEffect(() => {
    let live = true;
    fetch(`/api/kiosk/pin${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((s: { hasPin: boolean }) => { if (live) setStatus({ hasPin: !!s.hasPin }); })
      .catch(() => { if (live) setStatus({ hasPin: false }); });
    return () => { live = false; };
  }, [query]);

  async function call(method: "PUT" | "POST" | "DELETE", body?: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    setShown(null);
    const res = await fetch(`/api/kiosk/pin${method === "DELETE" ? query : ""}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setMessage({ kind: "error", text: data?.error ?? "Couldn't save — try again" });
      return null;
    }
    return data ?? {};
  }

  async function save() {
    const problem = pinProblem(pin);
    if (problem) { setMessage({ kind: "error", text: problem }); return; }
    const ok = await call("PUT", { employeeId, pin });
    if (ok) {
      setPin("");
      setStatus({ hasPin: true });
      setMessage({ kind: "ok", text: "PIN saved" });
    }
  }

  async function generate() {
    const data = await call("POST", { employeeId });
    if (data?.pin) {
      setStatus({ hasPin: true });
      setShown(data.pin);
    }
  }

  async function remove() {
    const ok = await call("DELETE");
    if (ok) {
      setStatus({ hasPin: false });
      setMessage({ kind: "ok", text: "PIN removed" });
    }
  }

  return (
    <div className={compact ? "mt-2.5 min-h-[112px]" : "min-h-[112px]"} data-testid="kiosk-pin">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-fg-body">Kiosk PIN</div>
        <div className="text-xs text-fg-subtle">
          {status == null ? " " : status.hasPin ? "Set" : "Not set"}
        </div>
      </div>
      <div className="flex gap-2 mt-2">
        <input
          aria-label="New kiosk PIN"
          inputMode="numeric"
          autoComplete="off"
          type="password"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="4–6 digits"
          className="flex-1 min-w-0 rounded-lg border border-field bg-well px-3 py-2 text-sm text-fg-body"
        />
        <button onClick={save} disabled={busy || !pin}
          className="shrink-0 rounded-lg bg-accent text-on-accent px-3 py-2 text-sm font-semibold disabled:opacity-50">
          Save
        </button>
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs">
        <button onClick={generate} disabled={busy} className="font-semibold text-accent-fg disabled:opacity-50">
          Generate a PIN
        </button>
        {status?.hasPin && (
          <button onClick={remove} disabled={busy} className="font-semibold text-danger-fg disabled:opacity-50">
            Remove
          </button>
        )}
        <div role="status" aria-live="polite" className="flex-1 text-right">
          {shown && <span className="text-fg-body">New PIN: <strong data-testid="generated-pin">{shown}</strong> — note it now</span>}
          {message && <span className={message.kind === "ok" ? "text-success-fg" : "text-danger-fg"}>{message.text}</span>}
        </div>
      </div>
    </div>
  );
}
