import Link from "next/link";
import TryDemoButton from "@/components/TryDemoButton";
import MarketingShell, { ClosingCta } from "@/components/marketing/MarketingShell";
import { AutoScheduleDemo, DevicesDemo, HeroDemo, Reveal, TeamDemo, TimeClockDemo } from "@/components/marketing/live";
import { Arrow, Container, REPO_URL, SectionHeading, primaryBtn, secondaryBtn } from "@/components/marketing/ui";
import {
  AdminIcon,
  ClockIcon,
  ReportsIcon,
  RequestsIcon,
  WeekGridIcon,
} from "@/components/SideNav";
import { AlarmIcon, BellIcon, CalendarIcon, ChatBubbleIcon, MegaphoneIcon, TimeOffPendingIcon, WarningIcon } from "@/components/ShiftIcons";
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

function Features() {
  const icon = (d: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const features: { label: string; icon: React.ReactNode }[] = [
    { label: "Live coverage alerts", icon: <WarningIcon size={18} /> },
    { label: "Late clock-in alerts", icon: <AlarmIcon size={18} /> },
    { label: "Geofenced clock-in", icon: icon("M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z") },
    { label: "Breaks and missed punches", icon: <ClockIcon size={18} /> },
    { label: "Templates and copy week", icon: <WeekGridIcon size={18} /> },
    { label: "Availability", icon: <CalendarIcon size={18} /> },
    { label: "Time-off requests", icon: <TimeOffPendingIcon size={18} /> },
    { label: "Two-step shift swaps", icon: icon("M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7") },
    { label: "Open shifts to pick up", icon: <RequestsIcon size={18} /> },
    { label: "One-tap call-outs", icon: <MegaphoneIcon size={18} /> },
    { label: "Encrypted messages", icon: <ChatBubbleIcon size={18} /> },
    { label: "Push shift reminders", icon: <BellIcon size={18} /> },
    { label: "Labor budget and cost", icon: icon("M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3") },
    { label: "Payroll CSV export", icon: icon("M12 4v11m0 0-4-4m4 4 4-4M5 20h14") },
    { label: "Payroll and punctuality reports", icon: <ReportsIcon size={18} /> },
    { label: "Audit log of every change", icon: <AdminIcon size={18} /> },
  ];
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
          {features.map((f) => (
            <li key={f.label} className="flex items-center gap-3 bg-bg px-3 py-3.5 text-[13px] leading-snug text-slate-300 sm:px-5 sm:py-4 sm:text-sm">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-card text-blue-400">{f.icon}</span>
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
