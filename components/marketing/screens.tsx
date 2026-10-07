"use client";

// Whole app screens for the marketing previews, at the size of the device
// they're drawn on. The data is the sample store (./scene) and a real
// Auto-schedule run (./auto-schedule.json); see those files.

import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import TeamSection from "@/components/TeamSection";
import WeekGrid from "@/components/WeekGrid";
import WeekView from "@/components/WeekView";
import AutoScheduleSummary from "@/components/AutoScheduleSummary";
import { WeekStats } from "@/components/week/WeekInsights";
import { Sparkle } from "@/components/week/WeekHeader";
import { MegaphoneIcon } from "@/components/ShiftIcons";
import SegmentedControl from "@/components/SegmentedControl";
import { TimeCardPanel } from "@/components/TimeCardDrawer";
import { PHONE } from "./frames";
import { DEMO_COVERAGE_DEFAULTS, DEMO_COVERAGE_PROFILES, DEMO_EMPLOYMENT, DEMO_STORE_HOURS } from "@/data/demo-fixtures";
import { fmtElapsed, fmtMinutes, getMonogram, getShiftType, SHIFT_COLORS, type Schedule } from "@/data/types";
import { curveHours, type CoverageBlock } from "@/lib/coverage";
import { addDaysToKey, dateFromKey, dayOfWeekForKey, daysBetweenKeys, formatDateKey } from "@/lib/dates";
import { scheduledHoursForDate } from "@/lib/draft-metrics";
import type { GenerationRun } from "@/lib/scheduler/types";
import { DEFAULT_SCHEDULING_RULES } from "@/lib/scheduling-rules";
import {
  BottomTabs,
  CoverageAlert,
  CoverageTimeline,
  DateNav,
  DeskHeader,
  NavRail,
  ShiftLegend,
  SideNav,
  StatTiles,
  StatusBar,
  TopBar,
} from "./app-chrome";
import {
  MANAGER_ID,
  attendanceAt,
  coverageAt,
  employeeOf,
  hereAt,
  nextShiftAfter,
  punchTime,
  punchesOf,
  shiftFor,
  shiftTypeOf,
  statusAt,
  statusBarTime,
  timecardAt,
  workedAt,
  type Scene,
} from "./scene";

const noop = () => {};
const initialsOf = (scene: Scene, id: number) => getMonogram(employeeOf(scene, id).name);

// ── Team dashboard ──────────────────────────────────────────

export type DashboardSize = "phone" | "tablet" | "desktop";

/**
 * The Team dashboard as the store manager sees it at `t`, laid out for `size`.
 * `pane`: on a desktop, an employee's detail pane is open, so the dashboard
 * makes room for it on the right, as the app does.
 */
