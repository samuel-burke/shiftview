import type { Metadata } from "next";
import MarketingShell, { ClosingCta } from "@/components/marketing/MarketingShell";
import {
  CapabilityMap,
  ClockSection,
  CoverageSection,
  PlannerSection,
  RequestsSection,
  ScheduleSection,
} from "@/components/marketing/sections";
import { Container } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "Product · ShiftView",
  description: "Live coverage, scheduling, planning, approvals and a mobile time clock for shift teams.",
};

export default function ProductPage() {
  const toc = [
    ["#coverage", "Coverage"],
    ["#scheduling", "Scheduling"],
    ["#planning", "Planning"],
    ["#requests", "Approvals"],
    ["#time-clock", "Time clock"],
    ["#everything", "Everything else"],
  ];
  return (
    <MarketingShell active="product">
      <section className="border-b border-slate-800/60">
        <Container className="pt-16 pb-12 lg:pt-24 lg:pb-16">
          <p className="mb-4 text-sm font-medium text-blue-400">Product</p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-0.035em] text-slate-100 sm:text-6xl">
            From the schedule to the paycheck.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
            Every screen below is the real app, running on the same sample store as the live demo.
          </p>
          <nav aria-label="On this page" className="mt-10 flex flex-wrap gap-2">
            {toc.map(([href, label]) => (
              <a key={href} href={href} className="rounded-full border border-slate-800 px-3.5 py-1.5 text-sm text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100">
                {label}
              </a>
            ))}
          </nav>
        </Container>
      </section>
      <CoverageSection />
      <ScheduleSection />
      <PlannerSection />
      <RequestsSection />
      <ClockSection />
      <div id="everything" className="scroll-mt-16"><CapabilityMap /></div>
      <ClosingCta />
    </MarketingShell>
  );
}
