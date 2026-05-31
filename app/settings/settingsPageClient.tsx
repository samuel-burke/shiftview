"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import BottomNav from "../../components/BottomNav";
import InviteSheet from "../../components/InviteSheet";
import StoreHoursSection from "../../components/StoreHoursSection";
import { getMonogram, fmtMinutes, AvailabilityRecord } from "../../data/types";

const DAY_SHORT  = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL   = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

const TIMEZONE_OPTIONS = [
  { label: "Eastern (ET)",  value: "America/New_York" },
  { label: "Central (CT)",  value: "America/Chicago" },
  { label: "Mountain (MT)", value: "America/Denver" },
  { label: "Pacific (PT)",  value: "America/Los_Angeles" },
  { label: "Alaska (AKT)",  value: "America/Anchorage" },
  { label: "Hawaii (HST)",  value: "Pacific/Honolulu" },
  { label: "London (GMT)",  value: "Europe/London" },
  { label: "Paris (CET)",   value: "Europe/Paris" },
  { label: "Tokyo (JST)",   value: "Asia/Tokyo" },
  { label: "Sydney (AEDT)", value: "Australia/Sydney" },
];

const FIRST_DAY_OPTIONS = [
  { label: "Sunday",   value: 0 },
  { label: "Monday",   value: 1 },
  { label: "Saturday", value: 6 },
];

type SaveStatus = "idle" | "saving" | "saved" | "error";

type Employee = { id: number; name: string; email: string | null; user_id: string | null };

function SaveStatusText({ status, testId }: { status: SaveStatus; testId: string }) {
  return (
    <div data-testid={testId}>
      {status === "saving" && <div className="text-xs text-slate-400 mt-2 text-right">Saving…</div>}
      {status === "saved"  && <div className="text-xs text-emerald-400 mt-2 text-right">Saved ✓</div>}
      {status === "error"  && <div className="text-xs text-red-400 mt-2 text-right">Failed to save</div>}
    </div>
  );
}

const DEFAULT_STORE_HOURS: Record<number, { open: number; close: number }> = {
  0: { open: 480, close: 1200 }, 1: { open: 360, close: 1320 }, 2: { open: 360, close: 1320 },
  3: { open: 360, close: 1320 }, 4: { open: 360, close: 1320 }, 5: { open: 360, close: 1320 },
  6: { open: 360, close: 1200 },
};

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

