import Link from "next/link";
import TryDemoButton from "@/components/TryDemoButton";
import MarketingShell, { ClosingCta } from "@/components/marketing/MarketingShell";
import { AutoScheduleDemo, DevicesDemo, HeroDemo, Reveal, TeamDemo, TimeClockDemo } from "@/components/marketing/live";
import { Arrow, Container, REPO_URL, SectionHeading, primaryBtn, secondaryBtn } from "@/components/marketing/ui";
import { DEMO_SETTINGS } from "@/data/demo-fixtures";
import { todayKeyInTz } from "@/lib/dates";

// The home page for signed-out visitors, and the whole product tour: each
// section is a heading, one line, and the real app showing it. The demos run
// on the sample store's own today, so dates and weekdays line up with the live
// demo's.
export default function LandingPage() {
  const today = todayKeyInTz(DEMO_SETTINGS.timezone);
  return (
    <MarketingShell>
      <Hero today={today} />
      <TimeClock today={today} />
      <AutoSchedule today={today} />
      <AnyDevice today={today} />
      <Team today={today} />
      <Features />
      <TrustStrip />
      <ClosingCta />
    </MarketingShell>
  );
}

// Old /product links (/product#planning and so on) land on the matching section.
function Anchor({ id }: { id: string }) {
  return <span id={id} aria-hidden="true" className="block scroll-mt-16" />;
}

function Hero({ today }: { today: string }) {
  return (
    <section className="overflow-hidden border-b border-slate-800/60">
      <Anchor id="coverage" />
      <Container className="grid items-center gap-12 pb-16 pt-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8 lg:pb-24 lg:pt-20">
        <div className="max-w-xl">
          <p className="mb-5 flex items-center gap-2 text-sm font-medium text-slate-400">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            Scheduling and time clock for retail &amp; fulfillment teams
          </p>
          <h1 className="text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.035em] text-slate-100 sm:text-6xl lg:text-[4.25rem]">
            Know who&rsquo;s on the floor. Right now.
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-slate-400 sm:text-lg">
            Schedules, a time clock on every phone, and coverage that updates the moment someone clocks in.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-start">
            <Link href="/signup" className={primaryBtn}>
              Start free <Arrow />
            </Link>
            <TryDemoButton className={`${secondaryBtn} w-full sm:w-auto`}>Open the live demo</TryDemoButton>
          </div>
          <p className="mt-5 text-xs text-slate-400">No credit card. The demo is a real store with sample data that resets nightly.</p>
          <p className="mt-2 text-xs text-slate-400">
            ShiftView is in beta. Found a bug or missing something?{" "}
            <Link href="/contact?topic=feedback" className="font-medium text-slate-200 underline underline-offset-2 transition-colors hover:text-slate-50">
              Tell us
            </Link>
          </p>
        </div>
        <HeroDemo date={today} />
      </Container>
    </section>
  );
}

