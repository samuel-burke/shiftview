"use client";

import { useEffect, useRef, useState } from "react";
import { AvailabilityRecord, StoreHours, fmtMinutes } from "../data/types";

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
  startVal: string; // "HH:MM"
  endVal: string;
  note: string;
  noteOpen: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
};

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

  // Ensure they sum to 100
  const sum = beforePct + windowPct + afterPct;
  const adjAfter = afterPct + (100 - sum);

  return (
    <div className="mt-2 flex h-2 rounded-full overflow-hidden gap-px" aria-label="availability bar">
      {beforePct > 0 && (
        <div className="bg-slate-800" style={{ width: `${beforePct}%` }} />
      )}
      {windowPct > 0 && (
        <div className="bg-emerald-500/70" style={{ width: `${windowPct}%` }} />
      )}
      {adjAfter > 0 && (
        <div className="bg-slate-800" style={{ width: `${adjAfter}%` }} />
      )}
    </div>
  );
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];

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
    note: "",
    noteOpen: false,
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
            const storeHours = weeklyHours[dow] ?? { open: 360, close: 1320 };
            if (rec.startMinutes === null || rec.endMinutes === null) {
              next[dow] = {
                ...next[dow],
                recordId: rec.id,
                state: "off",
                startVal: "",
                endVal: "",
                note: rec.note ?? "",
                saveStatus: "idle",
              };
            } else {
              next[dow] = {
                ...next[dow],
                recordId: rec.id,
                state: "window",
                startVal: minutesToTimeStr(rec.startMinutes),
                endVal: minutesToTimeStr(rec.endMinutes),
                note: rec.note ?? "",
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
    // Apply update
    setDays((prev) => {
      const updated = updater(prev[dow]);
      return { ...prev, [dow]: { ...updated, saveStatus: "saving" } };
    });

    // Cancel pending timer
    if (timerRefs.current[dow]) clearTimeout(timerRefs.current[dow]);

    // Schedule new save
    timerRefs.current[dow] = setTimeout(() => {
      setDays((prev) => {
        const cfg = prev[dow];
        doSave(dow, cfg);
        return prev;
      });
    }, 800);
  }

  async function doSave(dow: number, cfg: DayConfig) {
    if (isDemo) {
      setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "saved" } }));
      return;
    }

    let startMinutes: number | null = null;
    let endMinutes: number | null = null;

    if (cfg.state === "window" && cfg.startVal && cfg.endVal) {
      startMinutes = timeStrToMinutes(cfg.startVal);
      endMinutes = timeStrToMinutes(cfg.endVal);
    } else if (cfg.state === "off") {
      startMinutes = null;
      endMinutes = null;
    } else if (cfg.state === "any") {
      // Delete the record if it exists
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
        return;
      }
      // Nothing to save
      setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], saveStatus: "idle" } }));
      return;
    }

    try {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          dayOfWeek: dow,
          startMinutes,
          endMinutes,
          note: cfg.note || null,
        }),
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
      // "any" - delete record
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
      scheduleSave(target, (cfg) => ({
        ...cfg,
        state: "window",
        startVal: src.startVal,
        endVal: src.endVal,
      }));
    }
  }

  const allAny = orderedDays.every((d) => days[d].state === "any");

  return (
    <section
      data-testid="availability-section"
      className="bg-slate-900 border border-slate-800 rounded-xl px-4 pt-4 pb-5 mt-4"
    >
      <h2 className="text-base font-bold text-slate-100 mb-0.5">My Typical Week</h2>
      <p className="text-xs text-slate-400 mb-4">
        Let your manager know when you&rsquo;re free to work each week. For specific dates use{" "}
        <a href="#" className="text-blue-400 underline">
          Request Day Off ↗
        </a>
        .
      </p>

      {allAny && (
        <div className="mb-3 text-xs text-emerald-400">
          ✓ No restrictions set — you&rsquo;re shown as available any time.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {orderedDays.map((dow) => {
          const cfg = days[dow];
          const storeHours = weeklyHours[dow] ?? { open: 360, close: 1320 };
          const startMins = cfg.startVal ? timeStrToMinutes(cfg.startVal) : null;
          const endMins = cfg.endVal ? timeStrToMinutes(cfg.endVal) : null;
          const windowInvalid =
            startMins !== null && endMins !== null && startMins >= endMins;

          const showBar =
            cfg.saveStatus === "saved" &&
            cfg.state === "window" &&
            startMins !== null &&
            endMins !== null &&
            !windowInvalid;

          return (
            <div key={dow} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Day label */}
                <span className="text-sm font-semibold text-slate-300 w-8">
                  {DAY_SHORT[dow]}
                </span>

                {/* Three-state pills */}
                <div className="flex bg-slate-950 rounded-lg p-0.5 gap-0.5" role="group" aria-label={`${DAY_SHORT[dow]} availability`}>
                  {(["any", "window", "off"] as DayState[]).map((s) => {
                    const isActive = cfg.state === s;
                    const label = s === "any" ? "Any time" : s === "window" ? "Window" : "Off";
                    const activeClass =
                      s === "any"
                        ? "bg-emerald-950 text-emerald-400"
                        : s === "window"
                        ? "bg-indigo-950 text-indigo-400"
                        : "bg-red-950 text-red-400";
                    return (
                      <button
                        key={s}
                        onClick={() => handlePillClick(dow, s)}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer border-none ${
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
                {cfg.saveStatus === "saving" && (
                  <span className="text-xs text-slate-400">Saving…</span>
                )}
                {cfg.saveStatus === "saved" && (
                  <span className="text-xs text-emerald-400">Saved ✓</span>
                )}
                {cfg.saveStatus === "error" && (
                  <span className="text-xs text-red-400">Failed</span>
                )}
              </div>

              {/* Time inputs - only in window state */}
              {cfg.state === "window" && (
                <div className="ml-10 flex flex-col gap-1.5">
                  <div className="text-[10px] text-slate-500">
                    Store: {fmtMinutes(storeHours.open)} – {fmtMinutes(storeHours.close)}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={cfg.startVal}
                      onChange={(e) =>
                        setDays((prev) => ({
                          ...prev,
                          [dow]: { ...prev[dow], startVal: e.target.value },
                        }))
                      }
                      onBlur={() => handleTimeBlur(dow)}
                      className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 text-sm [color-scheme:dark]"
                      aria-label={`${DAY_SHORT[dow]} start time`}
                    />
                    <span className="text-slate-500 text-sm">–</span>
                    <input
                      type="time"
                      value={cfg.endVal}
                      onChange={(e) =>
                        setDays((prev) => ({
                          ...prev,
                          [dow]: { ...prev[dow], endVal: e.target.value },
                        }))
                      }
                      onBlur={() => handleTimeBlur(dow)}
                      className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 text-sm [color-scheme:dark]"
                      aria-label={`${DAY_SHORT[dow]} end time`}
                    />
                  </div>
                  {windowInvalid && (
                    <div className="text-xs text-red-400">End time must be after start time</div>
                  )}

                  {/* Visual bar */}
                  {showBar && startMins !== null && endMins !== null && (
                    <AvailBar
                      storeOpen={storeHours.open}
                      storeClose={storeHours.close}
                      availStart={startMins}
                      availEnd={endMins}
                    />
                  )}

                  {/* Copy to buttons */}
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                    <span className="text-[10px] text-slate-500">Copy to:</span>
                    <button
                      onClick={() => copyToTarget(dow, WEEKDAYS)}
                      className="text-[10px] text-slate-400 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 cursor-pointer"
                    >
                      Weekdays
                    </button>
                    <button
                      onClick={() => copyToTarget(dow, WEEKENDS)}
                      className="text-[10px] text-slate-400 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 cursor-pointer"
                    >
                      Weekends
                    </button>
                    <button
                      onClick={() => copyToTarget(dow, [0, 1, 2, 3, 4, 5, 6])}
                      className="text-[10px] text-slate-400 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 cursor-pointer"
                    >
                      All days
                    </button>
                  </div>
                </div>
              )}

              {/* Note section */}
              {cfg.state !== "any" && (
                <div className="ml-10">
                  {!cfg.noteOpen && !cfg.note ? (
                    <button
                      onClick={() =>
                        setDays((prev) => ({
                          ...prev,
                          [dow]: { ...prev[dow], noteOpen: true },
                        }))
                      }
                      className="text-[10px] text-slate-500 cursor-pointer bg-transparent border-none underline"
                    >
                      + Add note
                    </button>
                  ) : cfg.noteOpen ? (
                    <textarea
                      value={cfg.note}
                      placeholder="Add a note…"
                      rows={2}
                      onChange={(e) =>
                        setDays((prev) => ({
                          ...prev,
                          [dow]: { ...prev[dow], note: e.target.value },
                        }))
                      }
                      onBlur={() => handleTimeBlur(dow)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 text-xs resize-none"
                      aria-label={`${DAY_SHORT[dow]} note`}
                    />
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                      <span>📝 &ldquo;{cfg.note}&rdquo;</span>
                      <button
                        onClick={() =>
                          setDays((prev) => ({
                            ...prev,
                            [dow]: { ...prev[dow], noteOpen: true },
                          }))
                        }
                        className="text-slate-500 cursor-pointer bg-transparent border-none underline text-[10px]"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          setDays((prev) => ({
                            ...prev,
                            [dow]: { ...prev[dow], note: "", noteOpen: false },
                          }));
                          scheduleSave(dow, (cfg) => ({ ...cfg, note: "" }));
                        }}
                        className="text-slate-500 cursor-pointer bg-transparent border-none text-[10px]"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
