// The printable week: one row per person, one cell per day, with every shift
// (and its note) or time off in the cell. Pure, so the print page and its
// tests agree.

import { fmtMinutes } from "@/data/types";

export type PrintShift = { employeeId: number; date: string; startMinutes: number; endMinutes: number; note?: string | null };
export type PrintTimeOff = { employeeId: number; date: string; status: string; startMinutes?: number | null; endMinutes?: number | null };
export type PrintCell = { lines: string[]; notes: string[]; off: string | null };
export type PrintRow = { employeeId: number; name: string; cells: PrintCell[]; hours: number };

export function buildPrintRows(
  employees: { id: number; name: string }[],
  shifts: PrintShift[],
  timeOff: PrintTimeOff[],
  dates: string[]
): PrintRow[] {
  const rows = employees.map((e) => {
    let minutes = 0;
    const cells = dates.map((date): PrintCell => {
      const mine = shifts
        .filter((s) => s.employeeId === e.id && s.date.slice(0, 10) === date)
        .sort((a, b) => a.startMinutes - b.startMinutes);
      minutes += mine.reduce((n, s) => n + (s.endMinutes - s.startMinutes), 0);
      const approved = timeOff.find((t) => t.employeeId === e.id && t.date.slice(0, 10) === date && t.status === "approved");
      return {
        lines: mine.map((s) => `${fmtMinutes(s.startMinutes)} – ${fmtMinutes(s.endMinutes)}`),
        notes: mine.map((s) => s.note).filter((n): n is string => !!n),
        off: approved
          ? approved.startMinutes != null && approved.endMinutes != null
            ? `Off ${fmtMinutes(approved.startMinutes)} – ${fmtMinutes(approved.endMinutes)}`
            : "Off"
          : null,
      };
    });
    return { employeeId: e.id, name: e.name, cells, hours: Math.round((minutes / 60) * 10) / 10 };
  });
  // People with shifts first, then alphabetical: the printed sheet leads with who's working.
  return rows.sort((a, b) => Number(b.hours > 0) - Number(a.hours > 0) || a.name.localeCompare(b.name));
}
