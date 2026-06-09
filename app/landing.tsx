import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-bg text-slate-100 overflow-x-hidden">
      <LandingNav />
      <HeroSection />
      <FeaturesSection />
      <LandingFooter />
    </main>
  );
}

function LandingNav() {
  return (
    <nav aria-label="Site navigation" className="flex items-center justify-between px-6 py-4 lg:px-12 max-w-7xl mx-auto">
      <div className="text-xl font-extrabold text-slate-100 tracking-tight">
        Shift
        <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">
          View
        </span>
      </div>
      <a
        href="/login"
        className="text-sm font-semibold text-slate-300 border border-slate-700 rounded-xl px-4 py-2 hover:border-slate-500 hover:text-slate-100 transition-colors"
      >
        Sign In
      </a>
    </nav>
  );
}

function HeroSection() {
  return (
    <section className="max-w-7xl mx-auto px-6 lg:px-12 pt-10 pb-20 flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
      {/* Copy */}
      <div className="flex-1 text-center lg:text-left">
        <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-full px-3 py-1.5 text-xs text-blue-400 font-semibold mb-6">
          <LiveDot />
          Real-time shift coverage
        </div>

        <h1 className="text-4xl lg:text-5xl xl:text-6xl font-extrabold leading-[1.1] tracking-tight mb-5">
          The smarter way<br className="hidden sm:block" /> to run your{" "}
          <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">
            shifts
          </span>
        </h1>

        <p className="text-slate-400 text-base lg:text-lg mb-8 max-w-md mx-auto lg:mx-0 leading-relaxed">
          Real-time team coverage, effortless scheduling, and mobile clock-in — everything your team needs on one screen.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
          <a
            href="/login"
            className="bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold px-7 py-3.5 rounded-xl text-sm text-center hover:opacity-90 transition-opacity"
          >
            Sign In
          </a>
          <Link
            href="/?demo=true"
            className="border border-slate-700 text-slate-300 font-semibold px-7 py-3.5 rounded-xl text-sm text-center hover:border-slate-500 hover:text-slate-100 transition-colors"
          >
            View Demo <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="inline-block align-[-1px]"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </Link>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          No credit card required · Demo uses sample data
        </p>
      </div>

      {/* Mock dashboard preview */}
      <div className="flex-1 w-full max-w-[360px] lg:max-w-none mx-auto">
        <MockDashboard />
      </div>
    </section>
  );
}

function LiveDot() {
  return (
    <span aria-hidden="true" className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
    </span>
  );
}

function MockDashboard() {
  return (
    <div className="bg-card rounded-2xl border border-slate-800 shadow-2xl shadow-black/40 overflow-hidden">
      {/* App top bar */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-800/60">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest">Today</div>
            <div className="text-sm font-bold text-slate-100">Mon, Jun 2</div>
          </div>
          <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
            <span className="text-[10px] text-green-400 font-semibold">Optimal</span>
          </div>
        </div>

        {/* Coverage timeline */}
        <div className="relative h-8 bg-bg rounded-lg overflow-hidden mt-2">
          <div className="absolute inset-y-0 left-[15%] right-[10%] rounded bg-blue-500/10" />
          {/* Shift bars */}
          <div className="absolute top-1 left-[15%] w-[35%] h-1.5 rounded-full bg-amber-400/70" />
          <div className="absolute top-3.5 left-[28%] w-[40%] h-1.5 rounded-full bg-sky-400/70" />
          <div className="absolute top-6 left-[40%] w-[35%] h-1.5 rounded-full bg-violet-400/70" />
          {/* Now line */}
          <div className="absolute inset-y-0 left-[42%] w-px bg-blue-400/80" />
          <div className="absolute top-0 left-[42%] -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-blue-400" />
        </div>
      </div>

      {/* Team list */}
      <div className="p-3 space-y-2">
        {[
          { name: "Jordan M.", role: "Opener · 6 am – 2 pm", bar: "bg-amber-400", status: "Here", statusColor: "text-green-400 bg-green-500/10 border-green-500/20" },
          { name: "Casey L.", role: "Mid · 10 am – 6 pm", bar: "bg-sky-400", status: "Here", statusColor: "text-green-400 bg-green-500/10 border-green-500/20" },
          { name: "Alex R.", role: "Closer · 2 pm – 10 pm", bar: "bg-violet-400", status: "Late", statusColor: "text-red-400 bg-red-500/10 border-red-500/20" },
          { name: "Sam K.", role: "Opener · 6 am – 2 pm", bar: "bg-amber-400", status: "Off Today", statusColor: "text-slate-500 bg-slate-800 border-slate-700" },
        ].map((emp) => (
          <div
            key={emp.name}
            className="flex items-center gap-3 rounded-xl bg-bg/60 px-3 py-2.5"
          >
            <div className={`w-0.5 h-7 rounded-full ${emp.bar} flex-shrink-0`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-200 truncate">{emp.name}</div>
              <div className="text-[10px] text-slate-500 truncate">{emp.role}</div>
            </div>
            <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${emp.statusColor}`}>
              {emp.status}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom nav mock */}
      <div className="flex border-t border-slate-800/60">
        {[
          { label: "Team", active: true, icon: TeamIcon },
          { label: "Schedule", active: false, icon: CalendarIcon },
          { label: "Clock", active: false, icon: ClockIcon },
        ].map(({ label, active, icon: Icon }) => (
          <div
            key={label}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold ${active ? "text-blue-400" : "text-slate-500"}`}
          >
            <Icon />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function FeaturesSection() {
  return (
    <section className="max-w-7xl mx-auto px-6 lg:px-12 pb-24">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FeatureCard
          icon={<CoverageIcon />}
          title="Live Coverage"
          description="See who's in, running late, or off at a glance. Instant alerts when you drop below minimum coverage."
          gradient="from-blue-500/10 to-blue-500/5"
          border="border-blue-500/20"
          iconColor="text-blue-400"
        />
        <FeatureCard
          icon={<ScheduleIcon />}
          title="Smart Scheduling"
          description="Build weekly schedules in minutes with templates, copy-forward, and built-in availability tracking."
          gradient="from-violet-500/10 to-violet-500/5"
          border="border-violet-500/20"
          iconColor="text-violet-400"
        />
        <FeatureCard
          icon={<PhoneIcon />}
          title="Mobile Clock-In"
          description="Employees clock in and out from their phone. Managers get notified of late arrivals instantly."
          gradient="from-cyan-500/10 to-cyan-500/5"
          border="border-cyan-500/20"
          iconColor="text-cyan-400"
        />
      </div>
    </section>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  gradient,
  border,
  iconColor,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  gradient: string;
  border: string;
  iconColor: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${gradient} border ${border} rounded-2xl p-6`}>
      <div className={`mb-4 ${iconColor}`}>{icon}</div>
      <h2 className="text-base font-bold text-slate-100 mb-2">{title}</h2>
      <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-slate-800/60 py-6 px-6 text-center">
      <p className="text-xs text-slate-500">
        ShiftView · Schedule management for retail &amp; fulfillment teams
      </p>
    </footer>
  );
}

// ── Mini nav icons ──────────────────────────────────────────

function TeamIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// ── Feature section icons ───────────────────────────────────

function CoverageIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="14" x2="8" y2="14" />
      <line x1="12" y1="14" x2="12" y2="14" />
      <line x1="16" y1="14" x2="16" y2="14" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}
