"use client";

// The app's chrome, for the marketing previews: status bar, top bar, nav rail,
// sidebar and bottom tabs, the dashboard's header, stats and coverage
// timeline, and the in-app notification banner. These parts of the app read
// the viewport's size class (tablet:, desk:, wide:) or live data, so they're
// rebuilt here with the app's exact classes for one size each.

import { useId } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Logo, { LogoMark } from "@/components/Logo";
import { MoonIcon, SunIcon, SunriseIcon, WarningIcon } from "@/components/ShiftIcons";
import { AdminIcon, ClockIcon, ReportsIcon, RequestsIcon, ScheduleIcon, SettingsIcon, TeamIcon, WeekGridIcon } from "@/components/SideNav";
import { fmtMinutes, SHIFT_COLORS, type AttendanceStatus } from "@/data/types";
import { targetAt, type CoverageBlock, type LiveCoverageStatus } from "@/lib/coverage";

// ── Status bar (iOS) ────────────────────────────────────────

export function StatusBar({ time }: { time: string }) {
  return (
    <div className="relative flex h-[54px] shrink-0 items-center justify-between bg-bg px-9 pt-1 text-[16px] font-semibold text-slate-100">
      <span className="tabular-nums">{time}</span>
      <span className="absolute left-1/2 top-[11px] h-[34px] w-[122px] -translate-x-1/2 rounded-full bg-black" />
      <span className="flex items-center gap-1.5">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2.5" width="3" height="9.5" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.5c2.2 0 4.2.9 5.7 2.3l1.1-1.1A9.6 9.6 0 0 0 8 1 9.6 9.6 0 0 0 1.2 3.7l1.1 1.1A8.1 8.1 0 0 1 8 2.5Zm0 3c1.4 0 2.6.5 3.6 1.4l1.1-1.1A6.6 6.6 0 0 0 8 4a6.6 6.6 0 0 0-4.7 1.8l1.1 1.1c1-.9 2.2-1.4 3.6-1.4Zm0 3c-.6 0-1.1.2-1.5.6L8 10.6l1.5-1.5c-.4-.4-.9-.6-1.5-.6Z" /></svg>
        <span className="relative ml-0.5 inline-flex h-[13px] w-[26px] items-center rounded-[4px] border border-slate-100/40 p-[2px]">
          <span className="h-full w-[70%] rounded-[2px] bg-slate-100" />
        </span>
      </span>
    </div>
  );
}

// ── Top bar (phones and tablets) ────────────────────────────

const CLOCK_STATUS: Record<AttendanceStatus, { color: string; label: string; live: boolean }> = {
  clocked_in: { color: "#22c55e", label: "Clocked In", live: true },
  on_break: { color: "#f59e0b", label: "On Break", live: true },
  clocked_out: { color: "#94a3b8", label: "Off", live: false },
  not_clocked_in: { color: "#94a3b8", label: "Off", live: false },
};

export function ClockBadge({ status, dot = false }: { status: AttendanceStatus; dot?: boolean }) {
  const s = CLOCK_STATUS[status];
  if (dot) {
    return <span className="block size-2.5 rounded-full" style={{ background: s.color, boxShadow: s.live ? `0 0 6px ${s.color}` : "none" }} />;
  }
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-slate-800/70 bg-card py-1 pl-2 pr-2.5">
      <span className="size-2 shrink-0 rounded-full" style={{ background: s.color, boxShadow: s.live ? `0 0 6px ${s.color}` : "none" }} />
      <span className="whitespace-nowrap text-xs font-semibold leading-none" style={{ color: s.color }}>{s.label}</span>
    </div>
  );
}

