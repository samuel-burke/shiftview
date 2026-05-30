"use client";

import { useEffect, useRef, useState } from "react";
import { AvailabilityRecord, fmtMinutes } from "../data/types";

type Props = {
  employeeId: number;
  weeklyHours: Record<number, { open: number; close: number }>;
  firstDayOfWeek: number;
  isDemo?: boolean;
};

type DayState = "any" | "window" | "off";

type DayConfig = {
  recordId: number | null;
  state: DayState;
  startVal: string;
  endVal: string;
  saveStatus: "idle" | "saving" | "saved" | "error";
};

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL  = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS  = [1, 2, 3, 4, 5];
const WEEKENDS  = [0, 6];

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

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

type BarProps = { storeOpen: number; storeClose: number; availStart: number; availEnd: number };

function AvailBar({ storeOpen, storeClose, availStart, availEnd }: BarProps) {
  const total = storeClose - storeOpen;
  if (total <= 0) return null;
  const beforePct = clamp((availStart - storeOpen) / total * 100, 0, 100);
  const windowPct = clamp((availEnd - availStart) / total * 100, 0, 100);
  const adjAfter  = clamp(100 - beforePct - windowPct, 0, 100);
  return (
    <div className="flex h-2.5 rounded-full overflow-hidden gap-px" aria-label="availability bar">
      {beforePct > 0 && <div className="bg-slate-700/60"    style={{ width: `${beforePct}%` }} />}
      {windowPct > 0 && <div className="bg-emerald-500/80"  style={{ width: `${windowPct}%` }} />}
      {adjAfter  > 0 && <div className="bg-slate-700/60"    style={{ width: `${adjAfter}%`  }} />}
    </div>
  );
}