function EmployeeAvailabilityRow({
  employeeId,
  storeHours,
}: {
  employeeId: number;
  storeHours: Record<number, { open: number; close: number }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [records, setRecords] = useState<AvailabilityRecord[] | null>(null);
  const fetchedRef = useRef(false);

  function toggle() {
    setExpanded((prev) => {
      const next = !prev;
      if (next && !fetchedRef.current) {
        fetchedRef.current = true;
        fetch(`/api/availability?employeeId=${employeeId}`)
          .then((r) => r.json())
          .then((data: AvailabilityRecord[]) => setRecords(Array.isArray(data) ? data : []))
          .catch(() => setRecords([]));
      }
      return next;
    });
  }

  const restricted = (records ?? []).filter(
    (r) => r.startMinutes !== null || r.endMinutes !== null || (r.startMinutes === null && r.endMinutes === null)
  );
  const restrictedDows = new Set(restricted.map((r) => r.dayOfWeek));
  const freeDows = [0, 1, 2, 3, 4, 5, 6].filter((d) => !restrictedDows.has(d));
  const allFree = records !== null && restricted.length === 0;

  return (
    <div data-testid={`employee-avail-${employeeId}`} className="px-4 pb-3 pt-0">
      <button
        onClick={toggle}
        aria-expanded={expanded}
        aria-label="Toggle typical week"
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 cursor-pointer bg-transparent border-none"
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span>Typical Week</span>
      </button>

      {expanded && (
        <div className="mt-2 pl-1">
          {records === null ? (
            <div className="text-xs text-slate-600">Loading…</div>
          ) : allFree ? (
            <div className="text-xs text-slate-500">No restrictions set</div>
          ) : (
            <div className="flex flex-col gap-2">
              {restricted.map((rec) => {
                const hours = storeHours[rec.dayOfWeek] ?? DEFAULT_STORE_HOURS[rec.dayOfWeek];
                const isOff = rec.startMinutes === null || rec.endMinutes === null;
                return (
                  <div key={rec.dayOfWeek} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-slate-400 w-7 shrink-0">
                        {DAY_SHORT[rec.dayOfWeek]}
                      </span>
                      {isOff ? (
                        <span className="text-xs text-slate-500">Unavailable</span>
                      ) : (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="flex-1 min-w-0">
                            {(() => {
                              const total = hours.close - hours.open;
                              if (total <= 0) return null;
                              const s = rec.startMinutes!;
                              const e = rec.endMinutes!;
                              const bPct = clamp((s - hours.open) / total * 100, 0, 100);
                              const wPct = clamp((e - s) / total * 100, 0, 100);
                              const aPct = clamp(100 - bPct - wPct, 0, 100);
                              return (
                                <div
                                  className="flex h-1 rounded-full overflow-hidden gap-px"
                                  aria-label={`${DAY_SHORT[rec.dayOfWeek]} availability bar`}
                                >
                                  {bPct > 0 && <div className="bg-slate-700/60" style={{ width: `${bPct}%` }} />}
                                  {wPct > 0 && <div className="bg-emerald-500/70" style={{ width: `${wPct}%` }} />}
                                  {aPct > 0 && <div className="bg-slate-700/60" style={{ width: `${aPct}%` }} />}
                                </div>
                              );
                            })()}
                          </div>
                          <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                            {fmtMinutes(rec.startMinutes!)} – {fmtMinutes(rec.endMinutes!)}
                          </span>
                        </div>
                      )}
                    </div>
                    {rec.note && (
                      <div className="text-[11px] text-slate-500 italic pl-9">{rec.note}</div>
                    )}
                  </div>
                );
              })}
              {freeDows.length > 0 && (
                <div className="text-[11px] text-slate-600">
                  {freeDows.map((d) => DAY_SHORT[d]).join(", ")} — no restrictions
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SettingsPageClient({ isDemo = false }: { isDemo?: boolean }) {
  const router = useRouter();
  const supabase = createClient();

  // ── Coverage ────────────────────────────────────────────────────────────────
  const [optimalCoverage, setOptimalCoverage] = useState(3);
  const [minCoverage, setMinCoverage] = useState(2);
  const [coverageStatus, setCoverageStatus] = useState<SaveStatus>("idle");
  const [coverageValidationError, setCoverageValidationError] = useState<string | null>(null);
  const coverageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleCoverageSave(nextOptimal: number, nextMin: number) {
    if (nextMin > nextOptimal) {
      setCoverageValidationError("Minimum cannot exceed optimal");
      if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
      return;
    }
    setCoverageValidationError(null);
    if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
    coverageTimerRef.current = setTimeout(() => doSaveCoverage(nextOptimal, nextMin), 800);
  }

  async function doSaveCoverage(optimal: number, min: number) {
    setCoverageStatus("saving");
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setCoverageStatus("saved");
      setTimeout(() => setCoverageStatus("idle"), 2000);
      return;
    }
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optimalCoverage: optimal, minCoverage: min }),
    });
    if (res.ok) {
      setCoverageStatus("saved");
      setTimeout(() => setCoverageStatus("idle"), 2000);
    } else {
      setCoverageStatus("error");
      setTimeout(() => setCoverageStatus("idle"), 4000);
    }
  }

  function stepOptimal(delta: number) {
    const next = Math.max(1, optimalCoverage + delta);
    setOptimalCoverage(next);
    scheduleCoverageSave(next, minCoverage);
  }

  function stepMin(delta: number) {
    const next = Math.max(0, minCoverage + delta);
    setMinCoverage(next);
    scheduleCoverageSave(optimalCoverage, next);
  }

  // ── Week Start ──────────────────────────────────────────────────────────────
  const [firstDayOfWeek, setFirstDayOfWeek] = useState(6);
  const [firstDayStatus, setFirstDayStatus] = useState<SaveStatus>("idle");

  async function saveFirstDay(value: number) {
    setFirstDayOfWeek(value);
    setFirstDayStatus("saving");
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setFirstDayStatus("saved");
      setTimeout(() => setFirstDayStatus("idle"), 2000);
      return;
    }
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstDayOfWeek: value }),
    });
    if (res.ok) {
      setFirstDayStatus("saved");
      setTimeout(() => setFirstDayStatus("idle"), 2000);
    } else {
      setFirstDayStatus("error");
      setTimeout(() => setFirstDayStatus("idle"), 4000);
    }
  }

  // ── Timezone ────────────────────────────────────────────────────────────────
  const [timezone, setTimezone] = useState("America/New_York");
  const [timezoneStatus, setTimezoneStatus] = useState<SaveStatus>("idle");

  async function saveTimezone(value: string) {
    setTimezone(value);
    setTimezoneStatus("saving");
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setTimezoneStatus("saved");
      setTimeout(() => setTimezoneStatus("idle"), 2000);
      return;
    }
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: value }),
    });
    if (res.ok) {
      setTimezoneStatus("saved");
      setTimeout(() => setTimezoneStatus("idle"), 2000);
    } else {
      setTimezoneStatus("error");
      setTimeout(() => setTimezoneStatus("idle"), 4000);
    }
  }

  // ── Email Notifications ─────────────────────────────────────────────────────
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [emailNotifSaving, setEmailNotifSaving] = useState(false);
  const [emailNotifSaved, setEmailNotifSaved] = useState(false);

  async function saveEmailNotif(newValue: boolean) {
    setEmailNotifSaving(true);
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setEmailNotifSaving(false);
      setEmailNotifSaved(true);
      setTimeout(() => setEmailNotifSaved(false), 2000);
      return;
    }
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailNotifications: newValue }),
    });
    setEmailNotifSaving(false);
    if (res.ok) {
      setEmailNotifSaved(true);
      setTimeout(() => setEmailNotifSaved(false), 2000);
    }
  }

  // ── Employees ───────────────────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [confirmDeleteEmployee, setConfirmDeleteEmployee] = useState<Employee | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteErrorId, setDeleteErrorId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [isManager, setIsManager] = useState(false);
  const [weeklyHours, setWeeklyHours] = useState<Record<number, { open: number; close: number }>>(DEFAULT_STORE_HOURS);

  type Template = { id: number; name: string; rowCount: number };
  const [templates, setTemplates] = useState<Template[]>([]);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [applyDateInput, setApplyDateInput] = useState<Record<number, string>>({});
  const [applyError, setApplyError] = useState<Record<number, string | null>>({});
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null);

  // ── Initial data fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDemo) {
      supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
    }
    if (!isDemo) {
      fetch("/api/settings")
        .then((r) => r.json())
        .then(({ firstDayOfWeek: fdw, optimalCoverage: oc, minCoverage: mc, timezone: tz, emailNotifications: en }) => {
          if (fdw != null) setFirstDayOfWeek(fdw);
          if (oc  != null) setOptimalCoverage(oc);
          if (mc  != null) setMinCoverage(mc);
          if (tz)          setTimezone(tz);
          if (en  != null) setEmailNotifications(en);
        })
        .catch(() => {});
      fetch("/api/employees")
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((emps: Employee[]) => setEmployees(emps))
        .catch(() => {});
      fetch("/api/me")
        .then((r) => r.json())
        .then(({ isManager: mgr }) => {
          if (mgr != null) setIsManager(mgr);
          if (mgr) {
            fetch("/api/templates")
              .then((r) => r.ok ? r.json() : Promise.reject())
              .then(({ templates: t }) => setTemplates(t ?? []))
              .catch(() => {});
            fetch("/api/store-hours")
              .then((r) => r.ok ? r.json() : Promise.reject())
              .then((data) => setWeeklyHours((prev) => ({ ...prev, ...data })))
              .catch(() => {});
          }
        })
        .catch(() => {});
    }
  }, [isDemo]);

  // ── Employee actions ────────────────────────────────────────────────────────
  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function saveEditName(id: number) {
    const trimmed = editingName.trim();
    if (!trimmed) { setEditError("Name cannot be empty"); return; }
    setEditSaving(true);
    setEditError(null);
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setEmployees((prev) => prev.map((e) => e.id === id ? { ...e, name: trimmed } : e));
      setEditSaving(false);
      setEditingId(null);
      return;
    }
    const res = await fetch("/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: trimmed }),
    });
    setEditSaving(false);
    if (res.ok) {
      setEmployees((prev) => prev.map((e) => e.id === id ? { ...e, name: trimmed } : e));
      setEditingId(null);
    } else {
      const json = await res.json().catch(() => ({}));
      setEditError(json.error ?? "Failed to save");
    }
  }

  async function deleteEmployee(id: number) {
    setConfirmDeleteEmployee(null);
    setDeletingId(id);
    setDeleteErrorId(null);
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 250));
      setDeletingId(null);
      setEmployees((prev) => prev.filter((e) => e.id !== id));
      return;
    }
    const res = await fetch("/api/employees", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setDeletingId(null);
    if (res.ok) {
      setEmployees((prev) => prev.filter((e) => e.id !== id));
    } else {
      setDeleteErrorId(id);
      setTimeout(() => setDeleteErrorId(null), 3000);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-screen">
      {/* Top bar */}
      <div
        className="sticky top-0 z-20 px-4 pb-3 flex items-center gap-3 border-b border-slate-800 bg-bg"
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
          <StoreHoursSection firstDayOfWeek={firstDayOfWeek} isDemo={isDemo} />
        </section>

        {/* Coverage */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Coverage Thresholds
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold text-slate-200">Optimal coverage</div>
                <div className="text-xs text-slate-500 mt-0.5">Minimum staff for green status</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  data-testid="coverage-optimal-minus"
                  onClick={() => stepOptimal(-1)}
                  className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-lg flex items-center justify-center cursor-pointer select-none"
                >
                  −
                </button>
                <span className="text-lg font-bold text-slate-100 w-7 text-center tabular-nums">
                  {optimalCoverage}
                </span>
                <button
                  data-testid="coverage-optimal-plus"
                  onClick={() => stepOptimal(1)}
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
                  data-testid="coverage-min-minus"
                  onClick={() => stepMin(-1)}
                  className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-lg flex items-center justify-center cursor-pointer select-none"
                >
                  −
                </button>
                <span className="text-lg font-bold text-slate-100 w-7 text-center tabular-nums">
                  {minCoverage}
                </span>
                <button
                  data-testid="coverage-min-plus"
                  onClick={() => stepMin(1)}
                  className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-lg flex items-center justify-center cursor-pointer select-none"
                >
                  +
                </button>
              </div>
            </div>

            {coverageValidationError && (
              <div className="text-xs text-red-400" data-testid="coverage-validation-error">
                {coverageValidationError}
              </div>
            )}
            <SaveStatusText status={coverageStatus} testId="coverage-status" />
          </div>
        </section>

        {/* Email Notifications */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Notifications
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-200">Email Notifications</div>
                <div className="text-xs text-slate-500 mt-0.5">Send nightly shift reminders to employees</div>
              </div>
              <button
                role="switch"
                aria-label="Email notifications"
                aria-checked={emailNotifications}
                disabled={emailNotifSaving}
                onClick={() => {
                  const newVal = !emailNotifications;
                  setEmailNotifications(newVal);
                  saveEmailNotif(newVal);
                }}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                  emailNotifications ? "bg-indigo-500" : "bg-slate-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                    emailNotifications ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            {emailNotifSaved && (
              <div className="text-xs text-emerald-400 mt-2 text-right">Saved</div>
            )}
          </div>
        </section>

        {/* Week Start */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Week Start
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
            <div className="flex bg-slate-800 rounded-xl p-[3px]">
              {FIRST_DAY_OPTIONS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => saveFirstDay(value)}
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
            <SaveStatusText status={firstDayStatus} testId="week-start-status" />
          </div>
        </section>

        {/* Timezone */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Timezone
          </div>
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
            <select
              aria-label="Timezone"
              value={timezone}
              onChange={(e) => saveTimezone(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 cursor-pointer"
            >
              {TIMEZONE_OPTIONS.map(({ label, value }) => (
                <option key={value} value={value}>{label} — {value}</option>
              ))}
              {!TIMEZONE_OPTIONS.some((o) => o.value === timezone) && (
                <option value={timezone}>{timezone}</option>
              )}
            </select>
            <SaveStatusText status={timezoneStatus} testId="timezone-status" />
          </div>
        </section>

        {/* Employees */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Employees
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="w-full mb-2 py-3 rounded-2xl bg-transparent border border-dashed border-slate-700 text-slate-400 font-semibold text-sm cursor-pointer hover:border-slate-600 hover:text-slate-300 transition-colors"
          >
            + Add Employee
          </button>
          <div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60">
            {employees.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">No employees</div>
            ) : (
              employees.map((emp) => (
                <div key={emp.id} className="flex flex-col">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="size-8 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-300 shrink-0">
                      {getMonogram(emp.name)}
                    </div>
                    {editingId === emp.id ? (
                      <div className="flex-1 flex flex-col gap-1 min-w-0">
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => { setEditingName(e.target.value); setEditError(null); }}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEditName(emp.id); if (e.key === "Escape") setEditingId(null); }}
                          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5 text-sm text-slate-100"
                        />
                        {editError && <div className="text-xs text-red-400">{editError}</div>}
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-200 truncate">{emp.name}</div>
                        {emp.email && <div className="text-xs text-slate-500 truncate">{emp.email}</div>}
                      </div>
                    )}
                    {editingId === emp.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => saveEditName(emp.id)}
                          disabled={editSaving}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30 cursor-pointer transition-colors"
                        >
                          {editSaving ? "…" : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 border border-slate-600 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => { setEditingId(emp.id); setEditingName(emp.name); setEditError(null); }}
                          className="size-7 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
                          aria-label="Edit name"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        {emp.user_id === currentUserId ? (
                          <span className="text-xs text-slate-600 px-3 py-1.5">You</span>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteEmployee(emp)}
                            disabled={deletingId === emp.id}
                            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                              deleteErrorId === emp.id
                                ? "bg-red-500/20 text-red-300 border-red-500/40"
                                : "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20"
                            }`}
                          >
                            {deletingId === emp.id ? "…" : deleteErrorId === emp.id ? "Error" : "Remove"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {isManager && (
                    <EmployeeAvailabilityRow employeeId={emp.id} storeHours={weeklyHours} />
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Templates — manager only */}
        {isManager && (
          <section>
            <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
              Schedule Templates
            </div>
            <div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60">
              {templates.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">No templates yet</div>
              ) : (
                templates.map((tpl) => (
                  <div key={tpl.id} className="flex flex-col px-4 py-3 gap-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-200">{tpl.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{tpl.rowCount} row{tpl.rowCount !== 1 ? "s" : ""}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setApplyDateInput((prev) => ({ ...prev, [tpl.id]: applyDateInput[tpl.id] ? "" : new Date().toISOString().slice(0, 10) }))}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30 cursor-pointer transition-colors"
                        >
                          Apply
                        </button>
                        <button
                          onClick={async () => {
                            setDeletingTemplateId(tpl.id);
                            await fetch(`/api/templates/${tpl.id}`, { method: "DELETE" });
                            setTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
                            setDeletingTemplateId(null);
                          }}
                          disabled={deletingTemplateId === tpl.id}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 cursor-pointer transition-colors disabled:opacity-50"
                        >
                          {deletingTemplateId === tpl.id ? "…" : "Delete"}
                        </button>
                      </div>
                    </div>
                    {applyDateInput[tpl.id] !== undefined && applyDateInput[tpl.id] !== "" && (
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={applyDateInput[tpl.id]}
                          onChange={(e) => setApplyDateInput((prev) => ({ ...prev, [tpl.id]: e.target.value }))}
                          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100 [color-scheme:dark]"
                        />
                        <button
                          disabled={applyingId === tpl.id}
                          onClick={async () => {
                            setApplyingId(tpl.id);
                            setApplyError((prev) => ({ ...prev, [tpl.id]: null }));
                            const res = await fetch(`/api/templates/${tpl.id}/apply`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ weekStartDate: applyDateInput[tpl.id] }),
                            });
                            setApplyingId(null);
                            if (!res.ok) {
                              const { error } = await res.json().catch(() => ({}));
                              setApplyError((prev) => ({ ...prev, [tpl.id]: error ?? "Failed to apply template" }));
                              return;
                            }
                            setApplyDateInput((prev) => ({ ...prev, [tpl.id]: "" }));
                          }}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-pointer disabled:opacity-50"
                        >
                          {applyingId === tpl.id ? "Applying…" : "Confirm"}
                        </button>
                      </div>
                    )}
                    {applyError[tpl.id] && (
                      <div className="text-xs text-red-400">{applyError[tpl.id]}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* Admin */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Admin
          </div>
          <div className="flex flex-col gap-2">
            {isManager && (
              <button
                onClick={() => router.push(isDemo ? "/reports?demo=true" : "/reports")}
                className="w-full py-3 rounded-2xl bg-card border border-slate-800/60 text-sm font-semibold text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
              >
                View Reports
              </button>
            )}
            <button
              onClick={() => router.push(isDemo ? "/admin?demo=true" : "/admin")}
              className="w-full py-3 rounded-2xl bg-card border border-slate-800/60 text-sm font-semibold text-violet-400 hover:bg-violet-500/10 transition-colors cursor-pointer"
            >
              Manage Roles
            </button>
          </div>
        </section>

        {/* Sign out / Sign in */}
        <section className="pb-2">
          {isDemo ? (
            <button
              onClick={() => router.push("/login")}
              className="w-full py-3 rounded-2xl bg-card border border-slate-800/60 text-sm font-semibold text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
            >
              Sign In
            </button>
          ) : (
            <button
              onClick={handleSignOut}
              className="w-full py-3 rounded-2xl bg-card border border-slate-800/60 text-sm font-semibold text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          )}
        </section>
      </div>

      <BottomNav active="team" />

      <InviteSheet
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onSuccess={() => {
          setShowInvite(false);
          if (!isDemo) {
            fetch("/api/employees")
              .then((r) => r.ok ? r.json() : Promise.reject())
              .then(setEmployees)
              .catch(() => {});
          }
        }}
        onSubmit={isDemo
          ? async (name, email) => {
              setEmployees((prev) => [
                ...prev,
                { id: Date.now(), name, email, user_id: null },
              ]);
            }
          : undefined
        }
      />

      {/* Delete confirmation modal */}
      {confirmDeleteEmployee && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setConfirmDeleteEmployee(null)}
        >
          <div
            className="w-full max-w-[440px] bg-card border border-slate-700 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4 flex flex-col items-center text-center gap-3">
              <div className="size-12 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center text-2xl">
                ⚠️
              </div>
              <div>
                <div className="text-base font-bold text-slate-100">Delete {confirmDeleteEmployee.name}?</div>
                <div className="text-sm text-slate-400 mt-1">
                  This will permanently delete their account and all of their shifts. This cannot be undone.
                </div>
              </div>
            </div>
            <div className="flex border-t border-slate-800">
              <button
                onClick={() => setConfirmDeleteEmployee(null)}
                className="flex-1 py-3.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer border-r border-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteEmployee(confirmDeleteEmployee.id)}
                className="flex-1 py-3.5 text-sm font-semibold text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
