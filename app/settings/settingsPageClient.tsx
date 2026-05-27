"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import BottomNav from "../../components/BottomNav";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const FIRST_DAY_OPTIONS = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Saturday", value: 6 },
];

const DEFAULT_HOURS: Record<number, { open: number; close: number }> = {
  0: { open: 480, close: 1200 },
  1: { open: 360, close: 1320 },
  2: { open: 360, close: 1320 },
  3: { open: 360, close: 1320 },
  4: { open: 360, close: 1320 },
  5: { open: 360, close: 1320 },
  6: { open: 360, close: 1320 },
};

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

type Employee = { id: number; name: string; email: string | null };

export default function SettingsPageClient() {
  const router = useRouter();
  const supabase = createClient();

  const [storeHours, setStoreHours] = useState<Record<number, { open: number; close: number }>>(DEFAULT_HOURS);
  const [hoursSaving, setHoursSaving] = useState<Record<number, boolean>>({});
  const [hoursSaved, setHoursSaved] = useState<Record<number, boolean>>({});

  const [optimalCoverage, setOptimalCoverage] = useState(3);
  const [minCoverage, setMinCoverage] = useState(2);
  const [coverageSaving, setCoverageSaving] = useState(false);
  const [coverageSaved, setCoverageSaved] = useState(false);

  const [firstDayOfWeek, setFirstDayOfWeek] = useState(6);
  const [firstDaySaving, setFirstDaySaving] = useState(false);
  const [firstDaySaved, setFirstDaySaved] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  useEffect(() => {
    fetch("/api/store-hours")
      .then((r) => r.json())
      .then((data) => setStoreHours((prev) => ({ ...prev, ...data })))
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ firstDayOfWeek: fdw, optimalCoverage: oc, minCoverage: mc }) => {
        if (fdw != null) setFirstDayOfWeek(fdw);
        if (oc != null) setOptimalCoverage(oc);
        if (mc != null) setMinCoverage(mc);
      })
      .catch(() => {});
    fetch("/api/employees")
      .then((r) => r.json())
      .then(setEmployees)
      .catch(() => {});
  }, []);

  async function saveStoreHours(day: number) {
    setHoursSaving((prev) => ({ ...prev, [day]: true }));
    const { open, close } = storeHours[day];
    await fetch("/api/store-hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayOfWeek: day, openMinutes: open, closeMinutes: close }),
    });
    setHoursSaving((prev) => ({ ...prev, [day]: false }));
    setHoursSaved((prev) => ({ ...prev, [day]: true }));
    setTimeout(() => setHoursSaved((prev) => ({ ...prev, [day]: false })), 2000);
  }

  async function saveCoverage() {
    setCoverageSaving(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optimalCoverage, minCoverage }),
    });
    setCoverageSaving(false);
    setCoverageSaved(true);
    setTimeout(() => setCoverageSaved(false), 2000);
  }

  async function saveFirstDay() {
    setFirstDaySaving(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstDayOfWeek }),
    });
    setFirstDaySaving(false);
    setFirstDaySaved(true);
    setTimeout(() => setFirstDaySaved(false), 2000);
  }

  async function deleteEmployee(id: number) {
    setDeletingId(id);
    await fetch("/api/employees", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setEmployees((prev) => prev.filter((e) => e.id !== id));
    setDeletingId(null);
  }

  return (
    <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-screen">
      {/* Top bar */}
      <div
        className="px-4 pb-3 flex items-center gap-3 border-b border-slate-800 bg-bg"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
      >
        <button
          onClick={() => router.back()}
          className="size-9 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center text-xl cursor-pointer shrink-0"
          aria-label="Back"
        >
          ‹
        </button>
        <span className="text-2xl font-extrabold text-slate-100 tracking-tight">Settings</span>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">

        {/* Store Hours */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Store Hours
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60">
            {Array.from({ length: 7 }, (_, i) => i).map((day) => {
              const hours = storeHours[day] ?? DEFAULT_HOURS[day];
              return (
                <div key={day} className="flex items-center gap-2 px-4 py-3">
                  <span className="text-sm font-semibold text-slate-400 w-9 shrink-0">
                    {DAY_SHORT[day]}
                  </span>
                  <input
                    type="time"
                    value={minutesToTime(hours.open)}
                    onChange={(e) =>
                      setStoreHours((prev) => ({
                        ...prev,
                        [day]: { ...prev[day], open: timeToMinutes(e.target.value) },
                      }))
                    }
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100 min-w-0"
                  />
                  <span className="text-slate-600 text-sm shrink-0">–</span>
                  <input
                    type="time"
                    value={minutesToTime(hours.close)}
                    onChange={(e) =>
                      setStoreHours((prev) => ({
                        ...prev,
                        [day]: { ...prev[day], close: timeToMinutes(e.target.value) },
                      }))
                    }
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100 min-w-0"
                  />
                  <button
                    onClick={() => saveStoreHours(day)}
                    disabled={hoursSaving[day]}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                      hoursSaved[day]
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30"
                    }`}
                  >
                    {hoursSaved[day] ? "Saved" : hoursSaving[day] ? "…" : "Save"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Coverage thresholds */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Coverage Thresholds
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-200">Optimal coverage</div>
                <div className="text-xs text-slate-500 mt-0.5">Minimum staff for green status</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOptimalCoverage((v) => Math.max(1, v - 1))}
                  className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-lg flex items-center justify-center cursor-pointer select-none"
                >
                  −
                </button>
                <span className="text-lg font-bold text-slate-100 w-7 text-center tabular-nums">
                  {optimalCoverage}
                </span>
                <button
                  onClick={() => setOptimalCoverage((v) => v + 1)}
                  className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-lg flex items-center justify-center cursor-pointer select-none"
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-200">Minimum coverage</div>
                <div className="text-xs text-slate-500 mt-0.5">Below this shows red alert</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMinCoverage((v) => Math.max(0, v - 1))}
                  className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-lg flex items-center justify-center cursor-pointer select-none"
                >
                  −
                </button>
                <span className="text-lg font-bold text-slate-100 w-7 text-center tabular-nums">
                  {minCoverage}
                </span>
                <button
                  onClick={() => setMinCoverage((v) => v + 1)}
                  className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-lg flex items-center justify-center cursor-pointer select-none"
                >
                  +
                </button>
              </div>
            </div>

            <button
              onClick={saveCoverage}
              disabled={coverageSaving}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                coverageSaved
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30"
              }`}
            >
              {coverageSaved ? "Saved" : coverageSaving ? "Saving…" : "Save Coverage"}
            </button>
          </div>
        </section>

        {/* Week start */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Week Start
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4 flex flex-col gap-4">
            <div className="flex bg-slate-800 rounded-xl p-[3px]">
              {FIRST_DAY_OPTIONS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => setFirstDayOfWeek(value)}
                  className={`flex-1 py-2 rounded-[9px] text-sm font-semibold transition-colors cursor-pointer ${
                    firstDayOfWeek === value
                      ? "bg-slate-600 text-slate-100"
                      : "text-slate-400 hover:text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={saveFirstDay}
              disabled={firstDaySaving}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                firstDaySaved
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30"
              }`}
            >
              {firstDaySaved ? "Saved" : firstDaySaving ? "Saving…" : "Save"}
            </button>
          </div>
        </section>

        {/* Employees */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Employees
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60">
            {employees.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">No employees</div>
            ) : (
              employees.map((emp) => (
                <div key={emp.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="size-8 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-300 shrink-0">
                    {emp.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-200 truncate">{emp.name}</div>
                    {emp.email && (
                      <div className="text-xs text-slate-500 truncate">{emp.email}</div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove ${emp.name}? This will also delete their shifts.`)) {
                        deleteEmployee(emp.id);
                      }
                    }}
                    disabled={deletingId === emp.id}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer shrink-0"
                  >
                    {deletingId === emp.id ? "…" : "Remove"}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Sign out */}
        <section className="pb-2">
          <button
            onClick={handleSignOut}
            className="w-full py-3 rounded-2xl bg-card border border-slate-800/60 text-sm font-semibold text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            Sign Out
          </button>
        </section>
      </div>

      <BottomNav active="team" />
    </main>
  );
}
