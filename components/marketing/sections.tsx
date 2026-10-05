import { LiveClockPhone, LiveCoveragePanel, LiveRequestsPhone, PlannerPreview, SchedulePhone } from "./live";
import { Container, SectionCopy } from "./ui";

// Long-form sections for /product.

export function CoverageSection() {
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
          <LiveCoveragePanel />
        </div>
      </Container>
    </section>
  );
}

export function ScheduleSection() {
  return (
    <section id="scheduling" className="scroll-mt-16 border-b border-slate-800/60">
      <Container className="grid items-center gap-14 py-20 lg:grid-cols-2 lg:gap-16 lg:py-28">
        <div className="order-2 flex justify-center lg:order-1">
          <SchedulePhone />
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

export function ClockSection() {
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
          <LiveClockPhone label="Employee clock screen: breaks, punches and a ticking timer" />
        </div>
      </Container>
    </section>
  );
}

export function PlannerSection() {
  return (
    <section id="planning" className="scroll-mt-16 border-b border-slate-800/60">
      <Container className="py-16 sm:py-20 lg:py-28">
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

export function RequestsSection() {
  return (
    <section id="requests" className="scroll-mt-16 border-b border-slate-800/60">
      <Container className="grid items-center gap-14 py-20 lg:grid-cols-2 lg:gap-16 lg:py-28">
        <div className="order-2 flex justify-center lg:order-1">
          <LiveRequestsPhone />
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

export function CapabilityMap() {
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
      <Container className="py-16 sm:py-20 lg:py-28">
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