export default function AvailabilitySection({
  employeeId,
  weeklyHours,
  firstDayOfWeek,
  isDemo = false,
}: Props) {
  const orderedDays = Array.from({ length: 7 }, (_, i) => (i + firstDayOfWeek) % 7);

  const defaultDay = (): DayConfig => ({
    recordId: null, state: "any", startVal: "", endVal: "", saveStatus: "idle",
  });

  const [days, setDays] = useState<Record<number, DayConfig>>(() => {
    const d: Record<number, DayConfig> = {};
    for (let i = 0; i < 7; i++) d[i] = defaultDay();
    return d;
  });

  // Sheet state
  const [activeDow, setActiveDow] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function openSheet(dow: number) {
    setActiveDow(dow);
    // Two rAF ticks so the element mounts before the transition starts
    requestAnimationFrame(() => requestAnimationFrame(() => setSheetOpen(true)));
  }

  function closeSheet() {
    setSheetOpen(false);
    setTimeout(() => setActiveDow(null), 300);
  }

  const timerRefs = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (isDemo) return;
    fetch(`/api/availability?employeeId=${employeeId}`)
      .then((r) => r.json())
      .then((records: AvailabilityRecord[]) => {
        setDays((prev) => {
          const next = { ...prev };
          for (const rec of records) {
            const dow = rec.dayOfWeek;
            if (rec.startMinutes === null || rec.endMinutes === null) {
              next[dow] = { ...next[dow], recordId: rec.id, state: "off", startVal: "", endVal: "", saveStatus: "idle" };
            } else {
              next[dow] = {
                ...next[dow],
                recordId: rec.id,
                state: "window",
                startVal: minutesToTimeStr(rec.startMinutes),
                endVal:   minutesToTimeStr(rec.endMinutes),
                saveStatus: "saved",
              };
            }
          }
          return next;
        });
      })
      .catch(() => {});
  }, [employeeId]);

  function scheduleSave(dow: number, updater: (d: DayConfig) => DayConfig) {
    setDays((prev) => {
      const updated = updater(prev[dow]);
      return { ...prev, [dow]: { ...updated, saveStatus: "saving" } };
    });
    if (timerRefs.current[dow]) clearTimeout(timerRefs.current[dow]);
    timerRefs.current[dow] = setTimeout(() => {
      setDays((prev) => { doSave(dow, prev[dow]); return prev; });
    }, 800);
  }

  async function doSave(dow: number, cfg: DayConfig) {
    if (isDemo) {
      setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "saved" } }));
      return;
    }

    if (cfg.state === "any") {
      if (cfg.recordId) {
        try {
          await fetch("/api/availability", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: cfg.recordId }),
          });
          setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], recordId: null, saveStatus: "saved" } }));
        } catch {
          setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "error" } }));
        }
      } else {
        // No record to delete — still confirm the state is now clear
        setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "saved" } }));
      }
      return;
    }

    const startMinutes = cfg.state === "window" && cfg.startVal ? timeStrToMinutes(cfg.startVal) : null;
    const endMinutes   = cfg.state === "window" && cfg.endVal   ? timeStrToMinutes(cfg.endVal)   : null;

    try {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, dayOfWeek: dow, startMinutes, endMinutes, note: null }),
      });
      if (res.ok) {
        const json = await res.json();
        setDays((prev) => ({
          ...prev,
          [dow]: { ...prev[dow], recordId: json.id ?? prev[dow].recordId, saveStatus: "saved" },
        }));
      } else {
        setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "error" } }));
      }
    } catch {
      setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "error" } }));
    }
  }

  function handlePillClick(dow: number, newState: DayState) {
    const storeHours = weeklyHours[dow] ?? { open: 360, close: 1320 };
    if (newState === "window") {
      scheduleSave(dow, (cfg) => ({
        ...cfg,
        state:    "window",
        startVal: cfg.startVal || minutesToTimeStr(storeHours.open),
        endVal:   cfg.endVal   || minutesToTimeStr(storeHours.close),
      }));
    } else if (newState === "off") {
      scheduleSave(dow, (cfg) => ({ ...cfg, state: "off", startVal: "", endVal: "" }));
    } else {
      scheduleSave(dow, (cfg) => ({ ...cfg, state: "any", startVal: "", endVal: "" }));
    }
  }

  function handleTimeBlur(dow: number) {
    scheduleSave(dow, (cfg) => cfg);
  }

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function copyToTarget(sourceDow: number, targets: number[], key: string) {
    const src = days[sourceDow];
    for (const target of targets) {
      if (target === sourceDow) continue;
      scheduleSave(target, (cfg) => ({
        ...cfg, state: "window", startVal: src.startVal, endVal: src.endVal,
      }));
    }
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    setCopiedKey(key);
    copiedTimerRef.current = setTimeout(() => setCopiedKey(null), 2000);
  }

  const allAny = orderedDays.every((d) => days[d].state === "any");

  // Sheet-specific derived values
  const sheetDay        = activeDow !== null ? days[activeDow] : null;
  const sheetStoreHours = activeDow !== null ? (weeklyHours[activeDow] ?? { open: 360, close: 1320 }) : { open: 360, close: 1320 };
  const sheetStartMins  = sheetDay?.startVal ? timeStrToMinutes(sheetDay.startVal) : null;
  const sheetEndMins    = sheetDay?.endVal   ? timeStrToMinutes(sheetDay.endVal)   : null;
  const sheetInvalid    = sheetStartMins !== null && sheetEndMins !== null && sheetStartMins >= sheetEndMins;
  const sheetShowBar    = sheetDay?.saveStatus === "saved" && sheetDay?.state === "window"
                          && sheetStartMins !== null && sheetEndMins !== null && !sheetInvalid;

  return (
    <section
      data-testid="availability-section"
      className="bg-slate-900 border border-slate-800 rounded-xl px-4 pt-4 pb-2 mt-4"
    >
      <h2 className="text-base font-bold text-slate-100 mb-1">My Typical Week</h2>
      <p className="text-xs text-slate-400 mb-3">
        Let your manager know when you&rsquo;re usually available to work.
      </p>

      {allAny && (
        <div className="mb-2 text-xs text-emerald-400">
          ✓ No restrictions set — available any time.
        </div>
      )}

      {/* Compact day rows */}
      <div className="flex flex-col divide-y divide-slate-800/60">
        {orderedDays.map((dow) => {
          const cfg = days[dow];
          const dot =
            cfg.state === "off"    ? "bg-red-400" :
            cfg.state === "window" ? "bg-indigo-400" : "bg-emerald-400";
          const label =
            cfg.state === "off"
              ? "Off"
              : cfg.state === "window" && cfg.startVal && cfg.endVal
              ? `${fmtMinutes(timeStrToMinutes(cfg.startVal))} – ${fmtMinutes(timeStrToMinutes(cfg.endVal))}`
              : "Any time";
          const labelColor =
            cfg.state === "off"    ? "text-red-400" :
            cfg.state === "window" ? "text-indigo-300" : "text-emerald-400";

          return (
            <button
              key={dow}
              data-testid={`day-row-${dow}`}
              onClick={() => openSheet(dow)}
              className="flex items-center w-full py-3.5 gap-3 bg-transparent border-none cursor-pointer text-left"
            >
              <span className="text-sm font-semibold text-slate-300 w-9 shrink-0">
                {DAY_SHORT[dow]}
              </span>
              <span className={`flex items-center gap-2 flex-1 text-sm ${labelColor}`}>
                <span className={`size-2 rounded-full shrink-0 ${dot}`} />
                {label}
              </span>
              {cfg.saveStatus === "saving" && (
                <span className="text-[11px] text-slate-500 shrink-0">Saving…</span>
              )}
              {cfg.saveStatus === "error" && (
                <span className="text-[11px] text-red-400 shrink-0">Error</span>
              )}
              <span className="text-slate-600 text-base shrink-0" aria-hidden>›</span>
            </button>
          );
        })}
      </div>

      {/* Bottom sheet */}
      {activeDow !== null && (
        <>
          {/* Backdrop */}
          <div
            className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${sheetOpen ? "opacity-100" : "opacity-0"}`}
            onClick={closeSheet}
          />

          {/* Sheet panel */}
          <div
            data-testid="availability-sheet"
            className={`fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${sheetOpen ? "translate-y-0" : "translate-y-full"}`}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-slate-700" />
            </div>

            <div className="px-5 pb-10 pt-2">
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-slate-100">{DAY_FULL[activeDow]}</h3>
                <button
                  onClick={closeSheet}
                  aria-label="Close"
                  className="size-8 rounded-full bg-slate-800 border-none text-slate-400 text-base cursor-pointer flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              {/* Segmented control */}
              <div
                className="flex bg-slate-950 rounded-xl p-1 gap-1 mb-6"
                role="group"
                aria-label={`${DAY_FULL[activeDow]} availability`}
              >
                {(["any", "window", "off"] as DayState[]).map((s) => {
                  const isActive = sheetDay?.state === s;
                  const pillLabel = s === "any" ? "Any time" : s === "window" ? "Window" : "Off";
                  const activeClass =
                    s === "any"    ? "bg-emerald-900/60 text-emerald-400" :
                    s === "window" ? "bg-indigo-900/60 text-indigo-400"   :
                                     "bg-red-900/60 text-red-400";
                  return (
                    <button
                      key={s}
                      onClick={() => handlePillClick(activeDow, s)}
                      className={`flex-1 py-3 rounded-lg text-sm font-semibold transition-colors cursor-pointer border-none min-h-[44px] ${
                        isActive ? activeClass : "text-slate-500 bg-transparent"
                      }`}
                      aria-pressed={isActive}
                    >
                      {pillLabel}
                    </button>
                  );
                })}
              </div>

              {/* Window time inputs */}
              {sheetDay?.state === "window" && (
                <div className="flex flex-col gap-4 w-full overflow-hidden">
                  <div className="text-xs text-slate-500">
                    Store open: {fmtMinutes(sheetStoreHours.open)} – {fmtMinutes(sheetStoreHours.close)}
                  </div>

                  <div className="flex flex-col gap-3">
                    {[
                      { label: "From", val: sheetDay.startVal, ariaLabel: `${DAY_FULL[activeDow]} start time`,
                        onChange: (v: string) => setDays((prev) => ({ ...prev, [activeDow]: { ...prev[activeDow], startVal: v } })) },
                      { label: "To",   val: sheetDay.endVal,   ariaLabel: `${DAY_FULL[activeDow]} end time`,
                        onChange: (v: string) => setDays((prev) => ({ ...prev, [activeDow]: { ...prev[activeDow], endVal: v } })) },
                    ].map(({ label, val, ariaLabel, onChange }) => (
                      <div key={label} className="min-w-0 w-full">
                        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                          {label}
                        </div>
                        <input
                          type="time"
                          value={val}
                          onChange={(e) => onChange(e.target.value)}
                          onBlur={() => handleTimeBlur(activeDow)}
                          className="w-full max-w-full box-border bg-slate-800 border border-slate-700 rounded-xl px-3 py-3 text-slate-100 text-base [color-scheme:dark]"
                          aria-label={ariaLabel}
                        />
                      </div>
                    ))}
                  </div>

                  {sheetInvalid && (
                    <div className="text-sm text-red-400">End time must be after start time</div>
                  )}

                  {sheetShowBar && sheetStartMins !== null && sheetEndMins !== null && (
                    <AvailBar
                      storeOpen={sheetStoreHours.open}
                      storeClose={sheetStoreHours.close}
                      availStart={sheetStartMins}
                      availEnd={sheetEndMins}
                    />
                  )}

                  {/* Copy to */}
                  <div>
                    <div className="text-xs text-slate-500 mb-2">Apply this window to:</div>
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
                </div>
              )}

              {/* Save status */}
              <div className="mt-5 h-5 text-center">
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
