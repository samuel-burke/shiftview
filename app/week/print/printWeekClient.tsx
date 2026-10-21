"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppData } from "@/lib/AppDataContext";
import { useStoreTodayKey } from "@/hooks/useStoreTodayKey";
import { formatDateKey, isDateKey, weekStartForKey } from "@/lib/dates";
import { weekDates } from "@/lib/draft-metrics";
import { buildPrintRows, type PrintShift, type PrintTimeOff } from "@/lib/week-print";

// A plain, printable sheet of the published week (?week=YYYY-MM-DD): people
// down the side, days across, every shift with its note. It opens the print
// dialog once loaded.

export default function PrintWeekClient() {
  const params = useSearchParams();
  const { sharedLoading, settings } = useAppData();
  const todayKey = useStoreTodayKey(settings.timezone);
  const requested = params.get("week");
  const weekStart = requested && isDateKey(requested) ? requested : weekStartForKey(todayKey, settings.firstDayOfWeek);
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);

  const [employees, setEmployees] = useState<{ id: number; name: string }[] | null>(null);
  const [shifts, setShifts] = useState<PrintShift[] | null>(null);
  const [timeOff, setTimeOff] = useState<PrintTimeOff[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sharedLoading) return;
    let cancelled = false;
    Promise.all([
      fetch("/api/employees").then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch(`/api/schedules?from=${dates[0]}&to=${dates[6]}`).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch(`/api/time-off?from=${dates[0]}&to=${dates[6]}`).then((r) => (r.ok ? r.json() : { requests: [] })),
    ])
      .then(([emps, live, off]) => {
        if (cancelled) return;
        setEmployees(Array.isArray(emps) ? emps : []);
        setShifts(Array.isArray(live) ? live : []);
        setTimeOff(Array.isArray(off?.requests) ? off.requests : []);
      })
      .catch(() => { if (!cancelled) setError("Couldn't load the week. Refresh to try again."); });
    return () => { cancelled = true; };
  }, [sharedLoading, dates]);

  const rows = useMemo(
    () => (employees && shifts ? buildPrintRows(employees, shifts, timeOff, dates) : null),
    [employees, shifts, timeOff, dates]
  );

  // Open the print dialog once, when the sheet is ready.
  const ready = rows !== null;
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(t);
  }, [ready]);

  const title = `Schedule · ${formatDateKey(dates[0], { month: "short", day: "numeric" })} – ${formatDateKey(dates[6], { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <main className="print-sheet bg-bg text-fg min-h-dvh p-6 print:p-0" data-testid="print-week">
      <style>{`@media print { @page { size: landscape; margin: 12mm; } .no-print { display: none !important; } }`}</style>
      <div className="flex items-baseline justify-between mb-4 gap-4">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="no-print flex gap-2">
          <button type="button" onClick={() => window.print()} className="px-3 py-1.5 rounded border border-line-strong text-sm cursor-pointer">Print</button>
          <a href={`/week?week=${weekStart}`} className="px-3 py-1.5 rounded border border-line-strong text-sm">Back to week</a>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {!rows && !error && <p>Loading…</p>}
      {rows && (
        <table className="w-full border-collapse text-[11px] leading-snug">
          <thead>
            <tr>
              <th className="border border-line-strong p-1.5 text-left w-[14%]">Team</th>
              {dates.map((d) => (
                <th key={d} className="border border-line-strong p-1.5 text-left">
                  {formatDateKey(d, { weekday: "short", month: "numeric", day: "numeric" })}
                </th>
              ))}
              <th className="border border-line-strong p-1.5 text-right w-[6%]">Hours</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId} className="break-inside-avoid">
                <td className="border border-line-strong p-1.5 font-semibold">{r.name}</td>
                {r.cells.map((c, i) => (
                  <td key={dates[i]} className="border border-line-strong p-1.5 align-top">
                    {c.lines.map((l) => <div key={l} className="font-semibold tabular-nums">{l}</div>)}
                    {c.notes.map((n, j) => <div key={j} className="italic">{n}</div>)}
                    {c.off && <div>{c.off}</div>}
                  </td>
                ))}
                <td className="border border-line-strong p-1.5 text-right tabular-nums">{r.hours || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
