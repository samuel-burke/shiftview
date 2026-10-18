"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  KIOSK_CONFIRM_MS,
  KIOSK_IDLE_MS,
  KIOSK_STATE_LABEL,
  PUNCH_LABEL,
  type KioskState,
  type PunchType,
} from "@/lib/kiosk";

type Device = { status: "loading" } | { status: "ready"; kioskName: string; orgName: string } | { status: "unavailable"; message: string };

type Screen =
  | { kind: "pin" }
  | { kind: "employee"; name: string; state: KioskState; actions: PunchType[]; since: string | null }
  | { kind: "done"; name: string; punchType: PunchType; punchedAt: string };

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// The kiosk screen. It holds one employee's PIN and details only between
// their PIN and their punch: after the punch (a short confirmation) and after
// KIOSK_IDLE_MS without a tap it forgets everything and shows the keypad.
export default function KioskClient() {
  const [device, setDevice] = useState<Device>({ status: "loading" });
  const [screen, setScreen] = useState<Screen>({ kind: "pin" });
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The PIN that identified the current employee; sent again with the punch.
  const pinRef = useRef<string | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    pinRef.current = null;
    setPin("");
    setScreen({ kind: "pin" });
    setMessage(null);
    setBusy(false);
  }, []);

  // Any tap restarts the idle timer.
  const touch = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(reset, KIOSK_IDLE_MS);
  }, [reset]);

  useEffect(() => {
    touch();
    return () => { if (idleRef.current) clearTimeout(idleRef.current); };
  }, [touch]);

  useEffect(() => {
    fetch("/api/kiosk/status", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (r.ok) setDevice({ status: "ready", kioskName: body?.kioskName ?? "Kiosk", orgName: body?.orgName ?? "" });
        else setDevice({ status: "unavailable", message: body?.error ?? "This device isn't set up as a kiosk — ask a manager" });
      })
      .catch(() => setDevice({ status: "unavailable", message: "Can't reach the server — check the connection" }));
  }, []);

  useEffect(() => {
    if (screen.kind !== "done") return;
    const t = setTimeout(reset, KIOSK_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [screen, reset]);

  async function submitPin(value: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/kiosk/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: value }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    setPin("");
    if (!res?.ok) {
      if (body?.code === "no_kiosk" || body?.code === "disabled")
        setDevice({ status: "unavailable", message: body.error });
      setMessage(body?.error ?? "Can't reach the server — try again");
      return;
    }
    pinRef.current = value;
    setScreen({ kind: "employee", name: body.employeeName, state: body.state, actions: body.actions ?? [], since: body.since ?? null });
  }

  async function punch(punchType: PunchType) {
    touch();
    if (!pinRef.current || screen.kind !== "employee") return;
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/kiosk/punch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinRef.current, punchType }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    pinRef.current = null;
    setBusy(false);
    if (!res?.ok) {
      // Start over either way: the next person shouldn't inherit this screen.
      setPin("");
      setScreen({ kind: "pin" });
      setMessage(body?.error ?? "Can't reach the server — try again");
      return;
    }
    setScreen({ kind: "done", name: body.employeeName, punchType, punchedAt: body.punchedAt });
  }

  function press(key: (typeof KEYS)[number]) {
    touch();
    if (busy || device.status !== "ready") return;
    setMessage(null);
    if (key === "clear") { setPin(""); return; }
    if (key === "back") { setPin((p) => p.slice(0, -1)); return; }
    setPin((p) => (p.length >= 6 ? p : p + key));
  }

  const ready = device.status === "ready";

  return (
    <main
      className="min-h-dvh bg-bg text-fg flex flex-col items-center px-4 py-6"
      onPointerDown={touch}
      data-testid="kiosk"
    >
      <header className="w-full max-w-md text-center h-14">
        <div className="text-xs uppercase tracking-wider text-fg-muted font-semibold">
          {device.status === "ready" ? device.orgName : " "}
        </div>
        <h1 className="text-xl font-bold text-fg mt-1">Time Clock</h1>
      </header>

      {/* One fixed-size panel for every screen, so nothing moves. */}
      <section className="w-full max-w-md flex-1 flex flex-col mt-4" aria-live="polite">
        <div className="h-28 flex flex-col items-center justify-center text-center">
          {device.status === "unavailable" ? (
            <p className="text-sm text-danger-fg" role="alert">{device.message}</p>
          ) : screen.kind === "pin" ? (
            <>
              <p className="text-sm text-fg-muted">Enter your PIN</p>
              <div className="flex gap-3 mt-3 h-4" aria-label={`${pin.length} digits entered`}>
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className={`size-3.5 rounded-full ${i < pin.length ? "bg-accent" : "bg-fill-strong"}`} />
                ))}
              </div>
            </>
          ) : screen.kind === "employee" ? (
            <>
              <p className="text-2xl font-bold text-fg" data-testid="kiosk-name">{screen.name}</p>
              <p className="text-sm text-fg-muted mt-1" data-testid="kiosk-state">
                {KIOSK_STATE_LABEL[screen.state]}
                {screen.since ? ` since ${timeOf(screen.since)}` : ""}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-success-fg">{PUNCH_LABEL[screen.punchType]} ✓</p>
              <p className="text-sm text-fg-muted mt-1">{screen.name} · {timeOf(screen.punchedAt)}</p>
            </>
          )}
        </div>

        <p className="h-6 text-center text-sm text-danger-fg" role="status">{message ?? " "}</p>

        {screen.kind === "employee" ? (
          <div className="grid gap-3 mt-4">
            {screen.actions.map((a) => (
              <button
                key={a}
                onClick={() => punch(a)}
                disabled={busy}
                className="h-16 rounded-2xl bg-accent text-on-accent text-lg font-bold disabled:opacity-50"
              >
                {PUNCH_LABEL[a]}
              </button>
            ))}
            <button onClick={reset} className="h-12 rounded-2xl bg-fill text-fg-body font-semibold">
              Not you? Cancel
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 mt-4">
            {KEYS.map((k) => (
              <button
                key={k}
                onClick={() => press(k)}
                disabled={!ready || busy || screen.kind === "done"}
                aria-label={k === "clear" ? "Clear" : k === "back" ? "Delete" : k}
                className="h-16 rounded-2xl bg-card border border-line/60 text-2xl font-semibold text-fg disabled:opacity-50"
              >
                {k === "clear" ? "C" : k === "back" ? "⌫" : k}
              </button>
            ))}
            <button
              onClick={() => { touch(); submitPin(pin); }}
              disabled={!ready || busy || pin.length < 4 || screen.kind === "done"}
              className="col-span-3 h-14 rounded-2xl bg-accent text-on-accent text-lg font-bold disabled:opacity-50"
            >
              Enter
            </button>
          </div>
        )}
      </section>

      <footer className="h-6 text-xs text-fg-subtle mt-4">
        {device.status === "ready" ? device.kioskName : " "}
      </footer>
    </main>
  );
}
