"use client";

import { downloadCSV } from "../../lib/csv-download";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { motion } from "framer-motion";
import BottomNav from "../../components/BottomNav";
import AppShell from "../../components/AppShell";
import { useIsDesktop } from "../../hooks/useIsDesktop";

const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
const listItem = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } } };

type DayCount = { date: string; count: number };
type Employee = { id: number; name: string };
type Schedule = { id: number; employeeId: number; date: string; startMinutes: number; endMinutes: number };

type PayrollDay = {
  date: string;
  dayName: string;
  workedHours: number;
  breakHours: number;
  hasIncomplete: boolean;
};

type PayrollWeek = {
  weekStart: string;
  regularHours: number;
  overtimeHours: number;
  breakHours: number;
  totalWorkedHours: number;
  hasIncomplete: boolean;
  days: PayrollDay[];
};

type PayrollEmployee = {
  employeeId: number;
  employeeName: string;
  weeks: PayrollWeek[];
  totalRegularHours: number;
  totalOvertimeHours: number;
  totalBreakHours: number;
  totalWorkedHours: number;
};

type AuditEntry = {
  id: number;
  action: string;
  actorId: string | null;
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function subtractDays(dateStr: string, days: number): string {
  return addDays(dateStr, -days);
}

function toDateKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "UTC" });
}

function getWeekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

function formatWeekLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const startLabel = new Date(weekStart + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const endLabel = new Date(end + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${startLabel} – ${endLabel}`;
}

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function cellClass(count: number, min: number, optimal: number) {
  if (count >= optimal) return "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
  if (count >= min)     return "bg-amber-500/20  text-amber-400  border border-amber-500/30";
  if (count > 0)        return "bg-red-500/20    text-red-400    border border-red-500/30";
  return "bg-slate-800 text-slate-600 border border-slate-700";
}

// ─── Audit helpers ────────────────────────────────────────────────────────────

function auditTitle(entry: AuditEntry): string {
  const m = entry.metadata ?? {};
  const empName  = (m.employeeName as string | null) ?? "Unknown";
  const tgtName  = (m.targetName   as string | null) ?? "Unknown";
  const tplName  = (m.templateName as string | null) ?? "";

  switch (entry.action) {
    case "schedule.create":      return `Created shift for ${empName}`;
    case "schedule.update":      return `Updated shift for ${empName}`;
    case "schedule.delete":      return `Deleted shift for ${empName}`;
    case "schedule.copy":        return `Copied schedule`;
    case "employee.invite":      return `Invited ${empName}`;
    case "employee.reinvite":    return `Resent invite`;
    case "employee.update":      return `Updated employee ${empName}`;
    case "employee.delete":      return `Deleted employee ${empName}`;
    case "time_off.request":     return `Time-off requested`;
    case "time_off.approve":     return `Approved time-off for ${empName}`;
    case "time_off.deny":        return `Denied time-off for ${empName}`;
    case "swap.request":         return `Shift swap requested`;
    case "swap.approve":         return `Approved shift swap`;
    case "swap.deny":            return `Denied shift swap`;
    case "punch.clock_in":       return `Clocked in — ${empName}`;
    case "punch.clock_out":      return `Clocked out — ${empName}`;
    case "punch.break_start":    return `Break started — ${empName}`;
    case "punch.break_end":      return `Break ended — ${empName}`;
    case "punch.correction":     return `Punch correction for ${empName}`;
    case "punch.export":         return `Exported punch records`;
    case "payroll.export":       return `Exported payroll report`;
    case "availability.upsert":  return `Updated availability for ${empName}`;
    case "availability.delete":  return `Removed availability for ${empName}`;
    case "settings.update":      return `Updated app settings`;
    case "store_hours.update":   return `Updated store hours`;
    case "template.create":      return `Created template "${tplName}"`;
    case "template.delete":      return `Deleted template "${tplName}"`;
    case "template.apply":       return `Applied template "${tplName}"`;
    case "manager.promote":      return `Promoted ${tgtName} to manager`;
    case "manager.demote":       return `Demoted ${tgtName} from manager`;
    default:                     return entry.action;
  }
}

function auditDetail(entry: AuditEntry): string | null {
  const m = entry.metadata ?? {};
  const b = entry.before ?? {};
  const a = entry.after ?? {};

  switch (entry.action) {
    case "schedule.create": {
      const date  = m.date as string | null;
      const start = m.startMinutes as number | null;
      const end   = m.endMinutes   as number | null;
      if (date && start != null && end != null)
        return `${date} · ${fmtMins(start)}–${fmtMins(end)}`;
      return null;
    }
    case "schedule.update": {
      const date = m.date as string | null;
      const bs = b.startMinutes as number | null;
      const be = b.endMinutes   as number | null;
      const as_ = a.startMinutes as number | null;
      const ae  = a.endMinutes   as number | null;
      if (bs != null && be != null && as_ != null && ae != null)
        return `${date} · ${fmtMins(bs)}–${fmtMins(be)} to ${fmtMins(as_)}–${fmtMins(ae)}`;
      return date ?? null;
    }
    case "schedule.delete": {
      const date  = m.date as string | null;
      const start = m.startMinutes as number | null;
      const end   = m.endMinutes   as number | null;
      if (date && start != null && end != null)
        return `Was: ${date} · ${fmtMins(start)}–${fmtMins(end)}`;
      return null;
    }
    case "schedule.copy":
      return `${m.fromDate} to ${m.toDate} · ${m.copied} copied, ${m.skipped} skipped`;
    case "employee.invite":
    case "employee.delete":
    case "employee.reinvite":
      return (m.email as string | null) ?? null;
    case "time_off.request":
    case "time_off.approve":
    case "time_off.deny":
      return (m.date as string | null) ?? null;
    case "swap.request":
    case "swap.approve":
    case "swap.deny": {
      const req = m.requesterName as string | null;
      const tgt = m.targetName   as string | null;
      if (req && tgt) return `${req} and ${tgt}`;
      return null;
    }
    case "punch.correction": {
      const pt = m.punchType as string | null;
      const pa = m.punchedAt as string | null;
      if (pt && pa) {
        const time = new Date(pa).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        return `${pt.replace(/_/g, " ")} at ${time}`;
      }
      return null;
    }
    case "punch.export":
      return `${m.from} to ${m.to} · ${m.rowCount} rows`;
    case "payroll.export": {
      const fmtLabel: Record<string, string> = { summary: "Summary CSV", daily: "Daily CSV", "qb-iif": "QuickBooks IIF" };
      return `${m.from} to ${m.to} · ${fmtLabel[m.format as string] ?? m.format} · ${m.employeeCount} employees`;
    }
    case "availability.upsert":
    case "availability.delete":
      return (m.dayName as string | null) ?? null;
    case "settings.update": {
      const keys = m.changedKeys as string[] | null;
      return keys ? keys.join(", ") : null;
    }
    case "store_hours.update":
      return (m.dayName as string | null) ?? null;
    case "template.create":
      return `${m.rowCount} shifts`;
    case "template.apply":
      return `Week of ${m.weekStartDate} · ${m.created} created, ${m.skipped} skipped`;
    default:
      return null;
  }
}

function auditBadgeClass(action: string): string {
  if (action.startsWith("schedule."))    return "text-indigo-400 bg-indigo-500/10";
  if (action.startsWith("employee."))    return "text-violet-400 bg-violet-500/10";
  if (action.startsWith("time_off."))    return "text-amber-400 bg-amber-500/10";
  if (action.startsWith("swap."))        return "text-cyan-400 bg-cyan-500/10";
  if (action.startsWith("punch."))       return "text-emerald-400 bg-emerald-500/10";
  if (action.startsWith("manager."))     return "text-rose-400 bg-rose-500/10";
  if (action.startsWith("template."))    return "text-blue-400 bg-blue-500/10";
  return "text-slate-400 bg-slate-500/10";
}

function auditBadgeLabel(action: string): string {
  const [cat] = action.split(".");
  const map: Record<string, string> = {
    schedule:    "Schedule",
    employee:    "Employee",
    time_off:    "Time Off",
    swap:        "Swap",
    punch:       "Punch",
    manager:     "Manager",
    template:    "Template",
    settings:    "Settings",
    store_hours: "Store",
  };
  return map[cat] ?? cat;
}

function formatAuditTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

const CATEGORIES = [
  { value: "",            label: "All activity" },
  { value: "schedule",    label: "Schedules" },
  { value: "employee",    label: "Employees" },
  { value: "punch",       label: "Punches" },
  { value: "time_off",    label: "Time off" },
  { value: "swap",        label: "Swaps" },
  { value: "manager",     label: "Managers" },
  { value: "template",    label: "Templates" },
  { value: "settings",    label: "Settings" },
  { value: "store_hours", label: "Store hours" },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReportsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const isDemo = searchParams.get("demo") === "true";

  const today = new Date();
  const todayKey = toDateKey(today);

  const [activeTab, setActiveTab] = useState<"coverage" | "activity" | "payroll">("coverage");

  // ── Coverage state ──
  const [loading, setLoading] = useState(true);
  const [coverageDays, setCoverageDays] = useState<DayCount[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [optimalCoverage, setOptimalCoverage] = useState(3);
  const [minCoverage, setMinCoverage] = useState(2);
  const [firstDayOfWeek, setFirstDayOfWeek] = useState(6);
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekSchedules, setWeekSchedules] = useState<Schedule[]>([]);
  const [weekLoading, setWeekLoading] = useState(false);

  // ── Activity log state ──
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFrom, setAuditFrom] = useState(subtractDays(todayKey, 13));
  const [auditTo, setAuditTo] = useState(todayKey);
  const [auditCategory, setAuditCategory] = useState("");
  // pending = what's in the filter inputs before Apply is clicked
  const [pendingFrom, setPendingFrom] = useState(subtractDays(todayKey, 13));
  const [pendingTo, setPendingTo] = useState(todayKey);
  const [pendingCategory, setPendingCategory] = useState("");

  // ── Payroll state ──
  const [payrollFrom, setPayrollFrom] = useState(() => {
    const d = new Date(todayKey + "T12:00:00Z");
    const day = d.getUTCDay();
    // Monday of previous week
    d.setUTCDate(d.getUTCDate() + (day === 0 ? -13 : -6 - (day - 1)));
    return d.toISOString().slice(0, 10);
  });
  const [payrollTo, setPayrollTo] = useState(() => {
    const d = new Date(todayKey + "T12:00:00Z");
    const day = d.getUTCDay();
    // Sunday of previous week
    d.setUTCDate(d.getUTCDate() + (day === 0 ? -7 : -day));
    return d.toISOString().slice(0, 10);
  });
  const [payrollFormat, setPayrollFormat] = useState("summary");
  const [payrollData, setPayrollData] = useState<PayrollEmployee[] | null>(null);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollError, setPayrollError] = useState<string | null>(null);

  const selectedWeekStart = useMemo(() => {
    const base = new Date(todayKey + "T12:00:00Z");
    const dayOfWeek = base.getUTCDay();
    const diff = (dayOfWeek - firstDayOfWeek + 7) % 7;
    const weekBase = addDays(todayKey, -diff);
    return addDays(weekBase, weekOffset * 7);
  }, [todayKey, firstDayOfWeek, weekOffset]);

  // Mutable refs so realtime callbacks always see the latest navigation/filter state
  const selectedWeekStartRef = useRef(selectedWeekStart);
  selectedWeekStartRef.current = selectedWeekStart;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const auditFromRef = useRef(auditFrom);
  auditFromRef.current = auditFrom;
  const auditToRef = useRef(auditTo);
  auditToRef.current = auditTo;
  const auditCategoryRef = useRef(auditCategory);
  auditCategoryRef.current = auditCategory;

  // Supabase Realtime — live updates for schedules, employees, and audit log
  useEffect(() => {
    if (isDemo) return;

    function refetchWeekSchedules() {
      const ws = selectedWeekStartRef.current;
      const weekDates = getWeekDates(ws);
      setWeekLoading(true);
      Promise.allSettled(
        weekDates.map((d) =>
          fetch(`/api/schedules?date=${d}`)
            .then((r) => r.json())
            .then((data: any[]) => data.map((s: any) => ({
              id: s.id, employeeId: s.employeeId, date: s.date,
              startMinutes: s.startMinutes, endMinutes: s.endMinutes,
            })))
        )
      ).then((results) => {
        const all: Schedule[] = [];
        for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
        setWeekSchedules(all);
        setWeekLoading(false);
      });
    }

    function refetchCoverage() {
      const from = subtractDays(todayKey, 27);
      fetch(`/api/reports/coverage?from=${from}&to=${todayKey}`)
        .then((r) => r.json())
        .then(({ days }) => { if (days) setCoverageDays(days); })
        .catch(() => {});
    }

    function refetchEmployees() {
      fetch("/api/employees")
        .then((r) => r.json())
        .then(setEmployees)
        .catch(() => {});
    }

    function handleNewAuditEntry() {
      if (activeTabRef.current !== "activity") return;
      const params = new URLSearchParams({ from: auditFromRef.current, to: auditToRef.current, page: "1" });
      if (auditCategoryRef.current) params.set("category", auditCategoryRef.current);
      fetch(`/api/audit-log?${params}`)
        .then((r) => r.json())
        .then(({ entries, hasMore, total }) => {
          setAuditEntries(entries ?? []);
          setAuditHasMore(hasMore ?? false);
          setAuditPage(1);
          setAuditTotal(total ?? 0);
        })
        .catch(() => {});
    }

    const channel = supabase
      .channel("reports-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () => { refetchWeekSchedules(); refetchCoverage(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, refetchEmployees)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_logs" }, handleNewAuditEntry)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isDemo]);

  // Load coverage data once on mount
  useEffect(() => {
    fetch(`/api/me${isDemo ? "?demo=true" : ""}`)
      .then((r) => r.json())
      .then(({ isManager }) => { if (!isManager) router.replace("/"); })
      .catch(() => {});

    fetch(`/api/employees${isDemo ? "?demo=true" : ""}`)
      .then((r) => r.json())
      .then(setEmployees)
      .catch(() => {});

    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ optimalCoverage: oc, minCoverage: mc, firstDayOfWeek: fdw }) => {
        if (oc != null) setOptimalCoverage(oc);
        if (mc != null) setMinCoverage(mc);
        if (fdw != null) setFirstDayOfWeek(fdw);
      })
      .catch(() => {});

    const from = subtractDays(todayKey, 27);
    fetch(`/api/reports/coverage?from=${from}&to=${todayKey}`)
      .then((r) => r.json())
      .then(({ days }) => { setCoverageDays(days ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Load week schedules when selected week changes
  useEffect(() => {
    const weekDates = getWeekDates(selectedWeekStart);
    setWeekLoading(true);
    Promise.allSettled(
      weekDates.map((d) =>
        fetch(`/api/schedules?date=${d}${isDemo ? "&demo=true" : ""}`)
          .then((r) => r.json())
          .then((data: any[]) => data.map((s: any) => ({
            id: s.id,
            employeeId: s.employeeId,
            date: s.date,
            startMinutes: s.startMinutes,
            endMinutes: s.endMinutes,
          })))
      )
    ).then((results) => {
      const all: Schedule[] = [];
      for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
      setWeekSchedules(all);
      setWeekLoading(false);
    });
  }, [selectedWeekStart]);

  // Load audit log whenever tab opens or committed filters change
  useEffect(() => {
    if (activeTab !== "activity") return;
    fetchAuditPage(1, true);
  }, [activeTab, auditFrom, auditTo, auditCategory]);

  function fetchAuditPage(page: number, replace: boolean) {
    setAuditLoading(true);
    const params = new URLSearchParams({ from: auditFrom, to: auditTo, page: String(page) });
    if (auditCategory) params.set("category", auditCategory);
    fetch(`/api/audit-log?${params}`)
      .then((r) => r.json())
      .then(({ entries, hasMore, total }) => {
        setAuditEntries((prev) => replace ? (entries ?? []) : [...prev, ...(entries ?? [])]);
        setAuditHasMore(hasMore ?? false);
        setAuditPage(page);
        setAuditTotal(total ?? 0);
        setAuditLoading(false);
      })
      .catch(() => setAuditLoading(false));
  }

  function applyFilters() {
    setAuditFrom(pendingFrom);
    setAuditTo(pendingTo);
    setAuditCategory(pendingCategory);
  }

  async function generatePayroll() {
    if (isDemo) {
      setPayrollData([]);
      return;
    }
    setPayrollLoading(true);
    setPayrollError(null);
    try {
      const res = await fetch(`/api/reports/payroll?from=${payrollFrom}&to=${payrollTo}`);
      const json = await res.json();
      if (!res.ok) { setPayrollError(json.error ?? "Failed to generate report"); return; }
      setPayrollData(json.rows ?? []);
    } catch {
      setPayrollError("Network error — please try again");
    } finally {
      setPayrollLoading(false);
    }
  }

  function downloadPayroll() {
    const ext = payrollFormat === "qb-iif" ? "iif" : "csv";
    const a = document.createElement("a");
    a.href = `/api/reports/payroll/export?from=${payrollFrom}&to=${payrollTo}&format=${payrollFormat}`;
    a.download = `payroll_${payrollFrom}_to_${payrollTo}.${ext}`;
    a.click();
  }

  // ── Coverage heatmap data ──
  const heatmapDays = useMemo(() => {
    const from = subtractDays(todayKey, 27);
    return Array.from({ length: 28 }, (_, i) => addDays(from, i));
  }, [todayKey]);

  const coverageMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of coverageDays) m[d.date] = d.count;
    return m;
  }, [coverageDays]);

  const weekDates = useMemo(() => getWeekDates(selectedWeekStart), [selectedWeekStart]);

  const employeeHours = useMemo(() => {
    const map: Record<number, Record<string, number>> = {};
    for (const s of weekSchedules) {
      if (!map[s.employeeId]) map[s.employeeId] = {};
      map[s.employeeId][s.date.slice(0, 10)] =
        (map[s.employeeId][s.date.slice(0, 10)] ?? 0) + (s.endMinutes - s.startMinutes) / 60;
    }
    return map;
  }, [weekSchedules]);

  async function exportCSV() {
    const rows: string[][] = [];
    rows.push(["Employee", ...weekDates.map(formatDateShort), "Total"]);
    for (const emp of employees) {
      const dayHours = weekDates.map((d) => {
        const h = employeeHours[emp.id]?.[d];
        return h !== undefined ? h.toFixed(1) : "0";
      });
      const total = dayHours.reduce((a, b) => a + parseFloat(b), 0).toFixed(1);
      rows.push([emp.name, ...dayHours, total]);
    }
    rows.push(["Coverage", ...weekDates.map((d) => String(coverageMap[d] ?? 0)), ""]);
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    await downloadCSV(blob, `shift-report-${selectedWeekStart}.csv`);
  }

  const isDesktop = useIsDesktop();

  return (
    <AppShell active="reports" isManager>
    <main className={`${isDesktop ? "bg-bg min-h-screen" : "max-w-[480px] mx-auto pb-28 bg-bg min-h-screen"}`}>
      {/* Demo banner */}
      {isDemo && (
        <div className="bg-blue-500/8 border-b border-blue-500/15 px-4 py-1.5 flex items-center justify-between">
          <span className="text-[11px] text-blue-400/80 font-medium">Demo Mode · Changes are not saved</span>
          <a href="/login" className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors">Sign In →</a>
        </div>
      )}

      {/* Top bar */}
      {isDesktop ? (
        <div className="border-b border-slate-800 px-6 py-[14px]">
          <span className="text-xl font-extrabold text-slate-100 tracking-tight">Reports</span>
        </div>
      ) : (
        <div
          className="sticky top-0 z-20 px-4 pb-3 flex items-center gap-3 border-b border-slate-800 bg-bg"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <button
            onClick={() => router.back()}
            className="size-9 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer shrink-0 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span className="text-2xl font-extrabold text-slate-100 tracking-tight">Reports</span>
        </div>
      )}

      {/* Tab bar */}
      <div className={`${isDesktop ? "px-6 max-w-4xl mx-auto" : "px-4"} pt-4 flex gap-2`}>
        {(["coverage", "payroll", "activity"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            aria-pressed={activeTab === tab}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === tab
                ? "bg-indigo-600 text-white"
                : "bg-card border border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            {tab === "coverage" ? "Coverage" : tab === "payroll" ? "Payroll" : "Activity"}
          </button>
        ))}
      </div>

      {/* ── Coverage tab ── */}
      {activeTab === "coverage" && (
        <div className={`${isDesktop ? "px-6 max-w-4xl mx-auto" : "px-4"} pt-5 flex flex-col gap-5`}>
          {/* Coverage heatmap */}
          <section>
            <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
              Coverage — Last 4 Weeks
            </div>
            {loading ? (
              <div role="status" aria-label="Loading coverage heatmap" className="h-28 bg-slate-800 rounded-2xl animate-pulse" />
            ) : (
              <div className="bg-card rounded-2xl border border-slate-800/60 p-3">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {["S","M","T","W","T","F","S"].map((d, i) => (
                    <div key={i} className="text-center text-[10px] text-slate-500 font-semibold">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {heatmapDays.map((day) => {
                    const count = coverageMap[day] ?? 0;
                    const cls = cellClass(count, minCoverage, optimalCoverage);
                    return (
                      <div key={day} className={`rounded-lg py-2 flex flex-col items-center justify-center ${cls}`}>
                        <span className="text-[11px] font-bold tabular-nums">{count}</span>
                        <span className="text-[9px] mt-0.5 opacity-70">
                          {new Date(day + "T12:00:00Z").getUTCDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-3 mt-2 justify-center">
                  {[
                    { label: "Optimal",  cls: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" },
                    { label: "Low",      cls: "bg-amber-500/20 text-amber-400 border border-amber-500/30" },
                    { label: "Critical", cls: "bg-red-500/20 text-red-400 border border-red-500/30" },
                    { label: "None",     cls: "bg-slate-800 text-slate-600 border border-slate-700" },
                  ].map(({ label, cls }) => (
                    <div key={label} className="flex items-center gap-1">
                      <div className={`size-3 rounded ${cls}`} />
                      <span className="text-[10px] text-slate-400">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Week selector + hours table */}
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">
                Hours — {formatWeekLabel(selectedWeekStart)}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setWeekOffset((o) => o - 1)} aria-label="Previous week" className="size-7 rounded-lg bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer hover:bg-slate-800 hover:text-slate-200 transition-colors">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                {weekOffset !== 0 && (
                  <button onClick={() => setWeekOffset(0)} className="text-[11px] text-slate-400 bg-card border border-slate-800 rounded-lg px-2 py-1 cursor-pointer hover:bg-slate-800 hover:text-slate-200 transition-colors">Now</button>
                )}
                <button onClick={() => setWeekOffset((o) => o + 1)} aria-label="Next week" className="size-7 rounded-lg bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer hover:bg-slate-800 hover:text-slate-200 transition-colors">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            </div>

            {weekLoading ? (
              <div role="status" aria-label="Loading hours table" className="h-32 bg-slate-800 rounded-2xl animate-pulse" />
            ) : (
              <div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden">
                <div className="grid grid-cols-[1fr_repeat(7,minmax(0,1fr))_auto] gap-1 px-3 py-2 border-b border-slate-800/60 bg-slate-800/30">
                  <div className="text-[10px] text-slate-500 font-semibold">Employee</div>
                  {weekDates.map((d) => (
                    <div key={d} className="text-[10px] text-slate-500 font-semibold text-center">
                      {new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" })}
                    </div>
                  ))}
                  <div className="text-[10px] text-slate-500 font-semibold text-right">Tot</div>
                </div>
                {employees.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-slate-500">No employees</div>
                ) : (
                  employees.map((emp) => {
                    const total = weekDates.reduce((sum, d) => sum + (employeeHours[emp.id]?.[d] ?? 0), 0);
                    return (
                      <div key={emp.id} className="grid grid-cols-[1fr_repeat(7,minmax(0,1fr))_auto] gap-1 px-3 py-2 border-b border-slate-800/60 last:border-b-0">
                        <div className="text-xs text-slate-200 font-medium truncate">{emp.name.split(" ")[0]}</div>
                        {weekDates.map((d) => {
                          const h = employeeHours[emp.id]?.[d];
                          return (
                            <div key={d} className={`text-center text-[11px] font-semibold tabular-nums rounded px-0.5 ${h ? "text-indigo-300" : "text-slate-700"}`}>
                              {h ? h.toFixed(0) : "-"}
                            </div>
                          );
                        })}
                        <div className="text-right text-[11px] font-bold text-slate-300 tabular-nums">
                          {total > 0 ? total.toFixed(0) : "-"}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </section>

          {/* CSV Export */}
          <section>
            <button
              onClick={exportCSV}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-sm cursor-pointer hover:opacity-90 transition-opacity"
            >
              Export CSV
            </button>
          </section>
        </div>
      )}

      {/* ── Payroll tab ── */}
      {activeTab === "payroll" && (
        <div className="px-4 pt-4 flex flex-col gap-4">
          {/* Controls */}
          <div className="bg-card rounded-2xl border border-slate-800/60 p-3 flex flex-col gap-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="payroll-from" className="text-[10px] text-slate-500 font-semibold uppercase mb-1 block">From</label>
                <input
                  id="payroll-from"
                  type="date"
                  value={payrollFrom}
                  onChange={(e) => setPayrollFrom(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/70 [color-scheme:dark]"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="payroll-to" className="text-[10px] text-slate-500 font-semibold uppercase mb-1 block">To</label>
                <input
                  id="payroll-to"
                  type="date"
                  value={payrollTo}
                  onChange={(e) => setPayrollTo(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/70 [color-scheme:dark]"
                />
              </div>
            </div>
            <div>
              <label htmlFor="payroll-format" className="text-[10px] text-slate-500 font-semibold uppercase mb-1 block">Export Format</label>
              <select
                id="payroll-format"
                value={payrollFormat}
                onChange={(e) => setPayrollFormat(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/70 [color-scheme:dark]"
              >
                <option value="summary">Summary CSV — Universal</option>
                <option value="daily">Daily Detail CSV — QB Online · Gusto · ADP</option>
                <option value="qb-iif">QuickBooks Desktop (.iif)</option>
              </select>
            </div>
            <button
              onClick={generatePayroll}
              disabled={payrollLoading || !payrollFrom || !payrollTo || payrollFrom > payrollTo}
              aria-busy={payrollLoading}
              className="w-full py-2 rounded-xl bg-indigo-600 text-white font-semibold text-sm cursor-pointer hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {payrollLoading ? "Generating…" : "Generate Report"}
            </button>
          </div>

          {payrollError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3 text-sm text-red-400">
              {payrollError}
            </div>
          )}

          {payrollData !== null && payrollData.length === 0 && (
            <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-10 text-center">
              <div className="text-slate-400 text-sm font-medium">No punch records in this period</div>
              <div className="text-slate-600 text-xs mt-1">Employees need to clock in before payroll data is available</div>
            </div>
          )}

          {payrollData !== null && payrollData.length > 0 && (
            <>
              {/* Preview table */}
              <div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-2 border-b border-slate-800/60 bg-slate-800/30">
                  <div className="text-[10px] text-slate-500 font-semibold">Employee</div>
                  <div className="text-[10px] text-slate-500 font-semibold text-right w-9">Reg</div>
                  <div className="text-[10px] text-slate-500 font-semibold text-right w-9">OT</div>
                  <div className="text-[10px] text-slate-500 font-semibold text-right w-9">Brk</div>
                  <div className="text-[10px] text-slate-500 font-semibold text-right w-10">Total</div>
                </div>
                {payrollData.map((emp) => (
                  <div key={emp.employeeId} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-2 border-b border-slate-800/60 last:border-b-0">
                    <div className="text-xs text-slate-200 font-medium truncate flex items-center gap-1">
                      {emp.employeeName.split(" ")[0]}
                      {emp.weeks.some((w) => w.hasIncomplete) && (
                        <span className="text-amber-400 text-[10px]" aria-label="Incomplete punch pair" role="img">⚠</span>
                      )}
                    </div>
                    <div className="text-right text-[11px] font-semibold text-emerald-400 tabular-nums w-9">
                      {emp.totalRegularHours.toFixed(1)}
                    </div>
                    <div className={`text-right text-[11px] font-semibold tabular-nums w-9 ${emp.totalOvertimeHours > 0 ? "text-amber-400" : "text-slate-700"}`}>
                      {emp.totalOvertimeHours > 0 ? emp.totalOvertimeHours.toFixed(1) : "—"}
                    </div>
                    <div className="text-right text-[11px] text-slate-500 tabular-nums w-9">
                      {emp.totalBreakHours.toFixed(1)}
                    </div>
                    <div className="text-right text-[11px] font-bold text-slate-200 tabular-nums w-10">
                      {emp.totalWorkedHours.toFixed(1)}
                    </div>
                  </div>
                ))}
                {/* Totals */}
                {(() => {
                  const reg  = payrollData.reduce((s, e) => s + e.totalRegularHours, 0);
                  const ot   = payrollData.reduce((s, e) => s + e.totalOvertimeHours, 0);
                  const brk  = payrollData.reduce((s, e) => s + e.totalBreakHours, 0);
                  const tot  = payrollData.reduce((s, e) => s + e.totalWorkedHours, 0);
                  return (
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-2 bg-slate-800/40 border-t border-slate-700/60">
                      <div className="text-[10px] text-slate-400 font-bold uppercase">Total</div>
                      <div className="text-right text-[11px] font-bold text-emerald-400 tabular-nums w-9">{reg.toFixed(1)}</div>
                      <div className={`text-right text-[11px] font-bold tabular-nums w-9 ${ot > 0 ? "text-amber-400" : "text-slate-700"}`}>
                        {ot > 0 ? ot.toFixed(1) : "—"}
                      </div>
                      <div className="text-right text-[11px] font-bold text-slate-500 tabular-nums w-9">{brk.toFixed(1)}</div>
                      <div className="text-right text-[11px] font-bold text-white tabular-nums w-10">{tot.toFixed(1)}</div>
                    </div>
                  );
                })()}
              </div>

              {payrollData.some((e) => e.weeks.some((w) => w.hasIncomplete)) && (
                <div className="text-[11px] text-amber-400/80 px-1 leading-snug">
                  <span aria-hidden="true">⚠</span> Some employees have incomplete punch pairs (no clock-out). Those periods are excluded from totals.
                </div>
              )}

              <button
                onClick={downloadPayroll}
                className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-500 text-white font-bold text-sm cursor-pointer hover:opacity-90 transition-opacity"
              >
                {payrollFormat === "qb-iif"
                  ? "Download QuickBooks Desktop (.iif)"
                  : payrollFormat === "daily"
                  ? "Download Daily Detail CSV"
                  : "Download Summary CSV"}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Activity Log tab ── */}
      {activeTab === "activity" && (
        <div className={`${isDesktop ? "px-6 max-w-4xl mx-auto" : "px-4"} pt-4 flex flex-col gap-4`}>
          {/* Filters */}
          <div className="bg-card rounded-2xl border border-slate-800/60 p-3 flex flex-col gap-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="pending-from" className="text-[10px] text-slate-500 font-semibold uppercase mb-1 block">From</label>
                <input
                  id="pending-from"
                  type="date"
                  value={pendingFrom}
                  onChange={(e) => setPendingFrom(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/70 [color-scheme:dark]"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="pending-to" className="text-[10px] text-slate-500 font-semibold uppercase mb-1 block">To</label>
                <input
                  id="pending-to"
                  type="date"
                  value={pendingTo}
                  onChange={(e) => setPendingTo(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/70 [color-scheme:dark]"
                />
              </div>
            </div>
            <div>
              <label htmlFor="pending-category" className="text-[10px] text-slate-500 font-semibold uppercase mb-1 block">Category</label>
              <select
                id="pending-category"
                value={pendingCategory}
                onChange={(e) => setPendingCategory(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/70 [color-scheme:dark]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={applyFilters}
              className="w-full py-2 rounded-xl bg-indigo-600 text-white font-semibold text-sm cursor-pointer hover:bg-indigo-500 transition-colors"
            >
              Apply filters
            </button>
          </div>

          {/* Results */}
          {auditLoading && auditEntries.length === 0 ? (
            <div role="status" aria-label="Loading activity log" className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} aria-hidden="true" className="h-16 bg-slate-800 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : auditEntries.length === 0 ? (
            <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-10 text-center">
              <div className="text-slate-400 text-sm font-medium">No activity in this period</div>
              <div className="text-slate-600 text-xs mt-1">Try expanding the date range or changing the category filter</div>
            </div>
          ) : (
            <>
              <div className="text-[11px] text-slate-500 px-1">
                {auditTotal.toLocaleString()} {auditTotal === 1 ? "event" : "events"} found
              </div>
              <motion.div className="flex flex-col gap-2" variants={listContainer} initial="hidden" animate="show">
                {auditEntries.map((entry) => {
                  const detail = auditDetail(entry);
                  return (
                    <motion.div key={entry.id} variants={listItem} className="bg-card rounded-2xl border border-slate-800/60 px-4 py-3 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${auditBadgeClass(entry.action)}`}>
                          {auditBadgeLabel(entry.action)}
                        </span>
                        <span className="text-[10px] text-slate-500 shrink-0">
                          {formatAuditTime(entry.createdAt)}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-slate-100 leading-snug">
                        {auditTitle(entry)}
                      </div>
                      {detail && (
                        <div className="text-xs text-slate-400">{detail}</div>
                      )}
                      {entry.actorName && (
                        <div className="text-[11px] text-slate-500 mt-0.5">by {entry.actorName}</div>
                      )}
                    </motion.div>
                  );
                })}
              </motion.div>
              {auditHasMore && (
                <button
                  onClick={() => fetchAuditPage(auditPage + 1, false)}
                  disabled={auditLoading}
                  aria-busy={auditLoading}
                  className="w-full py-3 rounded-2xl bg-card border border-slate-800 text-slate-300 font-semibold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 hover:text-slate-200 transition-colors"
                >
                  {auditLoading ? "Loading…" : "Load more"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {!isDesktop && <BottomNav active="reports" />}
    </main>
    </AppShell>
  );
}