export function Bell({ unread = 0 }: { unread?: number }) {
  return (
    <span className="relative flex size-11 items-center justify-center rounded-xl border border-slate-800 bg-card text-slate-400">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 00-5-5.917V4a1 1 0 10-2 0v1.083A6 6 0 006 11v3.159c0 .538-.214 1.055-.595 1.437L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <AnimatePresence>
        {unread > 0 && (
          <motion.span
            key={unread}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
          >
            {unread}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export function Avatar({ initials }: { initials: string }) {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-indigo-500/40 bg-indigo-600/80 text-sm font-bold text-white">
      {initials}
    </span>
  );
}

export function TopBar({ status, initials, unread = 0 }: { status: AttendanceStatus; initials: string; unread?: number }) {
  return (
    <div className="border-b border-slate-800 bg-bg">
      <div className="flex items-center justify-between px-4 pb-3 pt-[14px]">
        <Logo className="h-6" />
        <div className="flex items-center gap-2">
          <ClockBadge status={status} />
          <Bell unread={unread} />
          <Avatar initials={initials} />
        </div>
      </div>
    </div>
  );
}

// ── Navigation ──────────────────────────────────────────────

export type NavKey = "team" | "schedule" | "clock" | "week" | "requests" | "admin" | "reports" | "settings";

/** Phones: the three bottom tabs, pinned to the bottom of the screen. */
export function BottomTabs({ active }: { active: NavKey }) {
  const tabs = [
    { key: "team" as const, label: "Team", icon: <TeamIcon size={22} /> },
    { key: "schedule" as const, label: "Schedule", icon: <ScheduleIcon size={22} /> },
    { key: "clock" as const, label: "Clock", icon: <ClockIcon size={22} /> },
  ];
  const index = tabs.findIndex((t) => t.key === active);
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 border-t border-slate-800/80 bg-bg pb-[30px]">
      <div className="relative flex">
        {index >= 0 && (
          <div className="pointer-events-none absolute top-0 flex h-[2px] justify-center" style={{ width: "33.333%", left: `${index * 33.333}%` }}>
            <div className="h-full w-8 rounded-full" style={{ background: "linear-gradient(90deg, #818cf8, #6366f1)", boxShadow: "0 0 10px #6366f1aa, 0 0 20px #6366f155" }} />
          </div>
        )}
        {tabs.map((t) => (
          <div key={t.key} className={`flex flex-1 flex-col items-center gap-0.5 pb-2 pt-3 ${t.key === active ? "text-slate-100" : "text-slate-500"}`}>
            <span style={t.key === active ? { transform: "scale(1.12)", filter: "drop-shadow(0 0 6px rgba(129,140,248,0.6))" } : undefined}>{t.icon}</span>
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${t.key === active ? "" : "opacity-60"}`}>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const NAV: { key: NavKey; label: string; icon: (size: number) => React.ReactNode }[] = [
  { key: "team", label: "Team", icon: (s) => <TeamIcon size={s} /> },
  { key: "schedule", label: "Schedule", icon: (s) => <ScheduleIcon size={s} /> },
  { key: "clock", label: "Clock", icon: (s) => <ClockIcon size={s} /> },
  { key: "week", label: "Week", icon: (s) => <WeekGridIcon size={s} /> },
  { key: "requests", label: "Requests", icon: (s) => <RequestsIcon size={s} /> },
  { key: "admin", label: "Admin", icon: (s) => <AdminIcon size={s} /> },
  { key: "reports", label: "Reports", icon: (s) => <ReportsIcon size={s} /> },
  { key: "settings", label: "Settings", icon: (s) => <SettingsIcon size={s} /> },
];

/** Tablets: the 72px icon rail. */
export function NavRail({ active, status }: { active: NavKey; status: AttendanceStatus }) {
  return (
    <div className="flex h-full w-[72px] shrink-0 flex-col items-center border-r border-slate-800 bg-bg">
      <span className="mb-2 mt-4"><LogoMark className="size-7" /></span>
      <div className="mb-3 flex h-4 items-center"><ClockBadge status={status} dot /></div>
      <div className="flex w-full flex-1 flex-col items-stretch gap-1 px-2 pb-4">
        {NAV.map((item, i) => (
          <div key={item.key} className="contents">
            {i === 3 && <div className="mx-2 my-1.5 h-px bg-slate-800" />}
            <div className={`relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl py-2 ${item.key === active ? "text-indigo-300" : "text-slate-400"}`}>
              {item.key === active && <div className="absolute inset-0 rounded-xl border border-indigo-500/30 bg-indigo-600/20" />}
              <span className="relative">{item.icon(20)}</span>
              <span className="relative text-[10px] font-semibold leading-none">{item.label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Desktops: the full sidebar. */
export function SideNav({ active, status }: { active: NavKey; status: AttendanceStatus }) {
  const order: NavKey[] = ["team", "schedule", "clock", "week", "requests", "admin", "settings", "reports"];
  return (
    <div className="flex h-full w-[220px] shrink-0 flex-col border-r border-slate-800 bg-bg">
      <div className="flex shrink-0 flex-col items-start gap-2.5 border-b border-slate-800 px-5 py-[18px]">
        <Logo className="h-[22px]" />
        <ClockBadge status={status} />
      </div>
      <div className="flex flex-1 flex-col gap-0.5 px-3 py-4">
        {order.map((key, i) => {
          const item = NAV.find((n) => n.key === key)!;
          const isActive = key === active;
          return (
            <div key={key} className="contents">
              {i === 3 && <div className="my-2 h-px bg-slate-800" />}
              <div className={`relative flex items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-sm font-semibold ${isActive ? "text-indigo-300" : "text-slate-400"}`}>
                {isActive && <div className="absolute inset-0 rounded-xl border border-indigo-500/30 bg-indigo-600/20" />}
                <span className="relative z-10 shrink-0" style={isActive ? { transform: "scale(1.08)" } : undefined}>{item.icon(17)}</span>
                <span className="relative z-10">{item.label}</span>
                {isActive && <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-indigo-400" />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-slate-800 px-3 py-3">
        <div className="flex flex-1 items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400">
          Shortcuts
          <kbd className="rounded border border-slate-700 px-1.5 font-mono text-[11px] text-slate-300">?</kbd>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard header ────────────────────────────────────────

const chevron = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const PREV = "M15 18l-6-6 6-6";
const NEXT = "M9 18l6-6-6-6";

function RoundNav({ d }: { d: string }) {
  return <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-slate-400">{chevron(d)}</span>;
}

/** Phones and tablets: the date row under the top bar. */
export function DateNav({ label }: { label: string }) {
  return (
    <div className="border-b border-slate-800 px-4 py-3">
      <div className="flex items-center justify-between">
        <RoundNav d={PREV} />
        <span className="flex items-center gap-1.5 rounded-xl border border-slate-700/60 bg-slate-800/70 px-4 py-2.5">
          <span className="text-base font-bold tracking-tight text-slate-100">{label}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-blue-500"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <RoundNav d={NEXT} />
      </div>
    </div>
  );
}

/** Desktops: the bar with the date in the middle and the bell and avatar on the right. */
export function DeskHeader({ label, initials, unread = 0 }: { label: string; initials: string; unread?: number }) {
  return (
    <div className="flex items-center gap-6 border-b border-slate-800 bg-bg px-6 py-[14px]">
      <div className="flex flex-1 justify-center">
        <div className="flex items-center gap-4">
          <RoundNav d={PREV} />
          <div className="flex items-center gap-1.5 px-2 text-lg font-extrabold tracking-tight text-slate-100">
            {label}
            <span className="text-[13px] font-normal text-blue-500">▾</span>
          </div>
          <RoundNav d={NEXT} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Bell unread={unread} />
        <Avatar initials={initials} />
      </div>
    </div>
  );
}

/** The dashboard's coverage warning, shown while staffing is below the target. */
export function CoverageAlert({ status, here, className = "" }: { status: LiveCoverageStatus | "closed"; here: number; className?: string }) {
  const config =
    status === "critical"
      ? { message: `Critically below coverage target — ${here} here now`, bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", text: "#f87171" }
      : status === "low"
      ? { message: `Below coverage target — ${here} here now`, bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", text: "#fbbf24" }
      : null;
  return (
    <AnimatePresence initial={false}>
      {config && (
        <motion.div
          key={config.message}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={`overflow-hidden ${className}`}
        >
          <div className="mt-3 flex items-center gap-2 rounded-[10px] px-[14px] py-[10px] text-xs" style={{ background: config.bg, border: `1px solid ${config.border}`, color: config.text }}>
            <WarningIcon size={13} color={config.text} />
            <span>{config.message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Stats ───────────────────────────────────────────────────

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="relative flex-1 overflow-hidden rounded-xl bg-card px-2 py-3 text-center" style={{ border: `1px solid ${color}33` }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}09 0%, transparent 70%)` }} />
      <div className="relative flex items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="text-[28px] font-extrabold leading-none tabular-nums"
            style={{ color }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="relative mt-1 text-[11px] font-medium text-slate-400">{label}</div>
    </div>
  );
}

export function StatTiles({ here, scheduled, off }: { here: number; scheduled: number; off: number }) {
  return (
    <div className="mb-3 flex gap-2">
      <Stat value={here} label="Here Now" color="#22c55e" />
      <Stat value={scheduled} label="Scheduled" color="#818cf8" />
      <Stat value={off} label="Off" color="#94a3b8" />
    </div>
  );
}

export function ShiftLegend() {
  const items = [
    { label: "Opener", color: SHIFT_COLORS.opener, Icon: SunriseIcon },
    { label: "Mid", color: SHIFT_COLORS.mid, Icon: SunIcon },
    { label: "Closer", color: SHIFT_COLORS.closer, Icon: MoonIcon },
  ];
  return (
    <div className="mb-5 flex flex-wrap gap-3 rounded-xl border border-white/[0.05] bg-card px-[14px] py-3" style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
      {items.map(({ label, color, Icon }) => (
        <div key={label} className="flex items-center gap-1.5 rounded-full border border-slate-700/40 bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-400">
          <Icon size={12} color={color} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Coverage timeline ───────────────────────────────────────

// Monotone cubic interpolation in x, as Recharts' "monotone" curves draw it
// (d3's curveMonotoneX, after Steffen 1990).
function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  const f = (v: number) => v.toFixed(1);
  if (n < 3) return pts.map(([x, y], i) => `${i ? "L" : "M"}${f(x)},${f(y)}`).join("");
  const t = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = pts[i][0] - pts[i - 1][0];
    const h1 = pts[i + 1][0] - pts[i][0];
    const s0 = (pts[i][1] - pts[i - 1][1]) / h0;
    const s1 = (pts[i + 1][1] - pts[i][1]) / h1;
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    t[i] = (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  t[0] = (3 * (pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0]) - t[1]) / 2;
  t[n - 1] = (3 * (pts[n - 1][1] - pts[n - 2][1]) / (pts[n - 1][0] - pts[n - 2][0]) - t[n - 2]) / 2;
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = (x1 - x0) / 3;
    d += `C${f(x0 + dx)},${f(y0 + dx * t[i])} ${f(x1 - dx)},${f(y1 - dx * t[i + 1])} ${f(x1)},${f(y1)}`;
  }
  return d;
}

function LegendChip({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-700/40 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400">
      {swatch}
      {label}
    </span>
  );
}

/**
 * The dashboard's coverage timeline: the target (dashed), who's scheduled
 * (blue) and who's clocked in so far (green), every 15 minutes across store
 * hours, with the now line. `width` is the chart's laid-out width in px.
 */
export function CoverageTimeline({
  width,
  open,
  close,
  now,
  curve,
  scheduledAt,
  clockedInAt,
}: {
  width: number;
  open: number;
  close: number;
  /** Minutes since midnight, may be fractional. */
  now: number;
  curve: CoverageBlock[];
  scheduledAt: (minute: number) => number;
  clockedInAt: (minute: number) => number;
}) {
  const id = useId();
  const height = Math.min(300, Math.max(150, width / 3));
  const left = 32;
  const right = 8;
  const top = 28;
  const bottom = 30;
  const minutes: number[] = [];
  for (let m = open; m <= close; m += 15) minutes.push(m);
  const nowMinute = Math.min(Math.max(now, open), close);
  const peak = Math.max(1, ...minutes.map((m) => Math.max(scheduledAt(m), targetAt(curve, Math.min(m, close - 1)))));
  const yStep = peak <= 5 ? 1 : 2;
  const yMax = Math.ceil(peak / yStep) * yStep;
  const x = (m: number) => left + ((m - open) / (close - open)) * (width - left - right);
  const y = (v: number) => top + (1 - v / yMax) * (height - top - bottom);
  const base = y(0);

  const scheduled = minutes.map((m) => [x(m), y(scheduledAt(m))] as [number, number]);
  const actualMinutes = [...minutes.filter((m) => m < nowMinute), nowMinute];
  const actual = actualMinutes.map((m) => [x(m), y(clockedInAt(m))] as [number, number]);
  const targetSteps = minutes.map((m, i) => {
    const v = y(targetAt(curve, Math.min(m, close - 1)));
    return `${i ? "L" : "M"}${x(m).toFixed(1)},${v.toFixed(1)}${i < minutes.length - 1 ? `H${x(minutes[i + 1]).toFixed(1)}` : ""}`;
  }).join("");
  const area = (pts: [number, number][]) => `${monotonePath(pts)}L${pts[pts.length - 1][0].toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z`;
  const ticks: number[] = [];
  for (let m = open; m <= close; m += 240) ticks.push(m);
  const nowX = x(nowMinute);
  const nowY = y(clockedInAt(nowMinute));

  return (
    <div className="mb-4 rounded-2xl bg-card px-[10px] pb-[10px] pt-4" style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
      <div className="mb-3 flex items-center justify-between pl-1.5 pr-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Coverage Timeline</p>
        <div className="flex items-center gap-2">
          <LegendChip swatch={<span className="inline-block h-0.5 w-2.5 rounded-full" style={{ backgroundImage: "repeating-linear-gradient(90deg, #818cf8 0 3px, transparent 3px 5px)" }} />} label="Target" />
          <LegendChip swatch={<span className="inline-block h-0.5 w-2.5 rounded-full bg-blue-500" />} label="Scheduled" />
          <LegendChip swatch={<span className="inline-block h-0.5 w-2.5 rounded-full bg-green-500" />} label="Clocked In" />
        </div>
      </div>
      <div className="relative" style={{ height }}>
        <svg width={width} height={height} className="block overflow-visible">
          <defs>
            <linearGradient id={`${id}cov`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`${id}act`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          {Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, i) => i * yStep).map((v) => (
            <text key={v} x={left - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
          ))}
          {ticks.map((m) => (
            <text key={m} x={x(m)} y={height - 12} textAnchor="middle" fontSize="10" fill="#94a3b8">{fmtMinutes(m)}</text>
          ))}
          <path d={targetSteps} fill="none" stroke="#818cf8" strokeWidth="2" strokeDasharray="5 4" />
          <path d={area(scheduled)} fill={`url(#${id}cov)`} />
          <path d={monotonePath(scheduled)} fill="none" stroke="#3b82f6" strokeWidth="2.5" />
          {actual.length > 1 && (
            <>
              <path d={area(actual)} fill={`url(#${id}act)`} />
              <path d={monotonePath(actual)} fill="none" stroke="#22c55e" strokeWidth="2.5" />
            </>
          )}
          <line x1={nowX} x2={nowX} y1={top} y2={base} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />
          <circle cx={nowX} cy={nowY} r={4} fill="#22c55e" />
          <circle cx={nowX} cy={nowY} r={4} fill="none" stroke="#22c55e" strokeWidth={2}>
            <animate attributeName="r" values="4;10;4" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.8;0;0.8" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </svg>
        <div
          className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-800 px-[7px] py-[2px] text-[11px] font-bold text-slate-200"
          style={{ left: nowX, top: top - 24 }}
        >
          {fmtMinutes(Math.floor(now))}
        </div>
      </div>
    </div>
  );
}

// ── Notifications ───────────────────────────────────────────

/** The in-app banner a manager gets, e.g. for a late clock-in. */
export function InAppBanner({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex w-80 items-start gap-3 rounded-2xl border border-slate-800 bg-card px-4 py-3" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)" }}>
      <span className="mt-0.5 shrink-0"><WarningIcon size={18} color="#fb923c" /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-100">{title}</div>
        <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">{body}</div>
      </div>
      <span className="flex size-6 shrink-0 items-center justify-center text-slate-500">
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
      </span>
    </div>
  );
}
