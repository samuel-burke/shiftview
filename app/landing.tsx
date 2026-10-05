import Link from "next/link";
import { Inter } from "next/font/google";
import TryDemoButton from "@/components/TryDemoButton";
import { ShiftIcon, MegaphoneIcon } from "@/components/ShiftIcons";
import { DEMO_EMPLOYEES, EMPLOYEE_PATTERNS } from "@/data/demo-fixtures";
import {
  getShiftType,
  formatDisplayName,
  getMonogram,
  fmtMinutes,
  SHIFT_COLORS,
  type ShiftType,
} from "@/data/types";

const inter = Inter({ subsets: ["latin"], display: "swap" });

const REPO_URL = "https://github.com/samuel-burke/shiftview";

// ── Product snapshot ────────────────────────────────────────
// Every screen on this page is rendered from the same seed data the live demo
// uses (data/demo-fixtures.ts) and the same helpers the app uses, so the
// previews stay honest: a Saturday at 1:30 PM in the Demo organization.

const DAY_OF_WEEK = 6; // Saturday
const OPEN = 360; // 6:00 AM
const CLOSE = 1320; // 10:00 PM
const NOW = 810; // 1:30 PM

type Attendance = "clocked_in" | "on_break" | "not_clocked_in" | "upcoming";

// Who's on break / running late in the snapshot. Everyone else whose shift has
// started is clocked in on time.
const ATTENDANCE_OVERRIDES: Record<number, Attendance> = {
  4: "on_break", // Sam K.
  8: "not_clocked_in", // Dakota P.
};

type Row = {
  id: number;
  name: string;
  start: number;
  end: number;
  type: ShiftType;
  attendance: Attendance;
};

const ROSTER: Row[] = DEMO_EMPLOYEES.flatMap((e) => {
  const shift = EMPLOYEE_PATTERNS[e.id]?.[DAY_OF_WEEK];
  if (!shift) return [];
  const [start, end] = shift;
  const attendance: Attendance =
    start > NOW ? "upcoming" : ATTENDANCE_OVERRIDES[e.id] ?? "clocked_in";
  return [{
    id: e.id,
    name: formatDisplayName(e.name),
    start,
    end,
    type: getShiftType(start, end, OPEN, CLOSE) ?? "mid",
    attendance,
  }];
}).sort((a, b) => a.start - b.start);

const OFF_TODAY = DEMO_EMPLOYEES.filter((e) => !EMPLOYEE_PATTERNS[e.id]?.[DAY_OF_WEEK]);
const HERE = ROSTER.filter((r) => r.attendance === "clocked_in" || r.attendance === "on_break");
const NOT_HERE = ROSTER.filter((r) => r.attendance === "not_clocked_in" || r.attendance === "upcoming");

// Coverage curve sampled every 30 minutes, like the app's timeline.
const SAMPLES = Array.from({ length: (CLOSE - OPEN) / 30 + 1 }, (_, i) => OPEN + i * 30);
const scheduledAt = (m: number) => ROSTER.filter((r) => m >= r.start && m < r.end).length;
const clockedAt = (m: number) =>
  ROSTER.filter((r) => m >= r.start && m < r.end && r.attendance !== "not_clocked_in" && r.attendance !== "upcoming").length;

// ── Page ────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <main className={`${inter.className} min-h-screen bg-bg text-slate-100 overflow-x-hidden antialiased`}>
      <LandingNav />
      <Hero />
      <CapabilityStrip />
      <CoverageSection />
      <ScheduleSection />
      <PlannerSection />
      <RequestsSection />
      <ClockSection />
      <CapabilityMap />
      <EngineeringSection />
      <ClosingCta />
      <LandingFooter />
    </main>
  );
}

