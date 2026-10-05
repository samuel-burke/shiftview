import { ShiftIcon } from "@/components/ShiftIcons";
import { getMonogram, fmtMinutes, SHIFT_COLORS } from "@/data/types";
import { NOW, type Attendance, type Row } from "./data";

export const REPO_URL = "https://github.com/samuel-burke/shiftview";

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight text-slate-100 ${className}`}>
      Shift
      <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">View</span>
    </span>
  );
}

export const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-200 transition-colors";
export const secondaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 hover:border-slate-500 hover:text-slate-100 transition-colors cursor-pointer";

export function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SectionCopy({
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

export function ChartCard({ title, children, legend }: { title: string; children: React.ReactNode; legend: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card px-2.5 pb-2.5 pt-4">
      <p className="mb-2 pl-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">{title}</p>
      <div className="mb-3 flex items-center gap-2 pl-1.5">{legend}</div>
      {children}
    </div>
  );
}

export function Chip({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-700/40 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400">
      {swatch}
      {label}
    </span>
  );
}

// ── Phone frame ─────────────────────────────────────────────
// Screens are laid out at the app's real 390×844 viewport with the app's own
// classes, then zoomed down (zoom, not transform, so text re-lays out crisply), so they match what people see on their phones.

export const SCALE = 0.72;

export function Phone({ children, label, time = "1:30", overlay }: { children: React.ReactNode; label: string; time?: string; overlay?: React.ReactNode }) {
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
          <StatusBar time={time} />
          <AppHeader />
          <div className="relative flex-1 overflow-hidden">{children}</div>
          {/* Notifications sit over the app header, below the status bar, like iOS banners. */}
          {overlay && <div className="absolute inset-x-3 top-[58px] z-20">{overlay}</div>}
        </div>
      </div>
    </figure>
  );
}

export function StatusBar({ time }: { time: string }) {
  return (
    <div className="relative flex h-[54px] shrink-0 items-center justify-between px-9 pt-1 text-[16px] font-semibold text-slate-100">
      <span className="tabular-nums">{time}</span>
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

export function AppHeader() {
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

export function BottomNav({ active }: { active: "Team" | "Schedule" | "Clock" }) {
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

export function LegendPill({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-700/40 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400">
      <span className={`inline-block h-0.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-2.5 mt-5 flex items-center gap-2">
      <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</span>
      <span className="rounded-full bg-slate-800 px-2 py-px text-[11px] font-bold text-slate-400">{count}</span>
    </div>
  );
}

export const BADGES: Record<Exclude<Attendance, "upcoming">, { label: string; className: string }> = {
  clocked_in: { label: "Clocked In", className: "bg-green-500/15 text-green-500" },
  on_break: { label: "On Break", className: "bg-amber-500/15 text-amber-400" },
  not_clocked_in: { label: "Not Here Yet", className: "bg-red-500/15 text-red-400" },
};

export function ShiftCard({ row, now = NOW }: { row: Row; now?: number }) {
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
            <span className="text-xs text-slate-400">In {row.start - now}m</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ArchitectureDiagram() {
  const box = "rounded-lg border border-slate-700/70 bg-bg/70 px-3 py-2";
  const label = "text-[12px] font-semibold text-slate-200";
  const sub = "mt-0.5 text-[11px] text-slate-400";
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

export function FlowArrow() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center text-slate-600">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="rotate-90 sm:rotate-0">
        <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function StatTiles({ here, scheduled, off }: { here: React.ReactNode; scheduled: React.ReactNode; off: React.ReactNode }) {
  const tiles = [
    { value: here, label: "Here Now", className: "text-green-500 border-green-500/25" },
    { value: scheduled, label: "Scheduled", className: "text-indigo-400 border-indigo-500/25" },
    { value: off, label: "Off", className: "text-slate-400 border-slate-700/80" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((t) => (
        <div key={t.label} className={`rounded-xl border bg-card py-3 text-center ${t.className}`}>
          <div className="text-[28px] font-extrabold leading-none tabular-nums">{t.value}</div>
          <div className="mt-1.5 text-[12px] text-slate-400">{t.label}</div>
        </div>
      ))}
    </div>
  );
}