export function DashboardScreen({ scene, t, size, unread = 0, pane = false, overlay }: { scene: Scene; t: number; size: DashboardSize; unread?: number; pane?: boolean; overlay?: React.ReactNode }) {
  const now = t / 60;
  const attendance = attendanceAt(scene, t);
  const here = hereAt(scene, t);
  const coverage = coverageAt(scene, t);
  const managerStatus = statusAt(scene, MANAGER_ID, t);
  const managerInitials = initialsOf(scene, MANAGER_ID);
  const working = new Set(scene.shifts.map((s) => s.employeeId));
  const off = scene.employees.filter((e) => !working.has(e.id));
  const byStatus = (...statuses: string[]) => scene.shifts.filter((s) => statuses.includes(attendance[s.employeeId]));
  const dateLabel = formatDateKey(scene.date, { month: "long", day: "numeric", year: "numeric" });

  const sectionProps = {
    employees: scene.employees,
    storeHours: scene.hours,
    nowMinutes: Math.floor(now),
    isToday: true,
    dayKey: scene.date,
    attendanceMap: attendance,
    onSelect: noop,
  };
  const hereNow = byStatus("clocked_in");
  const onBreak = byStatus("on_break");
  const remaining = byStatus("not_clocked_in", "clocked_out");
  const sections = (
    <>
      <TeamSection label="Here Now" count={hereNow.length} schedules={hereNow} {...sectionProps} />
      <TeamSection label="On Break" count={onBreak.length} schedules={onBreak} {...sectionProps} />
      <TeamSection label="Scheduled" count={remaining.length} schedules={remaining} {...sectionProps} />
      <TeamSection label="Off Today" count={off.length} employees={off} nowMinutes={Math.floor(now)} isToday onSelectOff={noop} />
    </>
  );
  const timeline = (width: number) => (
    <CoverageTimeline
      width={width}
      dayKey={scene.date}
      open={scene.hours.open}
      close={scene.hours.close}
      now={Math.floor(now)}
      curve={scene.curve}
      shifts={scene.shifts}
      punches={scene.punches.filter((p) => p.at <= t).map((p) => ({ employeeId: p.employeeId, type: p.type, minute: Math.floor(p.at / 60) }))}
    />
  );
  const overview = (width: number) => (
    <>
      <StatTiles here={here} scheduled={scene.shifts.length} off={off.length} />
      {timeline(width)}
      <ShiftLegend />
    </>
  );

  if (size === "phone") {
    return (
      <div className="relative h-full bg-bg">
        <StatusBar time={statusBarTime(t)} />
        <TopBar status={managerStatus} initials={managerInitials} unread={unread} />
        <DateNav label={dateLabel} />
        {/* Edge to edge on phones, as the app draws it. */}
        <CoverageAlert status={coverage} here={here} />
        <div className="px-4 pt-4">
          {overview(PHONE.width - 52)}
          {sections}
        </div>
        <BottomTabs active="team" />
        {overlay}
      </div>
    );
  }

  if (size === "tablet") {
    return (
      <div className="relative flex h-full flex-col bg-bg">
        <TabletStatusBar t={t} date={scene.date} />
        <div className="flex min-h-0 flex-1">
          <NavRail active="team" status={managerStatus} />
          <div className="min-w-0 flex-1">
            <TopBar status={managerStatus} initials={managerInitials} unread={unread} />
            <DateNav label={dateLabel} />
            <div className="px-6"><CoverageAlert status={coverage} here={here} /></div>
            <div className="px-6 pt-4">
              {overview(679)}
              <div className="grid grid-cols-2 items-start gap-x-6">{sections}</div>
            </div>
          </div>
        </div>
        {overlay}
      </div>
    );
  }

  const button = "mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 py-3 text-sm font-semibold text-slate-300";
  return (
    <div className="relative flex h-full bg-bg">
      <SideNav active="team" status={managerStatus} />
      <div className={`min-w-0 flex-1 ${pane ? "pr-[420px]" : ""}`}>
        <DeskHeader label={dateLabel} initials={managerInitials} unread={unread} />
        <div className="mx-6"><CoverageAlert status={coverage} here={here} /></div>
        <div className="mx-auto grid max-w-[1680px] grid-cols-[minmax(0,1fr)_340px] items-start gap-x-8 px-6 pt-6">
          <div className="col-start-1 row-start-1">{overview(pane ? 360 : 780)}</div>
          <div className="col-start-2 row-start-1 -mt-4">
            <div className="mt-4 w-full rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 py-3 text-center text-sm font-bold text-white">Plan Draft Schedule</div>
            <div className={button}>Team week</div>
            <div className={button}>
              Export CSV
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-slate-500"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
          <div className="col-span-2 col-start-1 row-start-2 mt-2 grid grid-cols-3 items-start gap-x-6">{sections}</div>
        </div>
      </div>
      {overlay}
    </div>
  );
}

/** iPadOS status bar: time and date on the left, battery on the right. */
function TabletStatusBar({ t, date }: { t: number; date: string }) {
  const h = Math.floor(t / 3600) % 24;
  return (
    <div className="flex h-[26px] shrink-0 items-center justify-between bg-bg px-6 text-[13px] font-semibold text-slate-100">
      <span className="tabular-nums">
        {statusBarTime(t)} {h < 12 ? "AM" : "PM"}&nbsp;&nbsp;{formatDateKey(date, { weekday: "short", month: "short", day: "numeric" }).replace(",", "")}
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.5c2.2 0 4.2.9 5.7 2.3l1.1-1.1A9.6 9.6 0 0 0 8 1 9.6 9.6 0 0 0 1.2 3.7l1.1 1.1A8.1 8.1 0 0 1 8 2.5Zm0 3c1.4 0 2.6.5 3.6 1.4l1.1-1.1A6.6 6.6 0 0 0 8 4a6.6 6.6 0 0 0-4.7 1.8l1.1 1.1c1-.9 2.2-1.4 3.6-1.4Zm0 3c-.6 0-1.1.2-1.5.6L8 10.6l1.5-1.5c-.4-.4-.9-.6-1.5-.6Z" /></svg>
        <span className="text-[12px]">84%</span>
        <span className="relative inline-flex h-[12px] w-[24px] items-center rounded-[4px] border border-slate-100/40 p-[2px]">
          <span className="h-full w-[84%] rounded-[2px] bg-slate-100" />
        </span>
      </span>
    </div>
  );
}

// ── Time clock (employee) ───────────────────────────────────

const PUNCH_LABEL = { clock_in: "Clock In", clock_out: "Clock Out", break_start: "Break Start", break_end: "Break End" } as const;
const PUNCH_DOT = { clock_in: "#22c55e", clock_out: "#94a3b8", break_start: "#f59e0b", break_end: "#818cf8" } as const;
const STATUS_STYLE = {
  clocked_in: { label: "Clocked In", color: "#22c55e" },
  on_break: { label: "On Break", color: "#f59e0b" },
  clocked_out: { label: "Clocked Out", color: "#94a3b8" },
  not_clocked_in: { label: "Not Clocked In", color: "#94a3b8" },
} as const;

/**
 * An employee's Clock screen at `t`. `press` animates a tap on the main
 * button; `warning` shows the sheet the app raises for a late clock-in.
 */
