import Link from "next/link";
import TryDemoButton from "@/components/TryDemoButton";
import MarketingShell, { ClosingCta } from "@/components/marketing/MarketingShell";
import { LiveClockPhone, LiveCoverageCard, LiveTeamPhone, LiveTimerCard, NextShiftCard, Reveal, WeekStrip } from "@/components/marketing/live";
import { Arrow, Container, primaryBtn, secondaryBtn } from "@/components/marketing/ui";

// Home page for signed-out visitors. Kept deliberately short: the hero, three
// product pillars that link into /product, a trust line that links into
// /engineering, and a call to action.
export default function LandingPage() {
  return (
    <MarketingShell>
      <Hero />
      <Pillars />
      <TrustStrip />
      <ClosingCta />
    </MarketingShell>
  );
}

function Hero() {
  return (
    <section className="border-b border-slate-800/60">
      <Container className="grid items-center gap-14 pt-16 pb-20 lg:grid-cols-[1fr_auto] lg:gap-10 lg:pt-24 lg:pb-28">
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
            Build the week, watch coverage update as people clock in, and approve requests from your phone. One app for managers and staff.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-start">
            <Link href="/signup" className={primaryBtn}>
              Start free <Arrow />
            </Link>
            <TryDemoButton className={`${secondaryBtn} w-full sm:w-auto`}>
              Open the live demo
            </TryDemoButton>
          </div>
          <p className="mt-5 text-xs text-slate-400">
            No credit card. The demo is a real workspace with sample data that resets nightly.
          </p>
        </div>

        <div className="relative mx-auto flex justify-center lg:mx-0 lg:pr-4">
          <div className="absolute right-[262px] top-20 hidden xl:block">
            <LiveClockPhone />
          </div>
          <div className="relative">
            <LiveTeamPhone />
          </div>
        </div>
      </Container>
    </section>
  );
}

function Pillars() {
  const pillars = [
    {
      href: "/product#coverage",
      eyebrow: "Coverage",
      title: "See gaps as they happen",
      body: "Planned staffing and real clock-ins on one timeline, updated live.",
      preview: <LiveCoverageCard />,
    },
    {
      href: "/product#scheduling",
      eyebrow: "Scheduling",
      title: "A week in minutes",
      body: "Templates, copy-week and availability checks. Staff see it on their phones.",
      preview: <><WeekStrip /><NextShiftCard /></>,
    },
    {
      href: "/product#time-clock",
      eyebrow: "Time clock",
      title: "Clock in from anywhere on site",
      body: "Geofenced punches, one-tap breaks and payroll-ready exports.",
      preview: <LiveTimerCard />,
    },
  ];
  return (
    <section className="border-b border-slate-800/60">
      <Container className="py-16 sm:py-20 lg:py-28">
        <Reveal>
          <h2 className="max-w-xl text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-slate-100 sm:text-4xl">
            Everything a shift team runs on, in one place.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {pillars.map((p, i) => (
            <Reveal key={p.href} delay={i * 0.08} className="h-full">
              <Link
                href={p.href}
                className="group flex h-full flex-col rounded-2xl border border-slate-800 p-5 transition-colors hover:border-slate-700 hover:bg-slate-900/40 sm:p-6"
              >
                <div className="min-h-[240px] flex-1">{p.preview}</div>
                <p className="mt-6 text-sm font-medium text-blue-400">{p.eyebrow}</p>
                <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-slate-100">{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{p.body}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-300 transition-colors group-hover:text-slate-100">
                  Learn more <span className="transition-transform group-hover:translate-x-0.5"><Arrow /></span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-10">
          <Link href="/product" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-200 transition-colors hover:text-white">
            Tour the whole product: planning, approvals, messaging and reports <Arrow />
          </Link>
        </Reveal>
      </Container>
    </section>
  );
}

function TrustStrip() {
  const facts = [
    "Row-level security on every table",
    "1,100+ automated tests on every change",
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
        <Link href="/engineering" className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-slate-200 transition-colors hover:text-white">
          How it&rsquo;s built <Arrow />
        </Link>
      </Container>
    </section>
  );
}
