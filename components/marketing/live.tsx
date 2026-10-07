"use client";

// The marketing pages' product demos. Each plays a real moment in the sample
// store (see ./scene) on the app's own screens (./screens): only what the app
// actually does, at the pace it does it. They start when scrolled into view,
// pause off screen, and visitors who prefer reduced motion get a still frame.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, MotionConfig, motion, useInView, useReducedMotion } from "framer-motion";
import { addDaysToKey, weekStartForKey } from "@/lib/dates";
import { weekDates } from "@/lib/draft-metrics";
import { DEMO_SETTINGS } from "@/data/demo-fixtures";
import { fmtMinutes } from "@/data/types";
import { BrowserChrome, BrowserFrame, LaptopFrame, PhoneFrame, TabletFrame } from "./frames";
import { ClockScreen, DashboardScreen, RequestScreen, ScheduleScreen, TimeCardScreen, WeekDraftScreen, type AutoSchedulePhase } from "./screens";
import { InAppBanner } from "./app-chrome";
import { buildScene, employeeOf, nextShiftAfter } from "./scene";
import { draftWeek } from "./auto-schedule";

/**
 * Seconds since the element came into view, counted only while it's on
 * screen; always 0 for reduced motion. Ticks every `step` seconds for the
 * first `fineFor` seconds (a script's beats), then every second (clocks), and
 * stops at `endAt`.
 */