export function ClockScreen({
  scene,
  employeeId,
  t,
  press = null,
  warning = false,
}: {
  scene: Scene;
  employeeId: number;
  t: number;
  press?: "clock_in" | "confirm" | "end_shift" | null;
  warning?: boolean;
}) {
  const shift = scene.shifts.find((s) => s.employeeId === employeeId)!;
  const type = shiftTypeOf(scene, shift);
  const color = SHIFT_COLORS[type];
  const status = statusAt(scene, employeeId, t);
  // As on the page, a finished shift reads as not clocked in, with Clock In back.
  const shown = status === "clocked_out" ? "not_clocked_in" : status;
  const punches = punchesOf(scene, employeeId, t);
  const clockIn = punches.find((p) => p.type === "clock_in");
  const lateBy = clockIn ? Math.round((clockIn.at - shift.startMinutes * 60) / 60) : 0;
  const style = STATUS_STYLE[shown];
  const minutesLate = Math.floor((t - shift.startMinutes * 60) / 60);
  const breakFor = shown === "on_break" ? t - punches.at(-1)!.at : 0;
  const pressed = (which: "clock_in" | "confirm" | "end_shift") => (press === which ? { scale: [1, 0.96, 1] } : { scale: 1 });

  return (
    <div className="relative h-full bg-bg">
      <StatusBar time={statusBarTime(t)} />
      <TopBar status={status} initials={initialsOf(scene, employeeId)} />
      <div className="mt-4 space-y-3 px-4">
        <div className="rounded-2xl border border-slate-800/60 bg-card px-4 py-4" style={{ borderLeft: `3px solid ${color}` }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Today&apos;s Shift</span>
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize" style={{ color }}>{type}</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-slate-100">{fmtMinutes(shift.startMinutes)} – {fmtMinutes(shift.endMinutes)}</div>
          {lateBy > 5 && <div className="mt-1 text-xs font-semibold text-[#ef4444]">{lateBy}m late</div>}
        </div>

        <div className="rounded-2xl border border-slate-800/60 bg-card px-4 py-5 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold" style={{ background: `${style.color}22`, color: style.color, border: `1px solid ${style.color}44` }}>
            <span className="size-2 rounded-full" style={{ background: style.color, boxShadow: shown === "clocked_in" ? `0 0 6px ${style.color}` : "none" }} />
            {style.label}
          </div>
          {shown === "on_break" ? (
            <>
              <div className="font-mono text-4xl font-extrabold tabular-nums" style={{ color: STATUS_STYLE.on_break.color }}>{fmtElapsed(breakFor)}</div>
              <div className="mt-1 text-xs text-slate-400">Current break duration</div>
              <div className="mt-3 border-t border-slate-800/60 pt-3">
                <div className="font-mono text-xl font-bold tabular-nums text-slate-500">{fmtElapsed(workedAt(scene, employeeId, t))}</div>
                <div className="mt-0.5 text-xs text-slate-500">Total time worked today</div>
              </div>
            </>
          ) : shown === "clocked_in" ? (
            <>
              <div className="font-mono text-4xl font-extrabold tabular-nums text-slate-100">{fmtElapsed(workedAt(scene, employeeId, t))}</div>
              <div className="mt-1 text-xs text-slate-400">Total time worked today</div>
            </>
          ) : null}
        </div>

        <div className="grid gap-3">
          {shown === "not_clocked_in" && (
            <motion.div animate={pressed("clock_in")} transition={{ duration: 0.3 }} className="w-full rounded-2xl bg-green-500 py-4 text-center text-lg font-extrabold text-white shadow-lg shadow-green-500/20">
              Clock In
            </motion.div>
          )}
          {shown === "clocked_in" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/20 py-4 text-center text-base font-bold text-amber-400">Start Break</div>
              <motion.div animate={pressed("end_shift")} transition={{ duration: 0.3 }} className="rounded-2xl border border-slate-600 bg-slate-700 py-4 text-center text-base font-bold text-slate-200">
                End Shift
              </motion.div>
            </div>
          )}
          {shown === "on_break" && (
            <div className="w-full rounded-2xl bg-amber-500 py-4 text-center text-lg font-extrabold text-white shadow-lg shadow-amber-500/20">End Break</div>
          )}
        </div>

        {/* The page offers a call-out only before clocking in for the day. */}
        {!clockIn && (
          <div className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-800/60 bg-card px-4 py-3.5 text-sm font-semibold text-slate-300">
            <MegaphoneIcon size={15} color="#94a3b8" />
            Can&apos;t make it in today? Call out
          </div>
        )}

        {punches.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-400">Today&apos;s Punches</div>
            <div className="divide-y divide-slate-800 rounded-2xl border border-slate-800/60 bg-card">
              {punches.map((p) => (
                <motion.div key={`${p.type}-${p.at}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: PUNCH_DOT[p.type] }} />
                    <span className="text-sm font-medium text-slate-200">{PUNCH_LABEL[p.type]}</span>
                  </div>
                  <div className="text-sm tabular-nums text-slate-300">{punchTime(p.at)}</div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {["Report Missed Punch", "Export Timesheet"].map((label) => (
          <div key={label} className="flex items-center justify-between rounded-2xl border border-slate-800/60 bg-card px-4 py-3.5">
            <span className="text-sm font-semibold text-slate-300">{label}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-slate-500"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        ))}
      </div>
      <BottomTabs active="clock" />

      <AnimatePresence>
        {warning && (
          <motion.div key="late" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 300 }}
              className="w-full space-y-4 rounded-t-3xl border border-slate-700 bg-card px-6 pb-10 pt-6"
            >
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-600" />
              <div className="text-center">
                <div className="mb-1 text-2xl">⏰</div>
                <div className="text-lg font-extrabold text-slate-100">Late Clock-In</div>
                <div className="mt-1 text-sm text-slate-400">Your shift started at {fmtMinutes(shift.startMinutes)}. You&apos;re clocking in {minutesLate} min late.</div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="rounded-2xl border border-slate-700 bg-slate-800 py-3.5 text-center text-sm font-bold text-slate-300">Cancel</div>
                <motion.div animate={pressed("confirm")} transition={{ duration: 0.3 }} className="rounded-2xl border border-green-500/30 bg-green-500/20 py-3.5 text-center text-sm font-bold text-green-400">
                  Clock In Anyway
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Time card (manager, desktop) ────────────────────────────

/**
 * The manager's dashboard on a desktop with an employee's time card open over
 * it, as the app opens it: the last 14 days of punches with hours and flags,
 * in the app's own time card panel. `open` slides it in; `scrolled` scrolls it
 * down to the latest days.
 */
export function TimeCardScreen({ scene, employeeId, t, open, scrolled }: { scene: Scene; employeeId: number; t: number; open: boolean; scrolled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const card = useMemo(() => timecardAt(scene, employeeId, t), [scene, employeeId, t]);
  useEffect(() => {
    const body = ref.current?.querySelector<HTMLElement>('[data-testid="timecard-body"]');
    body?.scrollTo({ top: scrolled ? body.scrollHeight : 0, behavior: scrolled ? "smooth" : "auto" });
  }, [scrolled]);
  return (
    <div ref={ref} className="relative h-full">
      {/* The manager opened it from the employee's detail pane, which is under it. */}
      <DashboardScreen scene={scene} t={t} size="desktop" pane />
      {/* The drawer's backdrop and panel, as components/TimeCardDrawer.tsx draws them. */}
      <div className={`absolute inset-0 z-[60] bg-black/60 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} />
      <div
        className={`absolute inset-y-0 right-0 z-[70] flex w-full max-w-[560px] flex-col border-l border-slate-800 bg-bg transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <TimeCardPanel
          employee={{ id: employeeId, name: employeeOf(scene, employeeId).name }}
          from={card.from}
          to={card.to}
          onFromChange={noop}
          onToChange={noop}
          onApply={noop}
          onClose={noop}
          onExport={noop}
          data={card}
          loading={false}
          error={null}
        />
      </div>
    </div>
  );
}

// ── My schedule (employee) ──────────────────────────────────

const SHIFT_TYPE_LABELS = { opener: "Early Shift", mid: "Mid Shift", closer: "Closing Shift" } as const;

/**
 * An employee's Schedule screen: their next shift, this week, and the day
 * they've picked with its swap (and, for today or tomorrow, call-out) button.
 * `swapSheet` opens the coworker picker that button leads to.
 */
export function ScheduleScreen({
  scene,
  employeeId,
  week,
  selected,
  t,
  swapSheet = false,
}: {
  scene: Scene;
  employeeId: number;
  /** The seven dates of the week shown, from the store's first day of the week. */
  week: string[];
  /** The day picked in the week strip. */
  selected: string;
  t: number;
  swapSheet?: boolean;
}) {
  const schedules = week.map((d) => shiftFor(employeeId, d)).filter((s): s is Schedule => s !== null);
  const upcoming = nextShiftAfter(employeeId, scene.date)!;
  const pick = shiftFor(employeeId, selected);
  const hours = DEMO_STORE_HOURS[dayOfWeekForKey(selected)];
  const type = pick ? getShiftType(pick.startMinutes, pick.endMinutes, hours.open, hours.close) : null;
  const color = type ? SHIFT_COLORS[type] : null;
  const isTomorrow = selected === addDaysToKey(scene.date, 1);
  const daysUntil = daysBetweenKeys(scene.date, upcoming.date);
  const totalHours = schedules.reduce((sum, s) => sum + (s.endMinutes - s.startMinutes) / 60, 0);
  const first = employeeOf(scene, employeeId).name.split(" ")[0];
  const arrow = (d: string) => (
    <span className="flex size-11 items-center justify-center rounded-xl border border-slate-800 bg-card text-slate-400">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );

  return (
    <div className="relative h-full bg-bg">
      <StatusBar time={statusBarTime(t)} />
      <TopBar status={statusAt(scene, employeeId, t)} initials={initialsOf(scene, employeeId)} />
      {/* As the page lays it out: a column of three blocks, so margins collapse
          inside each block but not between them. */}
      <div className="flex flex-col px-4 pt-4">
        <div>
          <div className="mb-4 rounded-2xl border border-slate-800/60 bg-card px-4 py-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Next Shift</div>
            <div className="text-sm font-semibold text-slate-300">
              {daysUntil === 1 ? "Tomorrow" : formatDateKey(upcoming.date, { weekday: "long", month: "long", day: "numeric" })}
            </div>
            <div className="mt-1 text-2xl font-extrabold text-slate-100">{fmtMinutes(upcoming.startMinutes)} – {fmtMinutes(upcoming.endMinutes)}</div>
            {daysUntil > 1 && <div className="mt-1 text-xs text-slate-400">in {daysUntil} days</div>}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-1 flex items-start justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">My Schedule</div>
              <div className="mt-0.5 text-[28px] font-extrabold leading-tight text-slate-100">{first}</div>
            </div>
            <div className="relative mt-1 flex rounded-xl bg-card p-[3px]">
              <span className="relative rounded-[9px] bg-slate-700 px-4 py-3 text-sm font-semibold text-slate-50" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)" }}>Week</span>
              <span className="px-4 py-3 text-sm font-semibold text-slate-500">Month</span>
            </div>
          </div>
          <div className="mb-4 mt-5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 rounded-xl border border-slate-700/60 bg-slate-800/70 px-4 py-2.5">
              <span className="text-base font-bold tracking-tight text-slate-100">
                {formatDateKey(week[0], { month: "short", day: "numeric" })} – {formatDateKey(week[6], { month: "short", day: "numeric", year: "numeric" })}
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-blue-500"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <div className="flex items-center gap-2">
              {arrow("M15 18l-6-6 6-6")}
              {arrow("M9 18l6-6-6-6")}
            </div>
          </div>
          <WeekView
            schedules={schedules}
            weeklyHours={DEMO_STORE_HOURS}
            firstDayOfWeek={dateFromKey(week[0]).getDay()}
            selectedDate={dateFromKey(selected)}
            weekStart={dateFromKey(week[0])}
            onSelectDate={noop}
            today={dateFromKey(scene.date)}
          />
        </div>

        <div className="min-w-0">
          <div className="mb-3 mt-1 rounded-2xl border border-slate-800/60 bg-card px-4 py-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm text-slate-400">
                {selected === scene.date ? "Today" : formatDateKey(selected, { weekday: "long", month: "short", day: "numeric" })}
              </span>
              {type && color && <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ color }}>{SHIFT_TYPE_LABELS[type]}</span>}
            </div>
            {pick ? (
              <>
                <div className="mt-1 text-2xl font-bold text-slate-100">{fmtMinutes(pick.startMinutes)} – {fmtMinutes(pick.endMinutes)}</div>
                <div className="mt-0.5 text-sm text-slate-400">{(pick.endMinutes - pick.startMinutes) / 60} hrs</div>
                {isTomorrow && (
                  <div className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 py-2.5 text-sm font-semibold text-red-300">
                    <MegaphoneIcon size={15} color="rgb(248 113 113)" />
                    Can&apos;t make this shift? Call out
                  </div>
                )}
                <div className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/30 py-2.5 text-sm font-semibold text-indigo-300">
                  <span>⇄</span>
                  Request Shift Swap
                </div>
              </>
            ) : (
              <div className="mt-1 text-2xl font-bold text-slate-400">Day Off</div>
            )}
          </div>

          <div className="flex gap-2">
            {[
              { value: schedules.length, label: "Shifts this week" },
              { value: Math.round(totalHours), label: "Hours" },
              { value: 7 - schedules.length, label: "Days off" },
            ].map((s) => (
              <div key={s.label} className="flex-1 rounded-2xl border border-slate-800/60 bg-card px-3 py-4">
                <div className="text-3xl font-extrabold text-indigo-400">{s.value}</div>
                <div className="mt-1 text-xs text-slate-400">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <BottomTabs active="schedule" />
      {swapSheet && pick && <SwapSheet scene={scene} employeeId={employeeId} shift={pick} dayLabel={selected === scene.date ? "Today" : formatDateKey(selected, { weekday: "long", month: "short", day: "numeric" })} />}
    </div>
  );
}

/** The coworker picker for a shift swap: everyone else working that day. */
function SwapSheet({ scene, employeeId, shift, dayLabel }: { scene: Scene; employeeId: number; shift: Schedule; dayLabel: string }) {
  const coworkers = scene.employees
    .filter((e) => e.id !== employeeId)
    .map((e) => shiftFor(e.id, shift.date))
    .filter((s): s is Schedule => s !== null)
    .sort((a, b) => a.startMinutes - b.startMinutes || a.employeeId - b.employeeId);
  return (
    <div className="absolute inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-slate-800 bg-bg">
        <div className="flex justify-center pb-1 pt-3"><div className="h-1 w-10 rounded-full bg-slate-700" /></div>
        <div className="px-6 pb-11 pt-2">
          <div className="mb-1 flex items-start justify-between">
            <div>
              <div className="text-lg font-bold text-slate-100">Request a Swap</div>
              <div className="mt-0.5 text-xs text-slate-400">{dayLabel} · your shift {fmtMinutes(shift.startMinutes)} – {fmtMinutes(shift.endMinutes)}</div>
            </div>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-400">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
            </span>
          </div>
          <div className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Pick a coworker to swap with</div>
          <div className="flex flex-col gap-2">
            {coworkers.map((c) => {
              const name = employeeOf(scene, c.employeeId).name;
              return (
                <div key={c.employeeId} className="flex w-full items-center gap-3 rounded-2xl border border-slate-800/60 bg-card px-4 py-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-indigo-500/30 bg-indigo-600/70 text-xs font-bold text-white">{getMonogram(name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-100">{name}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{fmtMinutes(c.startMinutes)} – {fmtMinutes(c.endMinutes)}</div>
                  </div>
                  <span className="shrink-0 text-base text-slate-600">⇄</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Requests (manager) ──────────────────────────────────────

/** A pending time-off request, opened from the manager's Requests inbox, with that day's schedule. */
export function RequestScreen({ scene, employeeId, date, note, pending, t }: { scene: Scene; employeeId: number; date: string; note: string; pending: number; t: number }) {
  const name = employeeOf(scene, employeeId).name;
  const day = scene.employees
    .map((e) => shiftFor(e.id, date))
    .filter((s): s is Schedule => s !== null)
    .sort((a, b) => a.startMinutes - b.startMinutes || a.employeeId - b.employeeId)
    .map((s) => ({ name: employeeOf(scene, s.employeeId).name, start: s.startMinutes, end: s.endMinutes }));
  const shortDate = formatDateKey(date, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="relative h-full bg-bg">
      <StatusBar time={statusBarTime(t)} />
      <div className="flex items-center gap-3 border-b border-slate-800 bg-bg px-4 pb-3 pt-[14px]">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-card text-slate-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <div className="flex-1 text-xl font-extrabold tracking-tight text-slate-100">
          Requests
          <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 align-middle text-xs font-bold tabular-nums text-amber-400">{pending}</span>
        </div>
      </div>
      <div className="px-4 pt-4">
        <div className="flex flex-col gap-5 rounded-2xl border border-slate-800 bg-card p-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#a78bfa]">Time off</div>
            <div className="mt-1 text-lg font-extrabold text-slate-100">{name}</div>
          </div>
          <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-800/40 px-3.5 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Day</div>
            <div className="text-sm font-semibold text-slate-100">{formatDateKey(date, { weekday: "long", month: "long", day: "numeric" })}</div>
          </div>
          <div className="rounded-xl border-l-2 border-slate-600 bg-slate-800/30 px-4 py-3 text-sm text-slate-300">&ldquo;{note}&rdquo;</div>
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              On the schedule {shortDate}
              <span className="ml-1 normal-case tracking-normal text-slate-400">· {day.length} shifts</span>
            </div>
            <div className="flex flex-col gap-1">
              {day.map((s) => (
                <div key={s.name} className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${s.name === name ? "bg-amber-500/10 font-semibold text-amber-300" : "text-slate-300"}`}>
                  <span className="truncate">{s.name}</span>
                  <span className="text-xs tabular-nums">{fmtMinutes(s.start)} – {fmtMinutes(s.end)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1 rounded-xl border border-red-500/25 bg-red-500/10 py-3 text-center text-sm font-bold text-red-400">Deny</div>
            <div className="flex-1 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 py-3 text-center text-sm font-bold text-white">Approve</div>
          </div>
        </div>
      </div>
      <BottomTabs active="requests" />
    </div>
  );
}

// ── Week page, Draft mode (desktop) ─────────────────────────

export type DraftWeek = {
  dates: string[];
  curves: Record<string, CoverageBlock[]>;
  /** Tagged as drafts, as the Week page tags them, so the grid shows them as Auto drafts. */
  drafts: (Schedule & { generationRunId: number | null; source: "draft" })[];
  timeOff: { id: number; employeeId: number; date: string; status: "pending" }[];
  run: GenerationRun;
};

export type AutoSchedulePhase = "empty" | "sheet" | "generating" | "done";

/**
 * The Week page in Draft mode for next week, on a desktop, at one step of an
 * Auto-schedule run as the page goes through it: the empty week, the setup
 * sheet, "Generating…", then the drafted week with the run's summary.
 * `press` taps the empty week's Auto-schedule button or the sheet's Generate.
 */
export function WeekDraftScreen({
  scene,
  week,
  phase,
  press = null,
}: {
  scene: Scene;
  week: DraftWeek;
  phase: AutoSchedulePhase;
  press?: "auto" | "generate" | null;
}) {
  const drafts = phase === "done" ? week.drafts : [];
  const label = `${formatDateKey(week.dates[0], { month: "short", day: "numeric" })} – ${formatDateKey(week.dates[6], { month: "short", day: "numeric", year: "numeric" })}`;
  const day = week.dates[0];
  const scheduled = Math.round(scheduledHoursForDate(drafts, day) * 10) / 10;
  const budget = Math.round(curveHours(week.curves[day] ?? []) * 10) / 10;
  const variance = Math.round((scheduled - budget) * 10) / 10;
  const defaultProfile = DEMO_COVERAGE_PROFILES.find((p) => p.id === DEMO_COVERAGE_DEFAULTS[dayOfWeekForKey(day)])?.name ?? "none";
  const navButton = "flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-card text-slate-400";
  const chevron = (d: string) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  const tap = (which: "auto" | "generate") => (press === which ? { scale: [1, 0.95, 1] } : { scale: 1 });

  return (
    <div className="relative flex h-full bg-bg">
      <SideNav active="week" status={statusAt(scene, MANAGER_ID, scene.late.at)} />
      <div className="min-w-0 flex-1 overflow-hidden">
        {/* Header: the week, Live | Draft, Auto-schedule and Publish */}
        <div className="border-b border-slate-800 bg-bg px-6 pb-[14px] pt-[14px]">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Week</div>
              <div className="text-xl font-extrabold tabular-nums tracking-tight text-slate-100">{label}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={navButton}>{chevron("M15 18l-6-6 6-6")}</span>
              <span className="flex h-10 items-center whitespace-nowrap rounded-xl border border-slate-800 bg-card px-3.5 text-sm font-semibold text-slate-200">This week</span>
              <span className={navButton}>{chevron("M9 18l6-6-6-6")}</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2.5">
            <div className="flex shrink-0 gap-[3px] rounded-xl border border-slate-800 bg-card p-[3px]">
              <span className="flex min-h-10 items-center gap-1.5 rounded-[9px] px-3 text-sm font-semibold text-slate-400">
                <span className="size-1.5 rounded-full bg-slate-600" />
                Live
              </span>
              <span className="flex min-h-10 items-center gap-1.5 rounded-[9px] bg-slate-800 px-3 text-sm font-semibold text-slate-50 shadow">
                <span className="size-1.5 rounded-full bg-amber-400" />
                Draft
                {drafts.length > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 text-[11px] font-bold tabular-nums text-amber-400">{drafts.length}</span>
                )}
              </span>
            </div>
            <p className="min-w-0 flex-1 text-xs text-slate-400">Private until you publish. Live shifts stay as they are.</p>
            <div className="flex items-center gap-2">
              <span className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-violet-500/35 bg-violet-500/15 px-3.5 text-xs font-bold text-violet-200">
                <Sparkle />
                Auto-schedule
              </span>
              <span className={`flex min-h-10 items-center rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-4 text-xs font-bold text-white ${drafts.length ? "" : "opacity-40"}`}>
                Publish ({drafts.length})
              </span>
            </div>
          </div>
        </div>

        {phase === "done" ? (
          <AutoScheduleSummary run={week.run} employees={scene.employees} busy={null} error={null} onUndo={noop} onTryAnother={noop} onApplySuggestion={noop} onDismiss={noop} />
        ) : (
          <div className="mx-6 mt-3 flex items-center gap-3 rounded-2xl border border-violet-500/25 bg-violet-500/[0.06] px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-100">No drafts for this week yet</div>
              <div className="mt-0.5 text-xs text-slate-400">
                Auto-schedule drafts the week from your coverage targets, availability, time off and hours, around the shifts already live. You review it before anything is published.
              </div>
            </div>
            <motion.span
              animate={tap("auto")}
              transition={{ duration: 0.3 }}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-violet-500/35 bg-violet-500/20 px-3.5 py-2.5 text-xs font-bold text-violet-100"
            >
              <Sparkle />
              Auto-schedule
            </motion.span>
          </div>
        )}

        <div className="px-6 pt-4">
          <div className="mb-4">
            <WeekStats shifts={drafts} dates={week.dates} curves={week.curves} loading={false} />
          </div>
          <section className="mb-3 flex flex-row items-center gap-3">
            <div className="whitespace-nowrap text-sm font-bold text-slate-100">{formatDateKey(day, { weekday: "long", month: "short", day: "numeric" })}</div>
            <div className="flex max-w-sm flex-1 items-center gap-2 rounded-xl border border-slate-800/60 bg-card px-3 py-2">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Coverage</span>
              {/* A real <select>, as on the page: the browser draws it, at the app's 16px minimum. */}
              <select
                defaultValue=""
                aria-label="Coverage profile for selected day"
                className="min-h-9 min-w-0 flex-1 cursor-pointer rounded-lg border border-slate-700 bg-bg px-2 py-1.5 text-xs text-slate-100 transition-colors focus:border-indigo-500/70 focus:outline-none"
              >
                <option value="">Default ({defaultProfile})</option>
              </select>
            </div>
            <div className="ml-auto flex gap-2">
              {[
                { label: "Scheduled", value: `${scheduled} hrs`, color: "#3b82f6" },
                { label: "Budget", value: `${budget} hrs`, color: "#818cf8" },
                { label: "Variance", value: `${variance > 0 ? "+" : ""}${variance} hrs`, color: variance > 0 ? "#f87171" : variance < 0 ? "#fbbf24" : "#22c55e" },
              ].map(({ label: l, value, color }) => (
                <div key={l} className="min-w-[92px] rounded-xl border border-slate-800/60 bg-card px-2 py-2 text-center">
                  <div className="text-xs font-bold tabular-nums" style={{ color }}>{value}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-500">{l}</div>
                </div>
              ))}
            </div>
          </section>
          <WeekGrid
            employees={scene.employees}
            schedules={drafts}
            dates={week.dates}
            weeklyHours={DEMO_STORE_HOURS}
            todayKey={scene.date}
            mode="draft"
            timeOff={week.timeOff}
            onSelect={noop}
            selectedDate={day}
            onSelectDate={noop}
          />
        </div>
      </div>

      <AnimatePresence>
        {(phase === "sheet" || phase === "generating") && (
          <AutoScheduleSheet key="sheet" week={week} label={label} generating={phase === "generating"} tap={tap("generate")} />
        )}
      </AnimatePresence>
    </div>
  );
}

const RULES = DEFAULT_SCHEDULING_RULES;
const UNTYPED = Object.values(DEMO_EMPLOYMENT).filter((e) => !e.type).length;

function Check({ ok, children }: { ok: true | "warn"; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className={`mt-px flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${ok === true ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
        {ok === true ? "✓" : "!"}
      </span>
      <div className="min-w-0 flex-1 text-slate-300">{children}</div>
    </li>
  );
}

/**
 * The Week page's Auto-schedule sheet as it opens on a desktop for an empty
 * week: the readiness checks, this week's rules (the store's defaults) and
 * Generate. `generating` is the wait while the run is made.
 */
function AutoScheduleSheet({ week, label, generating, tap }: { week: DraftWeek; label: string; generating: boolean; tap: { scale: number | number[] } }) {
  const pending = week.timeOff.length;
  const allTargets = week.dates.every((d) => (week.curves[d] ?? []).some((b) => b.headcount > 0));
  const heading = "mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400";
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 z-[60] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="flex max-h-[88%] w-full max-w-[560px] flex-col overflow-hidden rounded-3xl border border-slate-700 bg-card"
        style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <div className="text-lg font-bold text-slate-100">Auto-schedule</div>
            <div className="text-xs tabular-nums text-slate-400">{label}</div>
          </div>
          <span className={`flex size-10 items-center justify-center rounded-full bg-slate-800 text-slate-400 ${generating ? "opacity-50" : ""}`}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          <section>
            <div className={heading}>Before you start</div>
            <ul className="flex flex-col gap-2">
              <Check ok={allTargets ? true : "warn"}>Coverage targets set for every day</Check>
              {UNTYPED === 0 ? (
                <Check ok>Everyone is set as full-time or part-time</Check>
              ) : (
                <Check ok="warn">
                  {UNTYPED} {UNTYPED === 1 ? "person has" : "people have"} no employment type and will be scheduled as part-time.{" "}
                  <span className="inline-block py-1 font-semibold text-indigo-400">Set them now</span>
                </Check>
              )}
              <Check ok={pending === 0 ? true : "warn"}>
                {pending === 0 ? "No pending time-off requests this week" : `${pending} pending time-off request${pending === 1 ? "" : "s"} this week (approved time off is always respected)`}
              </Check>
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Rules for this week</div>
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-semibold text-slate-300">Overtime</div>
              <SegmentedControl ariaLabel="Overtime" value={RULES.overtimePolicy} onChange={noop} options={[{ value: "never", label: "Never" }, { value: "when_needed", label: "To fill gaps" }]} />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-semibold text-slate-300">Pending time off</div>
              <SegmentedControl ariaLabel="Pending time off" value={RULES.pendingTimeOff} onChange={noop} options={[{ value: "avoid", label: "Avoid those days" }, { value: "ignore", label: "Ignore" }]} />
            </div>
            <div className="text-[11px] text-slate-500">
              Shifts {RULES.minShiftMinutes / 60}–{RULES.maxShiftMinutes / 60} h · {RULES.minRestMinutes / 60} h rest · up to {RULES.maxConsecutiveDays} days in a row.{" "}
              <span className="font-semibold text-indigo-400">Change in Settings</span>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">This week only</div>
            <div className="flex flex-wrap gap-1.5">
              {["+ Extra people", "+ Keep someone off", "+ Someone's hours"].map((l) => (
                <span key={l} className="flex min-h-9 items-center rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-semibold text-slate-300">{l}</span>
              ))}
            </div>
          </section>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 px-5 py-4">
          <span className={`flex-1 rounded-xl border border-slate-700 bg-slate-800 py-3 text-center text-sm font-semibold text-slate-300 ${generating ? "opacity-50" : ""}`}>Cancel</span>
          <motion.span
            animate={tap}
            transition={{ duration: 0.3 }}
            className={`flex-[2] rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 py-3 text-center text-sm font-bold text-white ${generating ? "opacity-40" : ""}`}
          >
            {generating ? "Generating…" : "Generate Schedule"}
          </motion.span>
        </div>
      </motion.div>
    </motion.div>
  );
}
