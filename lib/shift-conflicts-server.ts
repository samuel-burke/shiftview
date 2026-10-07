import { fmtMinutes } from "@/data/types";
import { addDaysToKey, dayOfWeekForKey, formatDateKey } from "@/lib/dates";
import { shiftParts, shiftsOverlap } from "@/lib/shift-times";
import { fitsAvailability, isUnavailableAllDay } from "@/lib/availability-rules";

type QueryClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type ShiftConflict =
  | { conflict: "time_off"; message: string }
  | { conflict: "availability"; window: { startMinutes: number; endMinutes: number } | null; message: string };

// Soft conflicts a manager may override: approved time off, or availability,
// on every day the shift touches — both days for an overnight shift (its
// after-midnight part must fit the next weekday's availability, from 0:00).
export async function findShiftConflict(
  supabase: QueryClient,
  orgId: string,
  employeeId: number,
  date: string,
  startMinutes: number,
  endMinutes: number,
): Promise<ShiftConflict | null> {
  for (const part of shiftParts({ date, startMinutes, endMinutes })) {
    const { data: timeOff } = await supabase
      .from("time_off_requests")
      .select("id, status")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("date", part.date)
      .eq("status", "approved")
      .maybeSingle();
    if (timeOff) {
      return { conflict: "time_off", message: `Employee has approved time off on ${part.date}` };
    }

    const { data: avail } = await supabase
      .from("availability")
      .select("id, start_minutes, end_minutes")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("day_of_week", dayOfWeekForKey(part.date))
      .maybeSingle();
    if (!avail) continue;
    const rule = { startMinutes: avail.start_minutes, endMinutes: avail.end_minutes };
    if (fitsAvailability(rule, part.start, part.end)) continue;

    const weekday = formatDateKey(part.date, { weekday: "long" });
    if (isUnavailableAllDay(rule)) {
      return { conflict: "availability", window: null, message: `Employee is unavailable on ${weekday}s` };
    }
    return {
      conflict: "availability",
      window: { startMinutes: avail.start_minutes, endMinutes: avail.end_minutes },
      message: part.date === date
        ? `Shift falls outside employee's availability window (${fmtMinutes(avail.start_minutes)} – ${fmtMinutes(avail.end_minutes)})`
        : `The after-midnight part of this shift falls outside employee's ${weekday} availability (${fmtMinutes(avail.start_minutes)} – ${fmtMinutes(avail.end_minutes)})`,
    };
  }
  return null;
}

// A hard conflict (not overridable): the shift overlaps another of the
// employee's shifts in `table` on the day before, the same day, or the day
// after — e.g. an overnight shift running into the next morning's shift.
export async function findShiftOverlap(
  supabase: QueryClient,
  table: "schedules" | "draft_schedules",
  orgId: string,
  employeeId: number,
  date: string,
  startMinutes: number,
  endMinutes: number,
  excludeId?: number,
): Promise<string | null> {
  const { data } = await supabase
    .from(table)
    .select("id, date, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .gte("date", addDaysToKey(date, -1))
    .lte("date", addDaysToKey(date, 1));
  const shift = { date, startMinutes, endMinutes };
  for (const r of (Array.isArray(data) ? data : []) as { id: number; date: string; start_minutes: number; end_minutes: number }[]) {
    if (excludeId != null && r.id === excludeId) continue;
    const other = { date: String(r.date).slice(0, 10), startMinutes: r.start_minutes, endMinutes: r.end_minutes };
    if (other.date === date) continue; // same-day duplicates are rejected separately
    if (shiftsOverlap(shift, other)) {
      return `Overlaps this employee's ${fmtMinutes(other.startMinutes)} – ${fmtMinutes(other.endMinutes)} shift on ${formatDateKey(other.date, { weekday: "short", month: "short", day: "numeric" })}`;
    }
  }
  return null;
}
