"use client";

import { useEffect, useState } from "react";
import SettingsSectionLabel from "./SettingsSectionLabel";
import { createClient } from "@/lib/supabase-browser";
import { KIOSK_NAME_MAX } from "@/lib/kiosk";

type Device = {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  locked: boolean;
  failedToday: number;
};

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Settings → Kiosk (managers): turn kiosk mode on, register this device as a
// store kiosk, and see, unlock or revoke the store's kiosks. Its content
// loads on its own; the card keeps its height while it does.
export default function KioskSettingsSection() {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null);

  function load() {
    return fetch("/api/kiosk/devices")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { enabled: boolean; devices: Device[] }) => {
        setEnabled(!!d.enabled);
        setDevices(d.devices ?? []);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }

  useEffect(() => { load(); }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kioskEnabled: next }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setEnabled(!next);
      setError("Couldn't save — try again");
    }
  }

  async function setUpThisDevice() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Give this kiosk a name, like “Front counter”"); return; }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/kiosk/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => null);
    if (!res?.ok) {
      setSaving(false);
      const body = await res?.json().catch(() => null);
      setError(body?.error ?? "Couldn't set up this device — try again");
      return;
    }
    // The device now holds the kiosk token. Sign the manager out so the
    // tablet doesn't stay signed in to their account, then open the kiosk.
    await createClient().auth.signOut().catch(() => {});
    window.location.href = "/kiosk";
  }

  async function revoke(id: number) {
    setBusyId(id);
    setConfirmRevoke(null);
    await fetch(`/api/kiosk/devices/${id}`, { method: "DELETE" }).catch(() => null);
    await load();
    setBusyId(null);
  }

  async function unlock(id: number) {
    setBusyId(id);
    await fetch(`/api/kiosk/devices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unlock: true }),
    }).catch(() => null);
    await load();
    setBusyId(null);
  }

  const active = devices.filter((d) => !d.revokedAt);

  return (
    <section data-testid="kiosk-settings">
      <SettingsSectionLabel label="Kiosk" />
      <div className="bg-card rounded-2xl border border-line/60 px-4 py-4 space-y-4 min-h-[88px]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-fg-body">Kiosk Mode</div>
            <div className="text-xs text-fg-subtle mt-0.5">
              Employees clock in on a shared store tablet with a PIN. Kiosk punches skip GPS: only a device you
              set up here can make them.
            </div>
          </div>
          <button
            role="switch"
            aria-label="Kiosk mode"
            aria-checked={enabled}
            disabled={!loaded || saving}
            data-testid="toggle-kiosk"
            onClick={toggle}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed after:content-[''] after:absolute after:-inset-y-[10px] after:inset-x-0 ${
              enabled ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
        </div>

        {loaded && enabled && (
          <div className="pt-4 border-t border-line/60 space-y-3">
            <div className="text-sm font-semibold text-fg-body">Set up this device as a kiosk</div>
            <div className="text-xs text-fg-subtle">
              Do this on the store tablet. You&apos;ll be signed out and the tablet opens the kiosk.
            </div>
            <div className="flex gap-2">
              <input
                aria-label="Kiosk name"
                value={name}
                maxLength={KIOSK_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder="Front counter"
                className="flex-1 min-w-0 rounded-lg border border-field bg-well px-3 py-2 text-sm text-fg-body"
              />
              <button
                onClick={setUpThisDevice}
                disabled={saving}
                className="shrink-0 rounded-lg bg-accent text-on-accent px-3 py-2 text-sm font-semibold disabled:opacity-50"
              >
                Set up
              </button>
            </div>
          </div>
        )}

        {error && <div role="alert" className="text-xs text-danger-fg">{error}</div>}

        {loaded && active.length > 0 && (
          <ul className="pt-4 border-t border-line/60 space-y-3" aria-label="Kiosks">
            {active.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-fg-body truncate">{d.name}</div>
                  <div className="text-xs text-fg-subtle">
                    Last used {when(d.lastUsedAt)}
                    {d.locked && <span className="text-danger-fg"> · Locked after wrong PINs</span>}
                    {!d.locked && d.failedToday > 0 && <span> · {d.failedToday} wrong PIN{d.failedToday === 1 ? "" : "s"} today</span>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {d.locked && (
                    <button disabled={busyId === d.id} onClick={() => unlock(d.id)}
                      className="text-xs font-semibold text-accent-fg disabled:opacity-50">Unlock</button>
                  )}
                  {confirmRevoke === d.id ? (
                    <button disabled={busyId === d.id} onClick={() => revoke(d.id)}
                      className="text-xs font-semibold text-danger-fg disabled:opacity-50">Confirm revoke</button>
                  ) : (
                    <button disabled={busyId === d.id} onClick={() => setConfirmRevoke(d.id)}
                      className="text-xs font-semibold text-danger-fg disabled:opacity-50">Revoke</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
