"use client";

// Animated product previews for the marketing pages. Everything here mirrors
// something the real app does live — punches arriving over realtime, the clock
// ticking, approvals clearing — never decoration. Timers only run while the
// preview is on screen, and visitors who prefer reduced motion get the static
// first frame.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useInView, useReducedMotion } from "framer-motion";
import { EMPLOYEE_PATTERNS, DEMO_EMPLOYEES } from "@/data/demo-fixtures";
import { MegaphoneIcon, ShiftIcon } from "@/components/ShiftIcons";
import { fmtMinutes, getMonogram, getShiftType, SHIFT_COLORS } from "@/data/types";
import { addDays, fmtDayShort, fmtLong, fmtRange, nextWeekday, startOfWeek, useToday } from "./dates";
import {
  CLOSE,
  DAY_OF_WEEK,
  NOW,
  OFF_TODAY,
  OPEN,
  ROSTER,
  SAMPLES,
  BUDGET_HOURS,
  TARGET_BY_HOUR,
  WEEK_LABELS,
  scheduledAt,
  shortTime,
  type Row,
} from "./data";
import { BottomNav, ChartCard, Chip, LegendPill, Phone, SectionLabel, ShiftCard, StatTiles } from "./ui";

// ── Shared hooks ────────────────────────────────────────────

/** Seconds elapsed while `ref` is in view (paused off screen and for reduced motion). */
function useTicker(ref: React.RefObject<Element | null>) {
  const inView = useInView(ref, { margin: "-10% 0px" });
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!inView || reduced) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [inView, reduced]);
  return tick;
}

const START_SECONDS = NOW * 60; // 1:30:00 PM

function clockLabel(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")}`;
}

function duration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

/** A number that pops when it changes. */
function Count({ value }: { value: number }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={value}
        className="inline-block"
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -10, opacity: 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      >
        {value}
      </motion.span>
    </AnimatePresence>
  );
}

// ── Live roster model ───────────────────────────────────────

type LiveRow = Row & { inAt: number | null };

const INITIAL_ROSTER: LiveRow[] = ROSTER.map((r) => ({
  ...r,
  inAt: r.attendance === "clocked_in" || r.attendance === "on_break" ? r.start : null,
}));

// What happens on the floor after the page loads, in seconds from first view.
const EVENTS: { at: number; id: number; to: Row["attendance"]; title: string }[] = [
  { at: 3, id: 8, to: "clocked_in", title: "clocked in" },
  { at: 11, id: 11, to: "clocked_in", title: "clocked in early" },
];

function useLiveRoster(tick: number) {
  const now = NOW + Math.floor(tick / 60);
  const roster = INITIAL_ROSTER.map((r) => {
    const ev = EVENTS.filter((e) => e.id === r.id && e.at <= tick).at(-1);
    if (!ev) return r;
    return { ...r, attendance: ev.to, inAt: r.inAt ?? now };
  });
  const latest = EVENTS.filter((e) => e.at <= tick && tick - e.at < 4).at(-1);
  const toast = latest
    ? { key: latest.at, name: roster.find((r) => r.id === latest.id)!.name, title: latest.title, time: fmtMinutes(NOW + Math.floor(latest.at / 60)) }
    : null;
  return { roster, now, toast };
}

const isHereRow = (r: LiveRow) => r.attendance === "clocked_in" || r.attendance === "on_break";

// ── Coverage timeline ───────────────────────────────────────

