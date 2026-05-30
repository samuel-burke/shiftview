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
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];

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

type BarProps = {
  storeOpen: number;
  storeClose: number;
  availStart: number;
  availEnd: number;
};

function AvailBar({ storeOpen, storeClose, availStart, availEnd }: BarProps) {
  const total = storeClose - storeOpen;
  if (total <= 0) return null;

  const beforePct = clamp((availStart - storeOpen) / total * 100, 0, 100);
  const windowPct = clamp((availEnd - availStart) / total * 100, 0, 100);
  const afterPct = clamp(100 - beforePct - windowPct, 0, 100);
  const adjAfter = afterPct + (100 - beforePct - windowPct - afterPct);

  return (
    <div className="flex h-2.5 rounded-full overflow-hidden gap-px" aria-label="availability bar">
      {beforePct > 0 && <div className="bg-slate-700/60" style={{ width: `${beforePct}%` }} />}
      {windowPct > 0 && <div className="bg-emerald-500/80" style={{ width: `${windowPct}%` }} />}
      {adjAfter > 0 && <div className="bg-slate-700/60" style={{ width: `${adjAfter}%` }} />}
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
    recordId: null,
    state: "any",
    startVal: "",
    endVal: "",
    saveStatus: "idle",
  });

  const [days, setDays] = useState<Record<number, DayConfig>>(() => {
    const d: Record<number, DayConfig> = {};
    for (let i = 0; i < 7; i++) d[i] = defaultDay();
    return d;
  });

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
                endVal: minutesToTimeStr(rec.endMinutes),
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
        setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "idle" } }));
      }
      return;
    }

    const startMinutes = cfg.state === "window" && cfg.startVal ? timeStrToMinutes(cfg.startVal) : null;
    const endMinutes = cfg.state === "window" && cfg.endVal ? timeStrToMinutes(cfg.endVal) : null;

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
        state: "window",
        startVal: cfg.startVal || minutesToTimeStr(storeHours.open),
        endVal: cfg.endVal || minutesToTimeStr(storeHours.close),
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

  function copyToTarget(sourceDow: number, targets: number[]) {
    const src = days[sourceDow];
    for (const target of targets) {
      if (target === sourceDow) continue;
      scheduleSave(target, (cfg) => ({ ...cfg, state: "window", startVal: src.startVal, endVal: src.endVal }));
    }
  }

  const allAny = orderedDays.every((d) => days[d].state === "any");

  return (
    <section
      data-testid="availability-section"
      className="bg-slate-900 border border-slate-800 rounded-xl px-4 pt-4 pb-5 mt-4"
    >
      <h2 className="text-base font-bold text-slate-100 mb-1">My Typical Week</h2>
      <p className="text-xs text-slate-400 mb-4">
        Let your manager know when you&rsquo;re usually available to work.
      </p>

      {allAny && (
        <div className="mb-3 text-xs text-emerald-400">
          ✓ No restrictions set — you&rsquo;re shown as available any time.
        </div>
      )}

      <div className="flex flex-col divide-y divide-slate-800/60">
        {orderedDays.map((dow) => {
          const cfg = days[dow];
          const storeHours = weeklyHours[dow] ?? { open: 360, close: 1320 };
          const startMins = cfg.startVal ? timeStrToMinutes(cfg.startVal) : null;
          const endMins = cfg.endVal ? timeStrToMinutes(cfg.endVal) : null;
          const windowInvalid = startMins !== null && endMins !== null && startMins >= endMins;
          const showBar = cfg.saveStatus === "saved" && cfg.state === "window" && startMins !== null && endMins !== null && !windowInvalid;

          return (
            <div key={dow} className="py-3">
              {/* Row: day label + pills + status */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-300 w-9 shrink-0">
                  {DAY_SHORT[dow]}
                </span>

                {/* Segmented control */}
                <div
                  className="flex flex-1 bg-slate-950 rounded-xl p-1 gap-0.5"
                  role="group"
                  aria-label={`${DAY_SHORT[dow]} availability`}
                >
                  {(["any", "window", "off"] as DayState[]).map((s) => {
                    const isActive = cfg.state === s;
                    const label = s === "any" ? "Any time" : s === "window" ? "Window" : "Off";
                    const activeClass =
                      s === "any"
                        ? "bg-emerald-900/60 text-emerald-400"
                        : s === "window"
                        ? "bg-indigo-900/60 text-indigo-400"
                        : "bg-red-900/60 text-red-400";
                    return (
                      <button
                        key={s}
                        onClick={() => handlePillClick(dow, s)}
                        className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer border-none min-h-[36px] ${
                          isActive ? activeClass : "text-slate-500 bg-transparent"
                        }`}
                        aria-pressed={isActive}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Save status */}
                <div className="w-12 text-right shrink-0">
                  {cfg.saveStatus === "saving" && (
                    <span className="text-[11px] text-slate-500">Saving…</span>
                  )}
                  {cfg.saveStatus === "saved" && cfg.state !== "any" && (
                    <span className="text-[11px] text-emerald-400">Saved ✓</span>
                  )}
                  {cfg.saveStatus === "error" && (
                    <span className="text-[11px] text-red-400">Failed</span>
                  )}
                </div>
              </div>

              {/* Window time inputs */}
              {cfg.state === "window" && (
                <div className="mt-3 ml-12 flex flex-col gap-2.5">
                  {/* Store hours hint */}
                  <div className="text-[11px] text-slate-500">
                    Store open: {fmtMinutes(storeHours.open)} – {fmtMinutes(storeHours.close)}
                  </div>

                  {/* Time row */}
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={cfg.startVal}
                      onChange={(e) =>
                        setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], startVal: e.target.value } }))
                      }
                      onBlur={() => handleTimeBlur(dow)}
                      className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-100 text-sm [color-scheme:dark]"
                      aria-label={`${DAY_SHORT[dow]} start time`}
                    />
                    <span className="text-slate-500 text-sm shrink-0">–</span>
                    <input
                      type="time"
                      value={cfg.endVal}
                      onChange={(e) =>
                        setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], endVal: e.target.value } }))
                      }
                      onBlur={() => handleTimeBlur(dow)}
                      className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-100 text-sm [color-scheme:dark]"
                      aria-label={`${DAY_SHORT[dow]} end time`}
                    />
                  </div>

                  {windowInvalid && (
                    <div className="text-xs text-red-400">End time must be after start time</div>
                  )}

                  {showBar && startMins !== null && endMins !== null && (
                    <AvailBar
                      storeOpen={storeHours.open}
                      storeClose={storeHours.close}
                      availStart={startMins}
                      availEnd={endMins}
                    />
                  )}

                  {/* Copy to */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-500">Copy to:</span>
                    {[
                      { label: "Weekdays", targets: WEEKDAYS },
                      { label: "Weekends", targets: WEEKENDS },
                      { label: "All days", targets: [0, 1, 2, 3, 4, 5, 6] },
                    ].map(({ label, targets }) => (
                      <button
                        key={label}
                        onClick={() => copyToTarget(dow, targets)}
                        className="text-xs text-slate-300 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 cursor-pointer"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