function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight text-slate-100 ${className}`}>
      Shift
      <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">View</span>
    </span>
  );
}

const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-white transition-colors";
const secondaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 hover:border-slate-500 hover:text-slate-100 transition-colors cursor-pointer";

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/60 bg-bg/80 backdrop-blur">
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" aria-label="ShiftView home"><Wordmark className="text-lg" /></Link>
        <nav aria-label="Site navigation" className="flex items-center gap-1 sm:gap-6">
          <div className="hidden md:flex items-center gap-6 text-sm text-slate-400">
            <a href="#coverage" className="hover:text-slate-100 transition-colors">Coverage</a>
            <a href="#scheduling" className="hover:text-slate-100 transition-colors">Scheduling</a>
            <a href="#time-clock" className="hover:text-slate-100 transition-colors">Time clock</a>
            <a href="#engineering" className="hover:text-slate-100 transition-colors">Engineering</a>
          </div>
          <a href="/login" className="px-3 py-2 text-sm font-medium text-slate-300 hover:text-slate-100 transition-colors">
            Sign in
          </a>
          <a href="/signup" className="rounded-lg bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-900 hover:bg-white transition-colors">
            Get started
          </a>
        </nav>
      </Container>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative border-b border-slate-800/60">
      <Container className="grid items-center gap-14 pt-16 pb-20 lg:grid-cols-[1fr_auto] lg:gap-10 lg:pt-24 lg:pb-28">
        <div className="max-w-xl">
          <p className="mb-5 text-sm font-medium text-slate-400">
            Scheduling and time clock for retail &amp; fulfillment teams
          </p>
          <h1 className="text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.035em] text-slate-100 sm:text-6xl lg:text-[4.25rem]">
            Know who&rsquo;s on the floor. Right now.
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-slate-400 sm:text-lg">
            Build the week, see live coverage against what you planned, and let your team clock in from their phones. One app for managers and staff.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-start">
            <a href="/signup" className={primaryBtn}>
              Start free <Arrow />
            </a>
            <TryDemoButton className={`${secondaryBtn} w-full sm:w-auto`}>
              Open the live demo
            </TryDemoButton>
          </div>
          <p className="mt-5 text-xs text-slate-500">
            No credit card. The demo is a real workspace with sample data that resets nightly.
          </p>
        </div>

        <div className="relative mx-auto flex justify-center lg:mx-0 lg:pr-4">
          <div className="hidden xl:block absolute right-[262px] top-20">
            <Phone label="Employee clock-in screen"><ClockScreen /></Phone>
          </div>
          <div className="relative">
            <Phone label="Manager coverage dashboard"><TeamScreen /></Phone>
          </div>
        </div>
      </Container>
    </section>
  );
}

function CapabilityStrip() {
  const items = ["Live coverage", "Weekly scheduling", "Mobile time clock", "Swaps & time off", "Team messaging", "Payroll CSV export"];
  return (
    <section aria-label="Capabilities" className="border-b border-slate-800/60">
      <Container className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 py-6 text-sm text-slate-500">
        {items.map((item, i) => (
          <span key={item} className="flex items-center gap-8">
            {i > 0 && <span aria-hidden="true" className="hidden sm:block h-1 w-1 rounded-full bg-slate-700" />}
            {item}
          </span>
        ))}
      </Container>
    </section>
  );
}

// ── Feature sections ────────────────────────────────────────

function SectionCopy({
  eyebrow,
  title,
  body,
  points,
}: {
  eyebrow: string;
  title: string;
  body: string;
  points: { title: string; body: string }[];
}) {
  return (
    <div className="max-w-md">
      <p className="mb-4 text-sm font-medium text-blue-400">{eyebrow}</p>
      <h2 className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-slate-100 sm:text-4xl">{title}</h2>
      <p className="mt-5 text-base leading-relaxed text-slate-400">{body}</p>
      <dl className="mt-8 divide-y divide-slate-800/80 border-t border-slate-800/80">
        {points.map((p) => (
          <div key={p.title} className="py-4">
            <dt className="text-sm font-semibold text-slate-200">{p.title}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-slate-400">{p.body}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CoverageSection() {
  return (
    <section id="coverage" className="scroll-mt-16 border-b border-slate-800/60">
      <Container className="grid items-center gap-14 py-20 lg:grid-cols-2 lg:gap-16 lg:py-28">
        <SectionCopy
          eyebrow="Coverage"
          title="Spot the gap before the line backs up."
          body="Planned staffing and actual clock-ins share one timeline, so you can see a no-show the moment it happens instead of when a customer complains."
          points={[
            { title: "Scheduled vs. clocked in", body: "The blue line is the plan, the green fill is who actually showed up." },
            { title: "Late and missing at a glance", body: "Anyone past their start time without a punch is flagged Not Here Yet." },
            { title: "Low and critical alerts", body: "The dashboard flags low or critical staffing against your target as it happens." },
          ]}
        />
        <div className="w-full max-w-[520px] justify-self-center lg:justify-self-end">
          <div className="rounded-2xl border border-slate-800 bg-bg p-3 sm:p-4 shadow-2xl shadow-black/30">
            <StatTiles />
            <div className="mt-3"><CoverageTimeline /></div>
            <div className="mt-1">
              {NOT_HERE.slice(0, 2).map((r) => <ShiftCard key={r.id} row={r} />)}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

function ScheduleSection() {
  return (
    <section id="scheduling" className="scroll-mt-16 border-b border-slate-800/60">
      <Container className="grid items-center gap-14 py-20 lg:grid-cols-2 lg:gap-16 lg:py-28">
        <div className="order-2 flex justify-center lg:order-1">
          <Phone label="Employee schedule screen"><ScheduleScreen /></Phone>
        </div>
        <div className="order-1 lg:order-2 lg:justify-self-end">
          <SectionCopy
            eyebrow="Scheduling"
            title="A week of shifts in minutes, not an afternoon."
            body="Start from a template or copy last week, then adjust. ShiftView checks every shift against availability and approved time off as you build."
            points={[
              { title: "Templates and copy-week", body: "Reuse the weeks that worked. Edit only what changed." },
              { title: "Availability conflicts", body: "Warns you before you schedule someone on a day they can't work." },
              { title: "Swaps, time off, call-outs", body: "Staff request from their phone. You approve in one tap." },
            ]}
          />
        </div>
      </Container>
    </section>
  );
}

function ClockSection() {
  return (
    <section id="time-clock" className="scroll-mt-16 border-b border-slate-800/60">
      <Container className="grid items-center gap-14 py-20 lg:grid-cols-2 lg:gap-16 lg:py-28">
        <SectionCopy
          eyebrow="Time clock"
          title="Clock in from the phone already in their pocket."
          body="No kiosk, no shared tablet by the back door. Punches are validated on the server, and every one shows up on the manager's timeline the moment it lands."
          points={[
            { title: "Geofenced punches", body: "Optionally require staff to be on site to clock in, enforced server-side." },
            { title: "Breaks and missed punches", body: "Breaks are one tap. A forgotten clock-out is caught and corrected before the next punch." },
            { title: "Payroll-ready export", body: "Download timesheets as CSV for any date range." },
          ]}
        />
        <div className="flex justify-center lg:justify-self-end">
          <Phone label="Employee on break in the clock screen"><ClockScreen onBreak /></Phone>
        </div>
      </Container>
    </section>
  );
}

function PlannerSection() {
  return (
    <section id="planning" className="scroll-mt-16 border-b border-slate-800/60">
      <Container className="py-20 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-center lg:gap-16">
          <SectionCopy
            eyebrow="Planning"
            title="Staff to demand, and stay inside the budget."
            body="Set a target coverage curve for each day of the week. Draft schedules are checked against it hour by hour and against your labor hours budget, before anything goes live."
            points={[
              { title: "Recommended vs. scheduled", body: "See where the draft runs thin at the lunch rush or heavy after close." },
              { title: "Daily budget variance", body: "Over and under, per day, in hours. No spreadsheet needed." },
              { title: "Draft, then publish", body: "Work on next week privately. Your team sees it when you publish." },
            ]}
          />
          <PlannerPreview />
        </div>
      </Container>
    </section>
  );
}

// Labor-hours budget per day (Sun–Sat) used for the planner preview; scheduled
// hours come straight from the demo fixtures.
const BUDGET_HOURS = [56, 52, 56, 64, 64, 72, 80];
const WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Saturday's target staffing per hour, 6 AM – 10 PM.
const TARGET_BY_HOUR = [2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 8, 7, 6, 5, 4, 3];

function PlannerPreview() {
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
          <div className="text-[12px] text-slate-400">Oct 11 – Oct 17 · Not published</div>
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

function ChartCard({ title, children, legend }: { title: string; children: React.ReactNode; legend: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card px-2.5 pb-2.5 pt-4">
      <p className="mb-2 pl-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">{title}</p>
      <div className="mb-3 flex items-center gap-2 pl-1.5">{legend}</div>
      {children}
    </div>
  );
}

function Chip({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-700/40 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400">
      {swatch}
      {label}
    </span>
  );
}

function HourlyCoverageChart() {
  const W = 260;
  const H = 130;
  const L = 16;
  const B = 16;
  const hours = TARGET_BY_HOUR.map((_, i) => OPEN + i * 60);
  const max = 12;
  const x = (i: number) => L + (i / TARGET_BY_HOUR.length) * (W - L - 4);
  const y = (v: number) => 6 + (1 - v / max) * (H - B - 6);
  const step = (vals: number[]) =>
    vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}H${x(i + 1).toFixed(1)}`).join("");
  const sched = hours.map((m) => scheduledAt(m + 30));
  const area = `${step(sched)}V${y(0)}H${x(0)}Z`;
  return (
    <ChartCard
      title="Coverage · Sat by hour"
      legend={<>
        <Chip swatch={<span className="inline-block w-2.5 border-t-2 border-dashed border-[#818cf8]" />} label="Recommended" />
        <Chip swatch={<span className="inline-block h-0.5 w-2.5 rounded-full bg-blue-500" />} label="Scheduled" />
      </>}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Saturday recommended staffing versus scheduled staffing by hour">
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
        <path d={area} fill="url(#lpDraft)" />
        <path d={step(sched)} fill="none" stroke="#3b82f6" strokeWidth="2" />
        <path d={step(TARGET_BY_HOUR)} fill="none" stroke="#818cf8" strokeWidth="1.6" strokeDasharray="4 3" />
      </svg>
    </ChartCard>
  );
}