export function LiveCoverageTimeline({ roster = INITIAL_ROSTER, now = NOW }: { roster?: LiveRow[]; now?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const W = 340;
  const H = 120;
  const PAD_L = 18;
  const PAD_B = 18;
  const max = 12;
  const x = (m: number) => PAD_L + ((m - OPEN) / (CLOSE - OPEN)) * (W - PAD_L - 4);
  const y = (v: number) => 6 + (1 - v / max) * (H - PAD_B - 6);
  const base = y(0);
  const clockedAt = (m: number) => roster.filter((r) => r.inAt !== null && m >= r.inAt && m < r.end && isHereRow(r)).length;

  const sched = SAMPLES.map((m) => [x(m), y(scheduledAt(m))] as const);
  const actual = [...SAMPLES.filter((m) => m < now), now].map((m) => [x(m), y(clockedAt(m))] as const);
  const line = (pts: readonly (readonly [number, number])[]) => pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
  const area = (pts: readonly (readonly [number, number])[]) => `${line(pts)}L${pts[pts.length - 1][0].toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z`;
  const nowX = x(now);
  const nowY = y(clockedAt(now));
  const draw = { initial: { pathLength: 0 }, animate: { pathLength: inView ? 1 : 0 }, transition: { duration: 1.4, ease: "easeInOut" as const } };

  return (
    <div ref={ref} className="rounded-2xl bg-card px-2.5 pb-2.5 pt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 pl-1.5 pr-1">
        <p className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Coverage Timeline</p>
        <div className="flex items-center gap-1.5">
          <LegendPill color="bg-blue-500" label="Scheduled" />
          <LegendPill color="bg-green-500" label="Clocked In" />
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Coverage timeline: ${clockedAt(now)} clocked in of ${scheduledAt(now)} scheduled at ${fmtMinutes(now)}`}>
          <defs>
            <linearGradient id="lpCov" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="lpAct" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 4, 8].map((v) => (
            <text key={v} x={PAD_L - 6} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#94a3b8">{v}</text>
          ))}
          {[360, 600, 840, 1080, 1320].map((m) => (
            <text key={m} x={x(m)} y={H - 4} textAnchor={m === OPEN ? "start" : m === CLOSE ? "end" : "middle"} fontSize="8" fill="#94a3b8">
              {fmtMinutes(m).replace(":00", "")}
            </text>
          ))}
          <motion.path d={area(sched)} fill="url(#lpCov)" initial={{ opacity: 0 }} animate={{ opacity: inView ? 1 : 0 }} transition={{ duration: 0.8, delay: 0.6 }} />
          <motion.path d={line(sched)} fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinejoin="round" {...draw} />
          <motion.path d={area(actual)} fill="url(#lpAct)" initial={{ opacity: 0 }} animate={{ opacity: inView ? 1 : 0 }} transition={{ duration: 0.8, delay: 0.9 }} />
          <motion.path d={line(actual)} fill="none" stroke="#22c55e" strokeWidth="1.8" strokeLinejoin="round" {...draw} transition={{ ...draw.transition, delay: 0.3 }} />
          <line x1={nowX} x2={nowX} y1={14} y2={base} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 2.5" />
          <motion.circle cx={nowX} r={3} fill="#22c55e" animate={{ cy: nowY }} transition={{ type: "spring", stiffness: 200, damping: 20 }} />
          <motion.circle cx={nowX} r={3} fill="none" stroke="#22c55e" strokeWidth={1.5} animate={{ cy: nowY }}>
            <animate attributeName="r" values="3;7;3" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.8;0;0.8" dur="1.5s" repeatCount="indefinite" />
          </motion.circle>
        </svg>
        <span
          className="absolute -top-1 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-800 px-[6px] py-[1px] text-[10px] font-bold tabular-nums text-slate-200"
          style={{ left: `${(nowX / W) * 100}%` }}
        >
          {fmtMinutes(now)}
        </span>
      </div>
    </div>
  );
}

// ── Team (manager dashboard) ───────────────────────────────

function Toast({ toast }: { toast: { key: number; name: string; title: string; time: string } | null }) {
  return (
    <div className="pointer-events-none">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.key}
            initial={{ y: -24, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -24, opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-card px-4 py-3 shadow-xl shadow-black/40"
          >
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-100">{toast.name} {toast.title}</div>
              <div className="mt-0.5 text-xs text-slate-400">{toast.time} · Northside store</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function LiveTeamPhone() {
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTicker(ref);
  const { roster, now, toast } = useLiveRoster(tick);
  const here = roster.filter(isHereRow);
  const notHere = roster.filter((r) => !isHereRow(r));

  return (
    <div ref={ref}>
      <Phone label="Manager coverage dashboard, updating live" time={clockLabel(START_SECONDS + tick)} overlay={<Toast toast={toast} />}>
        <div className="px-4 pt-4">
          <StatTiles here={<Count value={here.length} />} scheduled={roster.length} off={OFF_TODAY.length} />
          <div className="mt-3"><LiveCoverageTimeline roster={roster} now={now} /></div>
          <SectionLabel label="Here Now" count={here.length} />
          <AnimatePresence initial={false}>
            {here.slice(-2).map((r) => (
              <motion.div key={r.id} layout layoutId={`team-${r.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}>
                <ShiftCard row={r} now={now} />
              </motion.div>
            ))}
          </AnimatePresence>
          {notHere.length > 0 && <SectionLabel label="Scheduled" count={notHere.length} />}
          <AnimatePresence initial={false}>
            {notHere.map((r) => (
              <motion.div key={r.id} layout layoutId={`team-${r.id}`} transition={{ type: "spring", stiffness: 380, damping: 34 }}>
                <ShiftCard row={r} now={now} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <BottomNav active="Team" />
      </Phone>
    </div>
  );
}

/** Compact coverage card for the home page: stat tiles + timeline, updating live. */
export function LiveCoverageCard() {
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTicker(ref);
  const { roster, now } = useLiveRoster(tick);
  return (
    <div ref={ref} className="space-y-3">
      <StatTiles here={<Count value={roster.filter(isHereRow).length} />} scheduled={roster.length} off={OFF_TODAY.length} />
      <LiveCoverageTimeline roster={roster} now={now} />
    </div>
  );
}

/** Coverage section preview: tiles, timeline and the late/upcoming cards resolving live. */
export function LiveCoveragePanel() {
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTicker(ref);
  const { roster, now } = useLiveRoster(tick);
  const watch = roster.filter((r) => r.id === 8 || r.id === 11);
  return (
    <div ref={ref} className="rounded-2xl border border-slate-800 bg-bg p-3 shadow-2xl shadow-black/30 sm:p-4">
      <StatTiles here={<Count value={roster.filter(isHereRow).length} />} scheduled={roster.length} off={OFF_TODAY.length} />
      <div className="mt-3"><LiveCoverageTimeline roster={roster} now={now} /></div>
      <div className="mt-1">
        {watch.map((r) => (
          <motion.div key={r.id} layout>
            <ShiftCard row={r} now={now} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Clock (employee) ────────────────────────────────────────

const JAMIE_SHIFT = EMPLOYEE_PATTERNS[9][DAY_OF_WEEK]!;
const WORKED_START = (NOW - JAMIE_SHIFT[0]) * 60 + 12;

type ClockState = { worked: number; onBreak: boolean; breakFor: number; punches: { label: string; at: number; color: string }[] };

/** Advances the employee clock one second; starts and ends a break on a loop. */
function stepClock(s: ClockState, tick: number, loop: boolean): ClockState {
  const phase = tick % 20;
  const wall = START_SECONDS + tick;
  if (loop && phase === 6 && !s.onBreak) {
    return { ...s, onBreak: true, breakFor: 0, punches: [...s.punches, { label: "Break Start", at: wall, color: "bg-amber-400" }].slice(-3) };
  }
  if (loop && phase === 16 && s.onBreak) {
    return { ...s, onBreak: false, punches: [...s.punches, { label: "Break End", at: wall, color: "bg-green-500" }].slice(-3) };
  }
  return s.onBreak ? { ...s, breakFor: s.breakFor + 1 } : { ...s, worked: s.worked + 1 };
}

function useClock(tick: number, loop: boolean) {
  const [state, setState] = useState<ClockState>({
    worked: WORKED_START,
    onBreak: false,
    breakFor: 0,
    punches: [{ label: "Clock In", at: (JAMIE_SHIFT[0] - 1) * 60, color: "bg-green-500" }],
  });
  const last = useRef(0);
  useEffect(() => {
    if (tick === last.current) return;
    last.current = tick;
    setState((s) => stepClock(s, tick, loop));
  }, [tick, loop]);
  return state;
}

function wallTime(sec: number) {
  return fmtMinutes(Math.floor(sec / 60));
}

export function LiveClockPhone({ loopBreaks = true, label = "Employee clock screen, ticking live" }: { loopBreaks?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTicker(ref);
  const s = useClock(tick, loopBreaks);
  const type = getShiftType(JAMIE_SHIFT[0], JAMIE_SHIFT[1], OPEN, CLOSE) ?? "opener";
  const color = SHIFT_COLORS[type];

  return (
    <div ref={ref}>
      <Phone label={label} time={clockLabel(START_SECONDS + tick)}>
        <div className="space-y-3 px-4 pt-4">
          <div className="rounded-2xl border border-white/[0.08] bg-card px-5 py-4" style={{ borderLeft: `3px solid ${color}` }}>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-slate-400">Today&rsquo;s Shift</span>
              <span className="text-[13px] font-semibold capitalize" style={{ color }}>{type}</span>
            </div>
            <div className="mt-1.5 text-[26px] font-bold text-slate-100">{fmtMinutes(JAMIE_SHIFT[0])} – {fmtMinutes(JAMIE_SHIFT[1])}</div>
            <div className="mt-1 text-[13px] font-semibold text-green-500">On time</div>
          </div>

          <div className="flex flex-col items-center rounded-2xl border border-slate-800 bg-card py-6">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={s.onBreak ? "break" : "in"}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
                className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-[15px] font-semibold ${s.onBreak ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-green-500/30 bg-green-500/10 text-green-500"}`}
              >
                <span className="relative flex h-2 w-2">
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${s.onBreak ? "bg-amber-400" : "bg-green-400"}`} />
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${s.onBreak ? "bg-amber-400" : "bg-green-500"}`} />
                </span>
                {s.onBreak ? "On Break" : "Clocked In"}
              </motion.span>
            </AnimatePresence>
            <div className="mt-4 font-mono text-[40px] font-bold tracking-tight text-slate-100 tabular-nums">
              {s.onBreak ? duration(s.breakFor) : duration(s.worked)}
            </div>
            <div className="mt-1 text-[13px] text-slate-400">{s.onBreak ? "Break time" : "Total time worked today"}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <motion.span
              key={s.onBreak ? "end" : "start"}
              initial={{ scale: 0.94 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 18 }}
              className="rounded-2xl border border-amber-500/40 bg-amber-500/15 py-5 text-center text-[17px] font-bold text-amber-400"
            >
              {s.onBreak ? "End Break" : "Start Break"}
            </motion.span>
            <span className="rounded-2xl border border-slate-600/60 bg-slate-700/60 py-5 text-center text-[17px] font-bold text-slate-200">End Shift</span>
          </div>

          <div className="pt-2 text-[12px] font-bold uppercase tracking-[0.1em] text-slate-400">Today&rsquo;s Punches</div>
          <AnimatePresence initial={false}>
            {s.punches.map((p) => (
              <motion.div
                key={`${p.label}-${p.at}`}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center justify-between rounded-2xl border border-slate-800 bg-card px-5 py-3.5 text-[15px]"
              >
                <span className="flex items-center gap-3 text-slate-200"><span className={`h-2.5 w-2.5 rounded-full ${p.color}`} />{p.label}</span>
                <span className="tabular-nums text-slate-400">{wallTime(p.at)}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <BottomNav active="Clock" />
      </Phone>
    </div>
  );
}

/** Home-page tile: the clocked-in card with a ticking timer. */
export function LiveTimerCard() {
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTicker(ref);
  const s = useClock(tick, false);
  return (
    <div ref={ref} className="flex flex-col items-center rounded-2xl border border-slate-800 bg-card py-6">
      <span className="flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-3.5 py-1 text-[13px] font-semibold text-green-500">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        Clocked In
      </span>
      <div className="mt-3 font-mono text-[30px] font-bold tracking-tight text-slate-100 tabular-nums">{duration(s.worked)}</div>
      <div className="mt-1 text-[12px] text-slate-400">Total time worked today</div>
      <div className="mt-5 w-full border-t border-slate-800 px-5 pt-3.5">
        <div className="flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-2.5 text-slate-300"><span className="h-2 w-2 rounded-full bg-green-500" />Clock In</span>
          <span className="tabular-nums text-slate-400">{fmtMinutes(JAMIE_SHIFT[0] - 1)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Requests (manager approvals) ────────────────────────────

type Req =
  | { id: string; kind: "timeoff"; name: string; date: Date; note: string }
  | { id: string; kind: "swap"; a: string; b: string; date: Date; aTime: string; bTime: string };

const CASEY = EMPLOYEE_PATTERNS[2][4]!;
const MORGAN = EMPLOYEE_PATTERNS[5][4]!;
// Request dates are relative to the visitor's today: time off a couple of weeks
// out, and the swap on the next Thursday (a day Casey and Morgan both work).
function buildRequests(today: Date): Req[] {
  return [
    { id: "t1", kind: "timeoff", name: "Riley Chen", date: addDays(today, 11), note: "Sister's wedding" },
    { id: "t2", kind: "timeoff", name: "Avery Johnson", date: addDays(today, 16), note: "Dentist" },
    { id: "s1", kind: "swap", a: "Casey Lewis", b: "Morgan Brooks", date: nextWeekday(addDays(today, 3), 4), aTime: `${fmtMinutes(CASEY[0])} – ${fmtMinutes(CASEY[1])}`, bTime: `${fmtMinutes(MORGAN[0])} – ${fmtMinutes(MORGAN[1])}` },
  ];
}

/** Deterministic stand-in used until the client knows today's date (kept invisible). */
const REFERENCE_DAY = new Date(2026, 0, 3);

const CYCLE = 16;

export function LiveRequestsPhone() {
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTicker(ref);
  const today = useToday();
  const REQUESTS = buildRequests(today ?? REFERENCE_DAY);
  const hide = today ? "transition-opacity duration-300" : "opacity-0";
  const phase = tick % CYCLE;
  // Approve one request every 3s starting at 3s, hold "all caught up", then refill.
  const approved = phase < 3 ? 0 : Math.min(REQUESTS.length, Math.floor((phase - 3) / 3) + 1);
  const pressing = phase >= 2 && phase < 11 && (phase - 2) % 3 === 0 ? REQUESTS[approved]?.id : undefined;
  const pending = REQUESTS.slice(approved);
  const timeOff = pending.filter((r) => r.kind === "timeoff");
  const swaps = pending.filter((r) => r.kind === "swap");

  const approve = "flex-1 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 py-3.5 text-center text-xs font-bold text-white";
  const deny = "flex-1 rounded-xl border border-slate-700 py-3.5 text-center text-xs font-semibold text-red-400";
  const Buttons = ({ id }: { id: string }) => (
    <div className="flex gap-2">
      <motion.span className={approve} animate={pressing === id ? { scale: [1, 0.94, 1] } : { scale: 1 }} transition={{ duration: 0.35 }}>Approve</motion.span>
      <span className={deny}>Deny</span>
    </div>
  );
  const exit = { opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.35 } };

  return (
    <div ref={ref}>
      <Phone label="Manager requests inbox, approving live" time={clockLabel(START_SECONDS + tick)}>
        <div className="px-4 pt-4">
          <div className="mb-6">
            <div className="text-lg font-bold text-slate-100">Requests</div>
            <div className="mt-0.5 text-xs text-slate-400">
              {pending.length === 0 ? "No pending requests" : <><Count value={pending.length} /> awaiting approval</>}
            </div>
          </div>
          <AnimatePresence initial={false}>
            {timeOff.length > 0 && (
              <motion.div key="to-label" exit={exit}><SectionLabel label="Time Off" count={timeOff.length} /></motion.div>
            )}
            {timeOff.map((t) => t.kind === "timeoff" && (
              <motion.div key={t.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={exit} className="mb-2 overflow-hidden rounded-2xl border border-slate-800/60 bg-card px-4 py-3">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-indigo-500/30 bg-indigo-600/70 text-xs font-bold text-white">{getMonogram(t.name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-100">{t.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                      <span className="h-2 w-2 rounded-full bg-amber-400" />
                      <span className={hide}>{fmtDayShort(t.date)}</span>
                      <span className="truncate text-slate-500">· &ldquo;{t.note}&rdquo;</span>
                    </div>
                  </div>
                </div>
                <Buttons id={t.id} />
              </motion.div>
            ))}
            {swaps.length > 0 && (
              <motion.div key="sw-label" layout exit={exit} className="pt-2"><SectionLabel label="Shift Swaps" count={swaps.length} /></motion.div>
            )}
            {swaps.map((sw) => sw.kind === "swap" && (
              <motion.div key={sw.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={exit} className="overflow-hidden rounded-2xl border border-slate-800/60 bg-card px-4 py-4">
                <div className="mb-1 text-sm font-semibold text-slate-100">{sw.a} wants to swap with {sw.b}</div>
                <div className={`mb-1 text-xs text-slate-400 ${hide}`}>{fmtLong(sw.date)}</div>
                <div className="mb-3 flex items-center gap-1.5 whitespace-nowrap text-[10.5px] text-slate-400">
                  <span className="rounded-lg bg-slate-800 px-2 py-1">{sw.a.split(" ")[0]}: {sw.aTime}</span>
                  <span className="text-slate-600" aria-hidden="true">⇄</span>
                  <span className="rounded-lg bg-slate-800 px-2 py-1">{sw.b.split(" ")[0]}: {sw.bTime}</span>
                </div>
                <Buttons id={sw.id} />
              </motion.div>
            ))}
            {pending.length === 0 && (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-16 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-green-500/15 text-green-500">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <div className="mt-3 text-sm font-semibold text-slate-200">All caught up</div>
                <div className="mt-1 text-xs text-slate-400">Everyone&rsquo;s been notified.</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <BottomNav active="Team" />
      </Phone>
    </div>
  );
}

// ── Planner charts (draw in on scroll) ─────────────────────

export function PlannerPreview() {
  const today = useToday();
  const nextSunday = addDays(startOfWeek(today ?? REFERENCE_DAY), 7);
  const scheduledHours = WEEK_LABELS.map((_, dow) =>
    DEMO_EMPLOYEES.reduce((sum, e) => {
      const s = EMPLOYEE_PATTERNS[e.id]?.[dow];
      return s ? sum + (s[1] - s[0]) / 60 : sum;
    }, 0)
  );
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-bg shadow-2xl shadow-black/30">
      <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3 sm:px-5">
        <div>
          <div className="text-[15px] font-bold text-slate-100">Draft Schedule</div>
          <div className="text-[12px] text-slate-400">
            <span className={today ? "transition-opacity duration-300" : "opacity-0"}>{fmtRange(nextSunday, addDays(nextSunday, 6))}</span> · Not published
          </div>
        </div>
        <span className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-500 px-3.5 py-2 text-[12px] font-bold text-white">Publish</span>
      </div>
      <div className="grid gap-3 p-3 sm:p-4 md:grid-cols-2">
        <HourlyCoverageChart />
        <BudgetChart scheduled={scheduledHours} />
      </div>
    </div>
  );
}

function HourlyCoverageChart() {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const W = 260;
  const H = 130;
  const L = 16;
  const B = 16;
  const max = 12;
  const x = (i: number) => L + (i / TARGET_BY_HOUR.length) * (W - L - 4);
  const y = (v: number) => 6 + (1 - v / max) * (H - B - 6);
  const step = (vals: number[]) =>
    vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}H${x(i + 1).toFixed(1)}`).join("");
  const sched = TARGET_BY_HOUR.map((_, i) => scheduledAt(OPEN + i * 60 + 30));
  const area = `${step(sched)}V${y(0)}H${x(0)}Z`;
  return (
    <ChartCard
      title="Coverage · Sat by hour"
      legend={<>
        <Chip swatch={<span className="inline-block w-2.5 border-t-2 border-dashed border-[#818cf8]" />} label="Recommended" />
        <Chip swatch={<span className="inline-block h-0.5 w-2.5 rounded-full bg-blue-500" />} label="Scheduled" />
      </>}
    >
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Saturday recommended staffing versus scheduled staffing by hour">
        <defs>
          <linearGradient id="lpDraft" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity="0.35" />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 4, 8].map((v) => <text key={v} x={L - 5} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#94a3b8">{v}</text>)}
        {[0, 4, 8, 12].map((i) => (
          <text key={i} x={x(i)} y={H - 3} textAnchor={i === 0 ? "start" : "middle"} fontSize="8" fill="#94a3b8">{fmtMinutes(OPEN + i * 60).replace(":00", "")}</text>
        ))}
        <motion.path d={area} fill="url(#lpDraft)" initial={{ opacity: 0 }} animate={{ opacity: inView ? 1 : 0 }} transition={{ duration: 0.8, delay: 0.8 }} />
        <motion.path d={step(sched)} fill="none" stroke="#3b82f6" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: inView ? 1 : 0 }} transition={{ duration: 1.4, ease: "easeInOut" }} />
        <motion.path d={step(TARGET_BY_HOUR)} fill="none" stroke="#818cf8" strokeWidth="1.6" strokeDasharray="4 3" initial={{ opacity: 0 }} animate={{ opacity: inView ? 1 : 0 }} transition={{ duration: 0.6, delay: 0.3 }} />
      </svg>
    </ChartCard>
  );
}

function BudgetChart({ scheduled }: { scheduled: number[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const W = 260;
  const H = 130;
  const L = 16;
  const B = 16;
  const max = 90;
  const col = (W - L) / 7;
  const y = (v: number) => 6 + (1 - v / max) * (H - B - 6);
  const bar = (cx: number, v: number, fill: string, delay: number) => (
    <motion.rect
      x={cx}
      width="8"
      rx="2"
      fill={fill}
      initial={{ y: y(0), height: 0 }}
      animate={inView ? { y: y(v), height: y(0) - y(v) } : { y: y(0), height: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
    />
  );
  return (
    <ChartCard
      title="Daily budget vs scheduled hours"
      legend={<>
        <Chip swatch={<span className="inline-block h-2 w-2 rounded-[3px] bg-slate-500" />} label="Budget" />
        <Chip swatch={<span className="inline-block h-2 w-2 rounded-[3px] bg-blue-500" />} label="Scheduled" />
      </>}
    >
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Labor budget versus scheduled hours for each day of the week">
        {[0, 40, 80].map((v) => <text key={v} x={L - 5} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#94a3b8">{v}</text>)}
        {WEEK_LABELS.map((d, i) => {
          const cx = L + col * i + col / 2;
          return (
            <g key={d}>
              {bar(cx - 9, BUDGET_HOURS[i], "#64748b", i * 0.06)}
              {bar(cx + 1, scheduled[i], "#3b82f6", 0.2 + i * 0.06)}
              <text x={cx} y={H - 3} textAnchor="middle" fontSize="8" fill="#94a3b8">{d}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 grid grid-cols-7 gap-1 pl-[6%]" aria-label="Daily variance (scheduled minus budget)">
        {scheduled.map((h, i) => {
          const v = Math.round((h - BUDGET_HOURS[i]) * 10) / 10;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: inView ? 1 : 0 }}
              transition={{ delay: 0.9 + i * 0.05 }}
              className={`text-center text-[10px] font-bold tabular-nums ${v > 0 ? "text-red-400" : v < 0 ? "text-amber-400" : "text-green-500"}`}
            >
              {v > 0 ? `+${v}` : v}
            </motion.div>
          );
        })}
      </div>
    </ChartCard>
  );
}

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.6, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {children}
    </motion.div>
  );
}

/** Honors the OS "reduce motion" setting for every Framer animation below it. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

// ── Schedule (employee) ─────────────────────────────────────

const JAMIE_WEEK = EMPLOYEE_PATTERNS[9];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Jamie F.'s week from the demo fixtures, laid over the visitor's current week. */
export function WeekStrip() {
  const today = useToday();
  const day = today ?? REFERENCE_DAY;
  const sunday = startOfWeek(day);
  return (
    <div className={`grid grid-cols-7 gap-1.5 ${today ? "transition-opacity duration-300" : "opacity-0"}`}>
      {DAY_NAMES.map((d, i) => {
        const shift = JAMIE_WEEK[i];
        const isToday = i === day.getDay();
        const type = shift ? getShiftType(shift[0], shift[1], OPEN, CLOSE) ?? "mid" : null;
        const color = type ? SHIFT_COLORS[type] : undefined;
        return (
          <div
            key={d}
            className={`flex flex-col items-center gap-1.5 rounded-2xl border py-2.5 ${isToday ? "border-indigo-500 bg-indigo-500/10" : "border-slate-800 bg-card"}`}
          >
            <span className="text-[10px] font-semibold uppercase text-slate-400">{d}</span>
            <span className={`flex size-8 items-center justify-center rounded-full text-[15px] font-bold ${isToday ? "bg-indigo-500 text-white" : "text-slate-100"}`}>
              {addDays(sunday, i).getDate()}
            </span>
            {shift ? (
              <>
                <ShiftIcon shiftType={type!} size={14} color={color} />
                <span className="text-[10px] font-bold" style={{ color }}>{shortTime(shift[0])}</span>
              </>
            ) : (
              <>
                <span className="h-[14px]" />
                <span className="text-[10px] font-semibold text-slate-500">Off</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SchedulePhone() {
  const today = useToday();
  const day = today ?? REFERENCE_DAY;
  const sunday = startOfWeek(day);
  const worked = JAMIE_WEEK.filter(Boolean) as [number, number][];
  const hours = worked.reduce((sum, [s, e]) => sum + (e - s) / 60, 0);
  const shift = JAMIE_WEEK[day.getDay()];
  const type = shift ? getShiftType(shift[0], shift[1], OPEN, CLOSE) ?? "mid" : null;
  const color = type ? SHIFT_COLORS[type] : undefined;

  return (
    <Phone label="Employee schedule screen for the current week">
      <div className="px-4 pt-4">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">My Schedule</div>
            <div className="text-[28px] font-extrabold tracking-tight text-slate-100">Jamie</div>
          </div>
          <div className="flex rounded-xl bg-card p-1 text-[14px] font-semibold">
            <span className="rounded-lg bg-slate-700/70 px-4 py-1.5 text-slate-100">Week</span>
            <span className="px-4 py-1.5 text-slate-500">Month</span>
          </div>
        </div>

        <div className={`mb-4 text-[15px] font-bold text-slate-100 ${today ? "transition-opacity duration-300" : "opacity-0"}`}>
          {fmtRange(sunday, addDays(sunday, 6), true)}
        </div>

        <WeekStrip />

        <div
          className={`mt-4 rounded-2xl border border-white/[0.08] bg-card p-4 ${today ? "transition-opacity duration-300" : "opacity-0"}`}
          style={color ? { borderLeft: `3px solid ${color}` } : undefined}
        >
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-slate-400">Today</span>
            {type && (
              <span className="flex items-center gap-1 text-[12px] font-semibold capitalize" style={{ color }}>
                <ShiftIcon shiftType={type} size={12} color={color} />
                {type}
              </span>
            )}
          </div>
          {shift ? (
            <>
              <div className="mt-1 text-[22px] font-bold text-slate-100">{fmtMinutes(shift[0])} – {fmtMinutes(shift[1])}</div>
              <div className="mt-3 flex gap-2">
                <span className="flex-1 rounded-xl border border-slate-700 py-2.5 text-center text-[13px] font-semibold text-slate-300">Request swap</span>
                <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-500/30 py-2.5 text-[13px] font-semibold text-red-400">
                  <MegaphoneIcon size={14} /> Call out
                </span>
              </div>
            </>
          ) : (
            <div className="mt-1 text-[22px] font-bold text-slate-400">Day Off</div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { value: worked.length, label: "Shifts this week" },
            { value: hours, label: "Hours" },
            { value: 7 - worked.length, label: "Days off" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-slate-800 bg-card px-3 py-3">
              <div className="text-[26px] font-extrabold text-indigo-400">{s.value}</div>
              <div className="text-[11px] text-slate-400">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
      <BottomNav active="Schedule" />
    </Phone>
  );
}

/** The app's "Next shift" card for Jamie F., computed from the visitor's today. */
export function NextShiftCard() {
  const today = useToday();
  const day = today ?? REFERENCE_DAY;
  let offset = 1;
  while (!JAMIE_WEEK[(day.getDay() + offset) % 7]) offset++;
  const shift = JAMIE_WEEK[(day.getDay() + offset) % 7]!;
  const type = getShiftType(shift[0], shift[1], OPEN, CLOSE) ?? "mid";
  const color = SHIFT_COLORS[type];
  const date = addDays(day, offset);
  const when = offset === 1 ? "Tomorrow" : date.toLocaleDateString("en-US", { weekday: "long" });
  return (
    <div className={`mt-3 rounded-2xl border border-white/[0.08] bg-card px-4 py-3.5 ${today ? "transition-opacity duration-300" : "opacity-0"}`} style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Next Shift</span>
        <span className="flex items-center gap-1 text-[12px] font-semibold capitalize" style={{ color }}>
          <ShiftIcon shiftType={type} size={12} color={color} />
          {type}
        </span>
      </div>
      <div className="mt-1.5 text-[13px] text-slate-400">{when}</div>
      <div className="text-[17px] font-bold text-slate-100">{fmtMinutes(shift[0])} – {fmtMinutes(shift[1])}</div>
    </div>
  );
}

/** The current year from the visitor's clock (static pages would freeze the build year). */
export function CurrentYear() {
  const today = useToday();
  return <span className="tabular-nums">{today ? `© ${today.getFullYear()}` : null}</span>;
}