function usePlayhead(
  ref: React.RefObject<Element | null>,
  { step = 1, fineFor = 0, endAt = Infinity }: { step?: number; fineFor?: number; endAt?: number } = {}
) {
  const inView = useInView(ref, { amount: 0.3 });
  const reduced = useReducedMotion();
  const [elapsed, setElapsed] = useState(0);
  const done = elapsed >= endAt;
  useEffect(() => {
    if (!inView || reduced || done) return;
    const started = performance.now() - elapsed * 1000;
    const id = setInterval(() => {
      const now = (performance.now() - started) / 1000;
      const quantum = now < fineFor ? step : 1;
      // Same value between ticks, so React skips the render.
      setElapsed(Math.min(endAt, Math.floor(now / quantum) * quantum));
    }, Math.min(step, 1) * 1000);
    return () => clearInterval(id);
    // Resumes from `elapsed` when it comes back on screen, so it reads it but
    // doesn't restart on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced, done, step, fineFor, endAt]);
  return elapsed;
}

const subscribeNothing = () => () => {};
/** False during the server render and hydration, true after. */
function useMounted() {
  return useSyncExternalStore(subscribeNothing, () => true, () => false);
}

// ── Hero: a late clock-in, from both sides ──────────────────

// The script, in seconds from first view.
const TAP_CLOCK_IN = 1.4;
const WARNING_UP = 1.9;
const TAP_CONFIRM = 3.7;
const PUNCH = 4.2;
const BANNER = 4.6;
const BANNER_FOR = 5; // the app's in-app banners dismiss after 5 s

/**
 * The employee who's running late taps Clock In on their phone; the app warns
 * them they're late, they confirm, and the store manager's dashboard updates
 * at once: a Late Clock-In alert, Here Now up by one, the coverage warning
 * gone.
 */
export function HeroDemo({ date }: { date: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const e = usePlayhead(ref, { step: 0.25, fineFor: BANNER + BANNER_FOR + 1 });
  const scene = useMemo(() => buildScene(date), [date]);
  const late = scene.late.shift;
  const t = Math.floor(scene.late.at - PUNCH + e);
  const lateName = employeeOf(scene, late.employeeId).name;
  const minutesLate = Math.round((scene.late.at - late.startMinutes * 60) / 60);
  const banner = e >= BANNER && e < BANNER + BANNER_FOR;

  return (
    <div ref={ref} className="relative flex items-start justify-center">
      <div className="relative z-0 mr-[-64px] mt-16 hidden sm:block lg:mr-[-40px] xl:mr-[-24px]">
        <PhoneFrame label={`${lateName}'s phone: clocking in for a ${fmtMinutes(late.startMinutes)} shift`} className="[--phone-zoom:0.52] lg:[--phone-zoom:0.56]">
          <ClockScreen
            scene={scene}
            employeeId={late.employeeId}
            t={t}
            press={e >= TAP_CLOCK_IN && e < WARNING_UP ? "clock_in" : e >= TAP_CONFIRM && e < PUNCH ? "confirm" : null}
            warning={e >= WARNING_UP && e < PUNCH}
          />
        </PhoneFrame>
      </div>
      <div className="relative z-10">
        <PhoneFrame label="The store manager's dashboard, updating live as people clock in" className="[--phone-zoom:0.6] sm:[--phone-zoom:0.65]">
          <DashboardScreen
            scene={scene}
            t={t}
            size="phone"
            unread={e >= BANNER ? 1 : 0}
            overlay={
              // Where the app puts its banners: 16px in from the top right of the page, below the status bar.
              <div className="absolute right-4 top-[70px] z-40">
                <AnimatePresence>
                  {banner && (
                    <motion.div key="late" initial={{ opacity: 0, y: -12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}>
                      <InAppBanner title="Late Clock-In" body={`${lateName} clocked in ${minutesLate}m late (scheduled ${fmtMinutes(late.startMinutes)})`} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            }
          />
        </PhoneFrame>
      </div>
    </div>
  );
}

// ── Time clock: punches onto the time card ──────────────────

// The script, in seconds from first view.
const TAP_END_SHIFT = 1.0;
const CLOCK_OUT = 1.3;
const OPEN_CARD = 2.4;
const SCROLL_CARD = 4.2;

/**
 * The employee who clocked in late in the hero ends their shift on their
 * phone; then their manager opens their time card on a desktop: the last 14
 * days of punches, today's late clock-in flagged, and scrolls down to today.
 */
export function TimeClockDemo({ date }: { date: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const mounted = useMounted();
  const e = usePlayhead(ref, { step: 0.1, fineFor: SCROLL_CARD + 1, endAt: SCROLL_CARD + 1 });
  const scene = useMemo(() => buildScene(date), [date]);
  const who = scene.late.shift.employeeId;
  const clockOut = scene.punches.find((p) => p.employeeId === who && p.type === "clock_out")!.at;
  // Reduced motion: the end of the script. Server render: its start.
  const at = mounted && reduced ? SCROLL_CARD + 1 : e;
  const t = clockOut + Math.floor(at - CLOCK_OUT);
  const name = employeeOf(scene, who).name;
  return (
    <div ref={ref} className="relative mx-auto max-w-5xl pb-[6%]">
      <div className="ml-auto w-full sm:w-[90%]">
        <BrowserFrame
          label={`A manager's dashboard on a desktop with ${name}'s time card open: two weeks of punches, hours and breaks, with today's late clock-in flagged`}
          url="shiftview.app"
          className="[--screen-zoom:0.25] sm:[--screen-zoom:0.45] lg:[--screen-zoom:0.62]"
        >
          <TimeCardScreen scene={scene} employeeId={who} t={t} open={at >= OPEN_CARD} scrolled={at >= SCROLL_CARD} />
        </BrowserFrame>
      </div>
      <div className="absolute bottom-0 left-0 z-10">
        <PhoneFrame label={`${name}'s phone: ending their shift on the time clock`} className="[--phone-zoom:0.24] sm:[--phone-zoom:0.36] lg:[--phone-zoom:0.5]">
          <ClockScreen scene={scene} employeeId={who} t={t} press={!reduced && at >= TAP_END_SHIFT && at < CLOCK_OUT ? "end_shift" : null} />
        </PhoneFrame>
      </div>
    </div>
  );
}

// ── Any device ──────────────────────────────────────────────

/** The same dashboard, at the same moment, on a laptop, a tablet and a phone. */
export function DevicesDemo({ date }: { date: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const e = usePlayhead(ref);
  const scene = useMemo(() => buildScene(date), [date]);
  const t = scene.late.at + 155 + e;
  return (
    <div ref={ref} className="relative mx-auto max-w-5xl pb-[4%]">
      <LaptopFrame label="ShiftView on a laptop: the full dashboard with the sidebar" className="mx-auto w-[86%] [--screen-zoom:0.24] sm:[--screen-zoom:0.4] lg:[--screen-zoom:0.56]">
        <div className="flex h-full flex-col">
          <BrowserChrome url="shiftview.app" />
          <div className="min-h-0 flex-1"><DashboardScreen scene={scene} t={t} size="desktop" /></div>
        </div>
      </LaptopFrame>
      <div className="absolute bottom-0 left-0 z-10 w-[28%]">
        <TabletFrame label="ShiftView on a tablet: the dashboard with the navigation rail" className="[--screen-zoom:0.13] sm:[--screen-zoom:0.22] lg:[--screen-zoom:0.3]">
          <DashboardScreen scene={scene} t={t} size="tablet" />
        </TabletFrame>
      </div>
      <div className="absolute bottom-0 right-[1%] z-20">
        <PhoneFrame label="ShiftView on a phone: the dashboard with bottom tabs" className="[--phone-zoom:0.18] sm:[--phone-zoom:0.32] lg:[--phone-zoom:0.45]">
          <DashboardScreen scene={scene} t={t} size="phone" />
        </PhoneFrame>
      </div>
    </div>
  );
}

// ── Auto-schedule ───────────────────────────────────────────

let madeAtCache: string | null = null;
/** When the visitor's run is made: the first time it's read, the same after. */
function runMadeAt() {
  madeAtCache ??= new Date().toISOString();
  return madeAtCache;
}

// The script, in seconds from first view: the empty week, Auto-schedule, the
// sheet, Generate, the wait while the run is made, then the drafted week.
const TAP_AUTO = 1.1;
const SHEET_UP = 1.4;
const TAP_GENERATE = 3.7;
const GENERATING = 3.85;
const GENERATED = 4.9;

/**
 * Next week on the Week page in Draft mode, as the page runs Auto-schedule:
 * the empty week, its Auto-schedule sheet, "Generating…", and then the
 * engine's drafts with the run's summary.
 */
export function AutoScheduleDemo({ date }: { date: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const e = usePlayhead(ref, { step: 0.1, fineFor: GENERATED + 1, endAt: GENERATED + 1 });
  const scene = useMemo(() => buildScene(date), [date]);
  const nextWeek = addDaysToKey(weekStartForKey(date, DEMO_SETTINGS.firstDayOfWeek), 7);
  // The summary prints when the run was made in the viewer's own clock, so
  // the finished week is only drawn in the browser.
  const madeAt = useSyncExternalStore(subscribeNothing, runMadeAt, () => null);
  const week = useMemo(() => draftWeek(nextWeek, madeAt ?? "1970-01-01T00:00:00Z"), [nextWeek, madeAt]);

  // Server render (no madeAt yet): the empty week. Reduced motion: the
  // finished run. Otherwise the run plays once the window scrolls into view.
  const phase: AutoSchedulePhase =
    madeAt === null ? "empty" : reduced || e >= GENERATED ? "done" : e >= GENERATING ? "generating" : e >= SHEET_UP ? "sheet" : "empty";
  const press = reduced ? null : e >= TAP_AUTO && e < TAP_AUTO + 0.35 ? "auto" : e >= TAP_GENERATE && e < TAP_GENERATE + 0.35 ? "generate" : null;
  return (
    <div ref={ref}>
      <BrowserFrame
        label="The Week page in Draft mode: Auto-schedule's setup sheet, then next week drafted to the coverage target with the run's summary"
        url={`shiftview.app/week?mode=draft&week=${nextWeek}`}
        className="[--screen-zoom:0.23] sm:[--screen-zoom:0.41] md:[--screen-zoom:0.5] lg:[--screen-zoom:0.75]"
      >
        <WeekDraftScreen scene={scene} week={week} phase={phase} press={press} />
      </BrowserFrame>
    </div>
  );
}

// ── The team's phones ───────────────────────────────────────

const JAMIE = 9;
const SAM = 4;

/** Three phone screens: an employee's week, their swap request, and a manager's approval. */
export function TeamDemo({ date }: { date: string }) {
  const scene = useMemo(() => buildScene(date), [date]);
  const jamieNext = nextShiftAfter(JAMIE, date)!.date;
  const jamieWeek = weekDates(weekStartForKey(jamieNext, DEMO_SETTINGS.firstDayOfWeek));
  const samNext = nextShiftAfter(SAM, date)!.date;
  const phones = [
    {
      title: "Their week, on their phone",
      label: "An employee's schedule: next shift, the week, and buttons to swap a shift or call out",
      screen: <ScheduleScreen scene={scene} employeeId={JAMIE} week={jamieWeek} selected={jamieNext} t={20 * 3600 + 42 * 60} />,
    },
    {
      title: "Swaps they set up themselves",
      label: "Picking a coworker working the same day to swap a shift with",
      screen: <ScheduleScreen scene={scene} employeeId={JAMIE} week={jamieWeek} selected={jamieNext} t={20 * 3600 + 43 * 60} swapSheet />,
    },
    {
      title: "Approvals in one tap",
      label: "A manager reviewing a time-off request next to that day's schedule",
      screen: <RequestScreen scene={scene} employeeId={SAM} date={samNext} note="Dentist appointment" pending={2} t={8 * 3600 + 51 * 60} />,
    },
  ];
  return (
    // Phones swipe through them; wider screens show all three.
    <div className="-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-6 sm:overflow-visible sm:px-0 sm:pb-0">
      {phones.map((p, i) => (
        <Reveal key={p.title} delay={i * 0.08} className="flex shrink-0 snap-center flex-col items-center">
          <PhoneFrame label={p.label} className="[--phone-zoom:0.6] sm:[--phone-zoom:0.4] md:[--phone-zoom:0.47] lg:[--phone-zoom:0.6]">
            {p.screen}
          </PhoneFrame>
          <p className="mt-5 text-center text-sm font-medium text-slate-300">{p.title}</p>
        </Reveal>
      ))}
    </div>
  );
}

// ── Shared ──────────────────────────────────────────────────

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

/** The current year from the visitor's clock (static pages would freeze the build year). */
export function CurrentYear() {
  const mounted = useMounted();
  return <span className="tabular-nums">{mounted ? `© ${new Date().getFullYear()}` : null}</span>;
}

