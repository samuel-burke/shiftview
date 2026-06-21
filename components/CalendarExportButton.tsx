"use client";

// Downloads the signed-in employee's shifts as an .ics file via
// GET /api/my-schedule/calendar. A same-origin anchor download carries the auth
// cookie, so no extra fetch/token plumbing is needed for the authenticated case.

const CALENDAR_URL = "/api/my-schedule/calendar";

export default function CalendarExportButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={CALENDAR_URL}
      download="my-shifts.ics"
      data-testid="calendar-export-button"
      aria-label="Download my shifts as a calendar file"
      className={
        className ||
        "inline-flex items-center gap-2 rounded-xl bg-card border border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 cursor-pointer hover:bg-slate-800 hover:text-slate-100 transition-colors no-underline"
      }
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2 6h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      Add to calendar
    </a>
  );
}
