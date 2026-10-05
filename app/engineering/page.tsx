import type { Metadata } from "next";
import MarketingShell, { ClosingCta } from "@/components/marketing/MarketingShell";
import { EngineeringSection } from "@/components/marketing/sections";
import { Container } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "Engineering · ShiftView",
  description: "How ShiftView is built: one write path, row-level security, encrypted messages, and CI on every change.",
};

const DECISIONS = [
  {
    title: "Times are minutes since midnight",
    body: "480 is 8:00 AM. Shifts never cross midnight in this domain, so storing minutes sidesteps timezone and DST bugs entirely. Dates are plain YYYY-MM-DD strings.",
  },
  {
    title: "“Off” is derived, not stored",
    body: "Anyone without a schedule row for a date is off that day. Computing it from the roster means there is no second source of truth to drift out of sync.",
  },
  {
    title: "Privileged writes go through a service-role client",
    body: "Tables like managers are write-denied by row-level security for every user. The API performs those writes with an admin client only after verifying manager status itself.",
  },
  {
    title: "The demo is a real tenant",
    body: "“Open the live demo” signs you in anonymously as a manager of a seeded organization. Demo traffic exercises the same routes, business rules and policies as production, and a nightly cron reseeds it.",
  },
];

export default function EngineeringPage() {
  return (
    <MarketingShell active="engineering">
      <EngineeringSection />
      <section className="border-b border-slate-800/60">
        <Container className="py-20 lg:py-28">
          <p className="mb-4 text-sm font-medium text-blue-400">Design decisions</p>
          <h2 className="max-w-xl text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-slate-100 sm:text-4xl">
            Small choices that remove whole classes of bugs.
          </h2>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-800/80 md:grid-cols-2">
            {DECISIONS.map((d, i) => (
              <li key={d.title} className="bg-bg p-6 lg:p-8">
                <span className="font-mono text-xs text-slate-500">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-2 text-base font-semibold text-slate-100">{d.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{d.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>
      <ClosingCta title="Kick the tires on the real thing." />
    </MarketingShell>
  );
}