function TimeClock({ today }: { today: string }) {
  const points = ["Geofenced clock-in", "One-tap breaks", "Missed-punch corrections", "Time card CSV export"];
  return (
    <section id="time-clock" className="scroll-mt-16 border-b border-slate-800/60">
      <Container className="py-16 sm:py-20 lg:py-28">
        <Reveal>
          <SectionHeading
            eyebrow="Time clock"
            title="Every punch, on the time card."
            body="Staff clock in, take breaks and clock out on their phones. Each punch lands on their time card with hours worked, late punches flagged, ready to export for payroll."
          />
        </Reveal>
        <Reveal className="mt-12 lg:mt-16">
          <TimeClockDemo date={today} />
        </Reveal>
        <ul className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm text-slate-400">
          {points.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </Container>
    </section>
  );
}

function AutoSchedule({ today }: { today: string }) {
  return (
    <section id="auto-schedule" className="scroll-mt-16 border-b border-slate-800/60">
      <Anchor id="planning" />
      <Anchor id="scheduling" />
      <Container className="py-16 sm:py-20 lg:py-28">
        <Reveal>
          <SectionHeading
            eyebrow={<>Auto-schedule <span className="rounded-full border border-violet-500/30 bg-violet-500/15 px-2 py-px text-[11px] font-semibold text-violet-300">New</span></>}
            title="Next week, scheduled in seconds."
            body="It builds the week from your coverage targets, availability, time off and hour limits, and explains anything it can't cover. Nothing goes live until you publish."
          />
        </Reveal>
        <Reveal className="mt-12 lg:mt-14">
          <AutoScheduleDemo date={today} />
        </Reveal>
      </Container>
    </section>
  );
}

function AnyDevice({ today }: { today: string }) {
  const devices = ["Phones: iPhone and Android", "Tablets: iPad and Android", "Computers: Mac, Windows, Chromebook"];
  return (
    <section id="any-device" className="scroll-mt-16 border-b border-slate-800/60">
      <Container className="py-16 sm:py-20 lg:py-28">
        <Reveal>
          <SectionHeading
            eyebrow="Any device"
            title="On every screen your team already has."
            body="Phone, tablet or laptop, everyone sees the same live schedule. It installs straight from the browser, no app store needed."
          />
        </Reveal>
        <Reveal className="mt-12 lg:mt-16">
          <DevicesDemo date={today} />
        </Reveal>
        <ul className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm text-slate-400">
          {devices.map((d) => <li key={d}>{d}</li>)}
        </ul>
      </Container>
    </section>
  );
}

function Team({ today }: { today: string }) {
  return (
    <section id="team" className="scroll-mt-16 border-b border-slate-800/60">
      <Anchor id="requests" />
      <Container className="py-16 sm:py-20 lg:py-28">
        <Reveal>
          <SectionHeading
            eyebrow="For the whole team"
            title="Fewer texts, more covered shifts."
            body="Staff check their week, swap shifts and ask for time off from their phones. You approve with a tap."
          />
        </Reveal>
        <div className="mt-12 lg:mt-16">
          <TeamDemo date={today} />
        </div>
      </Container>
    </section>
  );
}

// One style for every feature icon, the app's nav icons': a 24-unit grid,
// 1.5 strokes with round ends, no fills.
function FeatureIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const calendar = (
  <>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </>
);

const FEATURES: { label: string; icon: React.ReactNode }[] = [
  { label: "Live coverage alerts", icon: <><path d="M10.3 4.3 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4M12 17h.01" /></> },
  { label: "Late clock-in alerts", icon: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9.5V13l2.5 2M5 3.5 2.5 6M19 3.5 21.5 6" /></> },
  { label: "Geofenced clock-in", icon: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></> },
  { label: "Breaks and missed punches", icon: <><path d="M3 9.5h14V14a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6V9.5Z" /><path d="M17 11h1.5a3 3 0 0 1 0 6H17M7 3.5v3M10 3.5v3M13 3.5v3" /></> },
  { label: "Templates and copy week", icon: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></> },
  { label: "Availability", icon: <>{calendar}<path d="m9 15.5 2 2 4-4" /></> },
  { label: "Time-off requests", icon: <>{calendar}<path d="m10 14 4 4M14 14l-4 4" /></> },
  { label: "Two-step shift swaps", icon: <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /> },
  { label: "Open shifts to pick up", icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5M19 8v6M16 11h6" /></> },
  { label: "One-tap call-outs", icon: <><path d="M2.5 10v4a1 1 0 0 0 1 1H6l7 5V4L6 9H3.5a1 1 0 0 0-1 1Z" /><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" /></> },
  { label: "Encrypted messages", icon: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /><path d="M8 10h8M8 13h5" /></> },
  { label: "Push shift reminders", icon: <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.44V11a6 6 0 0 0-5-5.92V4a1 1 0 1 0-2 0v1.08A6 6 0 0 0 6 11v3.16c0 .54-.21 1.06-.6 1.44L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" /> },
  { label: "Labor budget and cost", icon: <path d="M12 4.5v15M16.5 9c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3" /> },
  { label: "Payroll CSV export", icon: <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /> },
  { label: "Payroll and punctuality reports", icon: <path d="M18 20V10M12 20V4M6 20v-6" /> },
  { label: "Audit log of every change", icon: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></> },
];

function Features() {
  return (
    <section id="features" className="scroll-mt-16 border-b border-slate-800/60">
      <Anchor id="everything" />
      <Container className="py-16 sm:py-20 lg:py-28">
        <Reveal>
          <h2 className="max-w-xl text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-slate-100 sm:text-[2.75rem]">
            Everything a shift team runs on.
          </h2>
        </Reveal>
        <ul className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-800/80 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li key={f.label} className="flex items-center gap-3 bg-bg px-3 py-3.5 text-[13px] leading-snug text-slate-300 sm:px-5 sm:py-4 sm:text-sm">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-card text-blue-400">
                <FeatureIcon>{f.icon}</FeatureIcon>
              </span>
              {f.label}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

function TrustStrip() {
  const facts = [
    "Row-level security on every table",
    "1,600+ automated tests on every change",
    "Messages encrypted at rest",
    "Open source",
  ];
  return (
    <section className="border-b border-slate-800/60">
      <Container className="flex flex-col gap-6 py-10 lg:flex-row lg:items-center lg:justify-between">
        <ul className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-slate-400">
          {facts.map((f) => (
            <li key={f} className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-green-500">
                <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {f}
            </li>
          ))}
        </ul>
        <a href={REPO_URL} className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-slate-200 transition-colors hover:text-slate-50">
          View the source <Arrow />
        </a>
      </Container>
    </section>
  );
}