function BudgetChart({ scheduled }: { scheduled: number[] }) {
  const W = 260;
  const H = 130;
  const L = 16;
  const B = 16;
  const max = 90;
  const col = (W - L) / 7;
  const y = (v: number) => 6 + (1 - v / max) * (H - B - 6);
  return (
    <ChartCard
      title="Daily budget vs scheduled hours"
      legend={<>
        <Chip swatch={<span className="inline-block h-2 w-2 rounded-[3px] bg-slate-500" />} label="Budget" />
        <Chip swatch={<span className="inline-block h-2 w-2 rounded-[3px] bg-blue-500" />} label="Scheduled" />
      </>}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Labor budget versus scheduled hours for each day of the week">
        {[0, 40, 80].map((v) => <text key={v} x={L - 5} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#94a3b8">{v}</text>)}
        {WEEK_LABELS.map((d, i) => {
          const cx = L + col * i + col / 2;
          return (
            <g key={d}>
              <rect x={cx - 9} y={y(BUDGET_HOURS[i])} width="8" height={y(0) - y(BUDGET_HOURS[i])} rx="2" fill="#64748b" />
              <rect x={cx + 1} y={y(scheduled[i])} width="8" height={y(0) - y(scheduled[i])} rx="2" fill="#3b82f6" />
              <text x={cx} y={H - 3} textAnchor="middle" fontSize="8" fill="#94a3b8">{d}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 grid grid-cols-7 gap-1 pl-[6%]" aria-label="Daily variance (scheduled minus budget)">
        {scheduled.map((h, i) => {
          const v = Math.round((h - BUDGET_HOURS[i]) * 10) / 10;
          return (
            <div key={i} className={`text-center text-[10px] font-bold tabular-nums ${v > 0 ? "text-red-400" : v < 0 ? "text-amber-400" : "text-green-500"}`}>
              {v > 0 ? `+${v}` : v}
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

function RequestsSection() {
  return (
    <section id="requests" className="scroll-mt-16 border-b border-slate-800/60">
      <Container className="grid items-center gap-14 py-20 lg:grid-cols-2 lg:gap-16 lg:py-28">
        <div className="order-2 flex justify-center lg:order-1">
          <Phone label="Manager requests inbox"><RequestsScreen /></Phone>
        </div>
        <div className="order-1 lg:order-2 lg:justify-self-end">
          <SectionCopy
            eyebrow="Approvals"
            title="Requests land in one inbox, not your texts."
            body="Time off, shift swaps and open-shift pickups come to one place, with the dates, times and notes you need to say yes or no."
            points={[
              { title: "Two-step swaps", body: "The coworker accepts first, then a manager approves. Nobody's shift moves without them agreeing." },
              { title: "Everyone stays in the loop", body: "The requester gets a push notification the moment you decide." },
              { title: "Call-outs, handled", body: "A call-out notifies managers instantly and marks the shift across every view." },
            ]}
          />
        </div>
      </Container>
    </section>
  );
}

function RequestsScreen() {
  const casey = EMPLOYEE_PATTERNS[2][4]!;
  const morgan = EMPLOYEE_PATTERNS[5][4]!;
  const timeOff = [
    { name: "Riley Chen", date: "Fri, Oct 16", note: "Sister's wedding" },
    { name: "Avery Johnson", date: "Wed, Oct 21", note: "Dentist" },
  ];
  const approve = "flex-1 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 py-3.5 text-center text-xs font-bold text-white";
  const deny = "flex-1 rounded-xl border border-slate-700 py-3.5 text-center text-xs font-semibold text-red-400";
  return (
    <>
      <div className="px-4 pt-4">
        <div className="mb-6">
          <div className="text-lg font-bold text-slate-100">Requests</div>
          <div className="mt-0.5 text-xs text-slate-400">3 awaiting approval</div>
        </div>
        <SectionLabel label="Time Off" count={timeOff.length} />
        <div className="flex flex-col gap-2">
          {timeOff.map((t) => (
            <div key={t.name} className="rounded-2xl border border-slate-800/60 bg-card px-4 py-3">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-indigo-500/30 bg-indigo-600/70 text-xs font-bold text-white">{getMonogram(t.name)}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-100">{t.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    {t.date}
                    <span className="truncate text-slate-500">· &ldquo;{t.note}&rdquo;</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2"><span className={approve}>Approve</span><span className={deny}>Deny</span></div>
            </div>
          ))}
        </div>
        <div className="mt-4"><SectionLabel label="Shift Swaps" count={1} /></div>
        <div className="rounded-2xl border border-slate-800/60 bg-card px-4 py-4">
          <div className="mb-1 text-sm font-semibold text-slate-100">Casey Lewis wants to swap with Morgan Brooks</div>
          <div className="mb-1 text-xs text-slate-400">Thursday, October 15</div>
          <div className="mb-3 flex items-center gap-1.5 whitespace-nowrap text-[10.5px] text-slate-400">
            <span className="rounded-lg bg-slate-800 px-2 py-1">Casey: {fmtMinutes(casey[0])} – {fmtMinutes(casey[1])}</span>
            <span className="text-slate-600" aria-hidden="true">⇄</span>
            <span className="rounded-lg bg-slate-800 px-2 py-1">Morgan: {fmtMinutes(morgan[0])} – {fmtMinutes(morgan[1])}</span>
          </div>
          <div className="flex gap-2"><span className={approve}>Approve</span><span className={deny}>Deny</span></div>
        </div>
      </div>
      <BottomNav active="Team" />
    </>
  );
}

function CapabilityMap() {
  const groups = [
    {
      role: "For managers",
      items: [
        "Live coverage dashboard with alerts",
        "Week and month schedule editing",
        "Shift templates and copy-week",
        "Draft schedules with coverage targets",
        "Labor budget and cost tracking",
        "Approvals for time off and swaps",
        "Open shifts for pickup",
        "Announcements to the whole team",
      ],
    },
    {
      role: "For employees",
      items: [
        "Clock in, breaks and clock out",
        "My schedule, next shift and hours",
        "Availability and time-off requests",
        "Shift swaps and open-shift pickup",
        "One-tap call-outs",
        "Direct messages with managers",
        "Push reminders the night before",
        "Add shifts to your calendar",
      ],
    },
    {
      role: "For owners & admins",
      items: [
        "Multiple managers and roles",
        "Email invites and onboarding",
        "Store hours and positions",
        "Geofence for clock-in",
        "Payroll and punctuality reports",
        "CSV timesheet exports",
        "Full audit log of every change",
        "Per-person notification settings",
      ],
    },
  ];
  return (
    <section className="border-b border-slate-800/60">
      <Container className="py-20 lg:py-28">
        <div className="max-w-2xl">
          <p className="mb-4 text-sm font-medium text-blue-400">Everything in one app</p>
          <h2 className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-slate-100 sm:text-4xl">
            Replace the group chat, the paper timesheet and the schedule spreadsheet.
          </h2>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-800/80 md:grid-cols-3">
          {groups.map((g) => (
            <div key={g.role} className="bg-bg p-6 lg:p-8">
              <h3 className="text-sm font-semibold text-slate-100">{g.role}</h3>
              <ul className="mt-5 space-y-3">
                {g.items.map((item) => (
                  <li key={item} className="flex gap-3 text-sm text-slate-400">
                    <svg className="mt-[3px] shrink-0 text-blue-400" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

function EngineeringSection() {
  const principles = [
    {
      title: "One write path, two locks",
      body: "Every mutation goes through an API route that authenticates, checks the role, validates input and writes an audit entry. Postgres row-level security on every table enforces the same rules again underneath.",
    },
    {
      title: "Server-side truth",
      body: "Geofenced punches are validated on the server, not trusted from the browser. Privileged writes use a separate service-role client only after the API verifies manager status.",
    },
    {
      title: "Private by default",
      body: "Direct messages are encrypted at rest with AES-256-GCM. The database never stores message plaintext.",
    },
    {
      title: "No timezone bugs",
      body: "Shift times are minutes since midnight and dates are plain YYYY-MM-DD strings, so DST changes never move a shift.",
    },
    {
      title: "The demo is production",
      body: "The live demo is a real tenant on the same routes and policies. What you try is exactly what your team gets.",
    },
    {
      title: "Works like a native app",
      body: "Installable PWA with a service worker, offline-aware shell, realtime updates and web push.",
    },
  ];
  const pipeline = [
    { step: "Lint", detail: "ESLint" },
    { step: "Typecheck", detail: "TypeScript strict" },
    { step: "Unit tests", detail: "1,100+ tests · Vitest" },
    { step: "Build", detail: "Next.js production" },
    { step: "E2E", detail: "Playwright · mobile" },
  ];
  const stack = ["Next.js 16", "React 19", "TypeScript", "Supabase Postgres", "Row-level security", "Realtime", "Tailwind CSS 4", "Web Push", "Vitest", "Playwright", "Vercel"];

  return (
    <section id="engineering" className="scroll-mt-16 border-b border-slate-800/60">
      <Container className="py-20 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-16">
          <div>
            <p className="mb-4 text-sm font-medium text-blue-400">Engineering</p>
            <h2 className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-slate-100 sm:text-4xl">
              Built for payroll-grade reliability.
            </h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-slate-400">
              Schedules and time punches turn into paychecks, so ShiftView is built to be boring in the best way: enforced rules, tested paths, and a record of every change.
            </p>
            <a href={REPO_URL} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-200 hover:text-white transition-colors">
              Read the source and architecture notes <Arrow />
            </a>
          </div>

          <div className="space-y-4">
            <ArchitectureDiagram />
            <div className="rounded-2xl border border-slate-800 bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">CI on every pull request</span>
                <span className="font-mono text-[11px] text-slate-500">GitHub Actions</span>
              </div>
              <ol className="divide-y divide-slate-800/80 rounded-lg border border-slate-800 bg-bg/60">
                {pipeline.map((p, i) => (
                  <li key={p.step} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                    <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-500">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    <span className="font-semibold text-slate-200"><span className="sr-only">Step {i + 1}: </span>{p.step}</span>
                    <span className="ml-auto font-mono text-[12px] text-slate-500">{p.detail}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <dl className="mt-16 grid gap-x-10 gap-y-8 border-t border-slate-800/80 pt-12 sm:grid-cols-2 lg:grid-cols-3">
          {principles.map((p) => (
            <div key={p.title}>
              <dt className="text-sm font-semibold text-slate-100">{p.title}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-slate-400">{p.body}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-14 flex flex-wrap gap-2">
          {stack.map((t) => (
            <span key={t} className="rounded-md border border-slate-800 px-2.5 py-1 font-mono text-[12px] text-slate-400">{t}</span>
          ))}
        </div>
      </Container>
    </section>
  );
}

function ArchitectureDiagram() {
  const box = "rounded-lg border border-slate-700/70 bg-bg/70 px-3 py-2";
  const label = "text-[12px] font-semibold text-slate-200";
  const sub = "mt-0.5 text-[11px] text-slate-500";
  return (
    <figure aria-label="Request flow architecture" className="rounded-2xl border border-slate-800 bg-card p-5">
      <figcaption className="mb-4 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Request path</figcaption>
      <div className="grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
        <div className={box}>
          <div className={label}>PWA client</div>
          <div className={sub}>React 19 · offline shell</div>
        </div>
        <FlowArrow />
        <div className={`${box} border-blue-500/40`}>
          <div className={label}>API route handlers</div>
          <div className={sub}>auth, role, validation, audit</div>
        </div>
        <FlowArrow />
        <div className={box}>
          <div className={label}>Postgres</div>
          <div className={sub}>RLS on every table</div>
        </div>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <div className={box}><div className={label}>Realtime</div><div className={sub}>live schedule &amp; messages</div></div>
        <div className={box}><div className={label}>Web Push</div><div className={sub}>VAPID notifications</div></div>
        <div className={box}><div className={label}>Cron jobs</div><div className={sub}>reminders · demo reset</div></div>
      </div>
    </figure>
  );
}

function FlowArrow() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center text-slate-600">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="rotate-90 sm:rotate-0">
        <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function ClosingCta() {
  return (
    <section>
      <Container className="flex flex-col items-start gap-8 py-20 lg:flex-row lg:items-end lg:justify-between lg:py-28">
        <div className="max-w-xl">
          <h2 className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-slate-100 sm:text-5xl">
            See a real week before you set one up.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-400">
            The demo signs you in as a manager of a sample store with twelve people on the roster. Change anything you like.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-start">
          <TryDemoButton className={`${primaryBtn} w-full sm:w-auto cursor-pointer`}>
            Open the live demo <Arrow />
          </TryDemoButton>
          <a href="/signup" className={secondaryBtn}>Create your organization</a>
        </div>
      </Container>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-slate-800/60">
      <Container className="flex flex-col gap-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Wordmark className="text-sm" />
          <span>© {new Date().getFullYear()}</span>
        </div>
        <nav aria-label="Footer" className="flex gap-6">
          <a href="/login" className="hover:text-slate-300 transition-colors">Sign in</a>
          <a href="/signup" className="hover:text-slate-300 transition-colors">Get started</a>
          <a href="/privacy" className="hover:text-slate-300 transition-colors">Privacy</a>
          <a href={REPO_URL} className="hover:text-slate-300 transition-colors">GitHub</a>
        </nav>
      </Container>
    </footer>
  );
}

// ── Phone frame ─────────────────────────────────────────────
// Screens are laid out at the app's real 390×844 viewport with the app's own
// classes, then zoomed down (zoom, not transform, so text re-lays out crisply), so they match what people see on their phones.

const SCALE = 0.72;

function Phone({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <figure
      aria-label={label}
      className="relative rounded-[48px] bg-[#05070d] p-[9px] shadow-[0_50px_100px_-30px_rgba(0,0,0,0.7)] ring-1 ring-white/10"
    >
      <div
        className="relative overflow-hidden rounded-[40px] bg-bg"
        style={{ width: 390 * SCALE, height: 844 * SCALE }}
      >
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 flex flex-col"
          style={{ width: 390, height: 844, zoom: SCALE }}
        >
          <StatusBar />
          <AppHeader />
          <div className="relative flex-1 overflow-hidden">{children}</div>
        </div>
      </div>
    </figure>
  );
}

function StatusBar() {
  return (
    <div className="relative flex h-[54px] shrink-0 items-center justify-between px-9 pt-1 text-[16px] font-semibold text-slate-100">
      <span>1:30</span>
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

function AppHeader() {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-slate-800/80 px-4 pb-3 pt-1.5">
      <Wordmark className="text-[26px]" />
      <div className="flex items-center gap-2.5">
        <span className="flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-[12px] font-semibold text-green-500">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          Clocked In
        </span>
        <span className="flex size-11 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">JF</span>
      </div>
    </div>
  );
}

function BottomNav({ active }: { active: "Team" | "Schedule" | "Clock" }) {
  const tabs = [
    { label: "Team" as const, icon: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /> },
    { label: "Schedule" as const, icon: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></> },
    { label: "Clock" as const, icon: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></> },
  ];
  return (
    <div className="absolute inset-x-0 bottom-0 border-t border-slate-800/80 bg-bg pb-7">
      <div className="flex">
        {tabs.map((t) => {
          const isActive = t.label === active;
          return (
            <div key={t.label} className={`relative flex flex-1 flex-col items-center gap-0.5 pt-3 pb-2 ${isActive ? "text-slate-100" : "text-slate-500"}`}>
              {isActive && <span className="absolute top-0 h-[2px] w-8 rounded-full bg-indigo-500" />}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg>
              <span className="text-[10px] font-semibold uppercase tracking-wider">{t.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Screens ─────────────────────────────────────────────────

function TeamScreen() {
  return (
    <>
      <div className="px-4 pt-4">
        <StatTiles />
        <div className="mt-3"><CoverageTimeline /></div>
        <SectionLabel label="Here Now" count={HERE.length} />
        {HERE.slice(-4).map((r) => <ShiftCard key={r.id} row={r} />)}
      </div>
      <BottomNav active="Team" />
    </>
  );
}

function ScheduleScreen() {
  // Jamie F.'s real week from the demo fixtures.
  const jamie = EMPLOYEE_PATTERNS[9];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dates = [4, 5, 6, 7, 8, 9, 10];
  const worked = jamie.filter(Boolean) as [number, number][];
  const hours = worked.reduce((sum, [s, e]) => sum + (e - s) / 60, 0);
  const today = jamie[DAY_OF_WEEK]!;
  const todayType = getShiftType(today[0], today[1], OPEN, CLOSE) ?? "mid";
  const todayColor = SHIFT_COLORS[todayType];

  return (
    <>
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

        <div className="mb-4 text-[15px] font-bold text-slate-100">Oct 4 – Oct 10, 2026</div>

        <div className="grid grid-cols-7 gap-1.5">
          {days.map((d, i) => {
            const shift = jamie[i];
            const isToday = i === DAY_OF_WEEK;
            const type = shift ? getShiftType(shift[0], shift[1], OPEN, CLOSE) ?? "mid" : null;
            const color = type ? SHIFT_COLORS[type] : undefined;
            return (
              <div
                key={d}
                className={`flex flex-col items-center gap-1.5 rounded-2xl border py-2.5 ${isToday ? "border-indigo-500 bg-indigo-500/10" : "border-slate-800 bg-card"}`}
              >
                <span className="text-[10px] font-semibold uppercase text-slate-400">{d}</span>
                <span className={`flex size-8 items-center justify-center rounded-full text-[15px] font-bold ${isToday ? "bg-indigo-500 text-white" : "text-slate-100"}`}>
                  {dates[i]}
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

        <div className="mt-4 rounded-2xl border border-white/[0.08] bg-card p-4" style={{ borderLeft: `3px solid ${todayColor}` }}>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-slate-400">Today</span>
            <span className="flex items-center gap-1 text-[12px] font-semibold capitalize" style={{ color: todayColor }}>
              <ShiftIcon shiftType={todayType} size={12} color={todayColor} />
              {todayType}
            </span>
          </div>
          <div className="mt-1 text-[22px] font-bold text-slate-100">
            {fmtMinutes(today[0])} – {fmtMinutes(today[1])}
          </div>
          <div className="mt-3 flex gap-2">
            <span className="flex-1 rounded-xl border border-slate-700 py-2.5 text-center text-[13px] font-semibold text-slate-300">Request swap</span>
            <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-500/30 py-2.5 text-[13px] font-semibold text-red-400">
              <MegaphoneIcon size={14} /> Call out
            </span>
          </div>
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
    </>
  );
}

function ClockScreen({ onBreak = false }: { onBreak?: boolean }) {
  const shift = EMPLOYEE_PATTERNS[9][DAY_OF_WEEK]!;
  const type = getShiftType(shift[0], shift[1], OPEN, CLOSE) ?? "opener";
  const color = SHIFT_COLORS[type];
  const worked = NOW - shift[0];
  return (
    <>
      <div className="space-y-3 px-4 pt-4">
        <div className="rounded-2xl border border-white/[0.08] bg-card px-5 py-4" style={{ borderLeft: `3px solid ${color}` }}>
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-slate-400">Today&rsquo;s Shift</span>
            <span className="text-[13px] font-semibold capitalize" style={{ color }}>{type}</span>
          </div>
          <div className="mt-1.5 text-[26px] font-bold text-slate-100">{fmtMinutes(shift[0])} – {fmtMinutes(shift[1])}</div>
          <div className="mt-1 text-[13px] font-semibold text-green-500">On time</div>
        </div>

        <div className="flex flex-col items-center rounded-2xl border border-slate-800 bg-card py-6">
          {onBreak ? (
            <span className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-[15px] font-semibold text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              On Break
            </span>
          ) : (
            <span className="flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-1.5 text-[15px] font-semibold text-green-500">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Clocked In
            </span>
          )}
          <div className="mt-4 font-mono text-[40px] font-bold tracking-tight text-slate-100 tabular-nums">
            {onBreak ? "0h 08m 41s" : `${Math.floor(worked / 60)}h ${String(worked % 60).padStart(2, "0")}m 12s`}
          </div>
          <div className="mt-1 text-[13px] text-slate-400">{onBreak ? "Break started at 1:21 PM" : "Total time worked today"}</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <span className="rounded-2xl border border-amber-500/40 bg-amber-500/15 py-5 text-center text-[17px] font-bold text-amber-400">{onBreak ? "End Break" : "Start Break"}</span>
          <span className="rounded-2xl border border-slate-600/60 bg-slate-700/60 py-5 text-center text-[17px] font-bold text-slate-200">End Shift</span>
        </div>

        <div className="pt-2 text-[12px] font-bold uppercase tracking-[0.1em] text-slate-400">Today&rsquo;s Punches</div>
        <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-card px-5 py-3.5 text-[15px]">
          <span className="flex items-center gap-3 text-slate-200"><span className="h-2.5 w-2.5 rounded-full bg-green-500" />Clock In</span>
          <span className="text-slate-400 tabular-nums">{fmtMinutes(shift[0] - 1)}</span>
        </div>
        {onBreak && (
          <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-card px-5 py-3.5 text-[15px]">
            <span className="flex items-center gap-3 text-slate-200"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />Break Start</span>
            <span className="text-slate-400 tabular-nums">1:21 PM</span>
          </div>
        )}
      </div>
      <BottomNav active="Clock" />
    </>
  );
}

// ── App components (visual replicas) ───────────────────────

function StatTiles() {
  const tiles = [
    { value: HERE.length, label: "Here Now", className: "text-green-500 border-green-500/25" },
    { value: ROSTER.length, label: "Scheduled", className: "text-indigo-400 border-indigo-500/25" },
    { value: OFF_TODAY.length, label: "Off", className: "text-slate-400 border-slate-700/80" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((t) => (
        <div key={t.label} className={`rounded-xl border bg-card py-3 text-center ${t.className}`}>
          <div className="text-[28px] font-extrabold leading-none">{t.value}</div>
          <div className="mt-1.5 text-[12px] text-slate-400">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

function CoverageTimeline() {
  const W = 340;
  const H = 120;
  const PAD_L = 18;
  const PAD_B = 18;
  const max = 12;
  const x = (m: number) => PAD_L + ((m - OPEN) / (CLOSE - OPEN)) * (W - PAD_L - 4);
  const y = (v: number) => 6 + (1 - v / max) * (H - PAD_B - 6);
  const base = y(0);

  const sched = SAMPLES.map((m) => [x(m), y(scheduledAt(m))] as const);
  const actual = SAMPLES.filter((m) => m <= NOW).map((m) => [x(m), y(clockedAt(m))] as const);
  actual.push([x(NOW), y(clockedAt(NOW))]);
  const line = (pts: readonly (readonly [number, number])[]) => pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
  const area = (pts: readonly (readonly [number, number])[]) => `${line(pts)}L${pts[pts.length - 1][0].toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z`;
  const nowX = x(NOW);
  const nowY = y(clockedAt(NOW));

  return (
    <div className="rounded-2xl bg-card px-2.5 pb-2.5 pt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 pl-1.5 pr-1">
        <p className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Coverage Timeline</p>
        <div className="flex items-center gap-1.5">
          <LegendPill color="bg-blue-500" label="Scheduled" />
          <LegendPill color="bg-green-500" label="Clocked In" />
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Coverage timeline: ${clockedAt(NOW)} clocked in of ${scheduledAt(NOW)} scheduled at ${fmtMinutes(NOW)}`}>
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
          <path d={area(sched)} fill="url(#lpCov)" />
          <path d={line(sched)} fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinejoin="round" />
          <path d={area(actual)} fill="url(#lpAct)" />
          <path d={line(actual)} fill="none" stroke="#22c55e" strokeWidth="1.8" strokeLinejoin="round" />
          <line x1={nowX} x2={nowX} y1={14} y2={base} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 2.5" />
          <circle cx={nowX} cy={nowY} r={3} fill="#22c55e" />
          <circle cx={nowX} cy={nowY} r={3} fill="none" stroke="#22c55e" strokeWidth={1.5}>
            <animate attributeName="r" values="3;7;3" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.8;0;0.8" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </svg>
        <span
          className="absolute -top-1 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-800 px-[6px] py-[1px] text-[10px] font-bold text-slate-200"
          style={{ left: `${(nowX / W) * 100}%` }}
        >
          {fmtMinutes(NOW)}
        </span>
      </div>
    </div>
  );
}

function LegendPill({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-700/40 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400">
      <span className={`inline-block h-0.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-2.5 mt-5 flex items-center gap-2">
      <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</span>
      <span className="rounded-full bg-slate-800 px-2 py-px text-[11px] font-bold text-slate-400">{count}</span>
    </div>
  );
}

const BADGES: Record<Exclude<Attendance, "upcoming">, { label: string; className: string }> = {
  clocked_in: { label: "Clocked In", className: "bg-green-500/15 text-green-500" },
  on_break: { label: "On Break", className: "bg-amber-500/15 text-amber-400" },
  not_clocked_in: { label: "Not Here Yet", className: "bg-red-500/15 text-red-400" },
};

function ShiftCard({ row }: { row: Row }) {
  const color = SHIFT_COLORS[row.type];
  const badge = row.attendance === "upcoming" ? null : BADGES[row.attendance];
  const active = row.attendance === "clocked_in" || row.attendance === "on_break";
  return (
    <div
      className="mb-2 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-card px-[14px] py-3"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div
        className="flex size-[38px] shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{
          background: `color-mix(in srgb, ${color} 13%, transparent)`,
          border: `1.5px solid color-mix(in srgb, ${color} 33%, transparent)`,
          color,
        }}
      >
        {getMonogram(row.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-semibold ${active ? "text-slate-100" : "text-slate-400"}`}>{row.name}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] capitalize" style={{ color }}>
          <ShiftIcon shiftType={row.type} size={11} color={color} />
          {row.type}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="whitespace-nowrap text-xs text-slate-400">{fmtMinutes(row.start)} – {fmtMinutes(row.end)}</div>
        <div className="mt-[5px] flex justify-end">
          {badge ? (
            <span className={`flex items-center gap-1.5 rounded-md px-[9px] py-1 text-[11px] font-bold ${badge.className}`}>
              {row.attendance === "clocked_in" && <span className="h-2 w-2 rounded-full bg-green-500" />}
              {row.attendance === "on_break" && <span className="h-2 w-2 rounded-full bg-amber-400" />}
              {badge.label}
            </span>
          ) : (
            <span className="text-xs text-slate-400">In {row.start - NOW}m</span>
          )}
        </div>
      </div>
    </div>
  );
}

function shortTime(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min ? `:${String(min).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}
