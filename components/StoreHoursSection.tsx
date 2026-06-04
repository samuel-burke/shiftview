"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtMinutes } from "../data/types";
import { DEMO_STORE_HOURS } from "../data/demo-fixtures";

type Props = {
  firstDayOfWeek?: number;
  isDemo?: boolean;
};

type DayData = {
  open: number;
  close: number;
  saveStatus: "idle" | "saving" | "saved" | "error";
};

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL  = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS  = [1, 2, 3, 4, 5];
const WEEKENDS  = [0, 6];

const DEFAULT_HOURS: Record<number, { open: number; close: number }> = {
  0: { open: 480,  close: 1200 },
  1: { open: 360,  close: 1320 },
  2: { open: 360,  close: 1320 },
  3: { open: 360,  close: 1320 },
  4: { open: 360,  close: 1320 },
  5: { open: 360,  close: 1320 },
  6: { open: 360,  close: 1320 },
};

function minutesToTimeStr(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function timeStrToMinutes(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export default function StoreHoursSection({ firstDayOfWeek = 0, isDemo = false }: Props) {
  const orderedDays = Array.from({ length: 7 }, (_, i) => (i + firstDayOfWeek) % 7);

  const [days, setDays] = useState<Record<number, DayData>>(() => {
    const d: Record<number, DayData> = {};
    for (let i = 0; i < 7; i++) {
      const src = isDemo ? DEMO_STORE_HOURS[i] : DEFAULT_HOURS[i];
      d[i] = { open: src.open, close: src.close, saveStatus: "idle" };
    }
    return d;
  });

  const [activeDow, setActiveDow] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const timerRefs    = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isDemo) return;
    fetch("/api/store-hours")
      .then((r) => r.json())
      .then((data: Record<number, { open: number; close: number }>) => {
        setDays((prev) => {
          const next = { ...prev };
          for (let i = 0; i < 7; i++) {
            if (data[i]) next[i] = { ...next[i], open: data[i].open, close: data[i].close };
          }
          return next;
        });
      })
      .catch(() => {});
  }, [isDemo]);

  function openSheet(dow: number) {
    setActiveDow(dow);
    requestAnimationFrame(() => requestAnimationFrame(() => setSheetOpen(true)));
  }

  function closeSheet() {
    setSheetOpen(false);
    setTimeout(() => setActiveDow(null), 300);
  }

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && sheetOpen) closeSheet();
  }, [sheetOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  function scheduleSave(dow: number, updater?: (d: DayData) => DayData) {
    setDays((prev) => {
      const current = prev[dow];
      const updated = updater ? updater(current) : current;
      return { ...prev, [dow]: { ...updated, saveStatus: "saving" } };
    });
    if (timerRefs.current[dow]) clearTimeout(timerRefs.current[dow]);
    timerRefs.current[dow] = setTimeout(() => {
      setDays((prev) => {
        doSave(dow, prev[dow].open, prev[dow].close);
        return prev;
      });
    }, 0);
  }

  async function doSave(dow: number, open: number, close: number) {
    if (isDemo) {
      setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "saved" } }));
      setTimeout(() => setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "idle" } })), 2000);
      return;
    }
    const res = await fetch("/api/store-hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayOfWeek: dow, openMinutes: open, closeMinutes: close }),
    });
    if (res.ok) {
      setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "saved" } }));
      setTimeout(() => setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "idle" } })), 2000);
    } else {
      setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "error" } }));
      setTimeout(() => setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "idle" } })), 4000);
    }
  }

  function copyToTarget(sourceDow: number, targets: number[], key: string) {
    const src = days[sourceDow];
    for (const target of targets) {
      if (target === sourceDow) continue;
      scheduleSave(target, (d) => ({ ...d, open: src.open, close: src.close }));
    }
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    setCopiedKey(key);
    copiedTimerRef.current = setTimeout(() => setCopiedKey(null), 2000);
  }

  const sheetDay     = activeDow !== null ? days[activeDow] : null;
  const sheetInvalid = sheetDay ? sheetDay.close <= sheetDay.open : false;

  return (
    <section data-testid="store-hours-section">
      <div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60">
        {orderedDays.map((dow) => {
          const { open, close, saveStatus } = days[dow];
          return (
            <button
              key={dow}
              data-testid={`day-row-${dow}`}
              onClick={() => openSheet(dow)}
              aria-label={`Edit ${DAY_FULL[dow]} store hours`}
              className="flex items-center w-full px-4 py-3.5 gap-3 bg-transparent border-none cursor-pointer text-left hover:bg-slate-800/30 transition-colors"
            >
              <span className="text-sm font-semibold text-slate-400 w-9 shrink-0">
                {DAY_SHORT[dow]}
              </span>
              <span className="flex-1 text-sm text-slate-200">
                {fmtMinutes(open)} – {fmtMinutes(close)}
              </span>
              <span data-testid={`store-hours-status-${dow}`} className="shrink-0">
                {saveStatus === "saving" && <span className="text-[11px] text-slate-500">Saving…</span>}
                {saveStatus === "saved"  && <span className="text-[11px] text-emerald-400">Saved ✓</span>}
                {saveStatus === "error"  && <span className="text-[11px] text-red-400">Failed to save</span>}
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-slate-600 shrink-0"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          );
        })}
      </div>

      {/* Bottom sheet */}
      {activeDow !== null && (
        <>
          <div
            aria-hidden="true"
            className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${sheetOpen ? "opacity-100" : "opacity-0"}`}
            onClick={closeSheet}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-hours-sheet-title"
            data-testid="store-hours-sheet"
            className={`fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${sheetOpen ? "translate-y-0" : "translate-y-full"}`}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-slate-700" />
            </div>

            <div className="px-5 pb-10 pt-2">
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <h3 id="store-hours-sheet-title" className="text-lg font-bold text-slate-100">{DAY_FULL[activeDow]}</h3>
                <button
                  onClick={closeSheet}
                  aria-label="Close"
                  className="size-8 rounded-full bg-slate-800 border-none text-slate-400 cursor-pointer flex items-center justify-center hover:bg-slate-700 hover:text-slate-200 transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></svg>
                </button>
              </div>

              {/* Open / Close time inputs */}
              <div className="flex flex-col gap-4 w-full">
                {([
                  { label: "Open",  field: "open"  as const, ariaLabel: `${DAY_FULL[activeDow]} open time`  },
                  { label: "Close", field: "close" as const, ariaLabel: `${DAY_FULL[activeDow]} close time` },
                ] as const).map(({ label, field, ariaLabel }) => (
                  <div key={field} className="min-w-0 w-full">
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      {label}
                    </div>
                    <div className="w-full rounded-xl overflow-hidden border border-slate-700 bg-slate-800">
                      <input
                        type="time"
                        aria-label={ariaLabel}
                        value={minutesToTimeStr(sheetDay![field])}
                        onChange={(e) => {
                          const mins = timeStrToMinutes(e.target.value);
                          setDays((prev) => ({
                            ...prev,
                            [activeDow]: { ...prev[activeDow], [field]: mins },
                          }));
                        }}
                        onBlur={() => scheduleSave(activeDow)}
                        className="block w-full min-w-0 bg-transparent px-3 py-3 text-slate-100 text-base [color-scheme:dark] outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {sheetInvalid && (
                <div role="alert" className="mt-3 text-sm text-red-400">
                  Close time must be after open time
                </div>
              )}

              {/* Copy to */}
              <div className="mt-5">
                <div className="text-xs text-slate-500 mb-2">Apply these hours to:</div>
                <div className="flex flex-col gap-2">
                  {[
                    { key: "weekdays", label: "Weekdays", targets: WEEKDAYS },
                    { key: "weekends", label: "Weekends", targets: WEEKENDS },
                    { key: "all",      label: "All days", targets: [0, 1, 2, 3, 4, 5, 6] },
                  ].map(({ key, label, targets }) => {
                    const copied = copiedKey === key;
                    return (
                      <button
                        key={key}
                        onClick={() => copyToTarget(activeDow, targets, key)}
                        className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer border ${
                          copied
                            ? "bg-emerald-900/40 border-emerald-700/50 text-emerald-400"
                            : "bg-slate-800 border-slate-700 text-slate-300"
                        }`}
                      >
                        {copied ? `✓ ${label} updated` : label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Save status */}
              <div aria-live="polite" aria-atomic="true" className="mt-5 h-5 text-center">
                {sheetDay?.saveStatus === "saving" && (
                  <span className="text-sm text-slate-400">Saving…</span>
                )}
                {sheetDay?.saveStatus === "saved" && (
                  <span className="text-sm text-emerald-400">Saved ✓</span>
                )}
                {sheetDay?.saveStatus === "error" && (
                  <span className="text-sm text-red-400">Failed to save</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
