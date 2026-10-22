import { fmtMinutes } from "@/data/types";
import { addDaysToKey, dayOfWeekForKey, formatDateKey } from "@/lib/dates";
import { shiftParts, shiftsOverlap } from "@/lib/shift-times";
import { fitsAvailability, isUnavailableAllDay } from "@/lib/availability-rules";
import { timeOffOverlaps, timeOffWindow } from "@/lib/time-off";
import { limitsFromColumns, parseSchedulingRules } from "@/lib/scheduling-rules";
import { checkShiftRules, type RuleWarning } from "@/lib/shift-rules";

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
      .select("id, status, start_minutes, end_minutes")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("date", part.date)
      .eq("status", "approved")
      .maybeSingle();
    if (timeOff && timeOffOverlaps(timeOffWindow(timeOff), part.start, part.end)) {
      const w = timeOffWindow(timeOff);
      return {
        conflict: "time_off",
        message: w
          ? `Employee has approved time off on ${part.date} from ${fmtMinutes(w.startMinutes)} to ${fmtMinutes(w.endMinutes)}`
          : `Employee has approved time off on ${part.date}`,
      };
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
  exclude?: number | number[],
): Promise<string | null> {
  const skip = new Set(exclude == null ? [] : Array.isArray(exclude) ? exclude : [exclude]);
  const { data } = await supabase
    .from(table)
    .select("id, date, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .gte("date", addDaysToKey(date, -1))
    .lte("date", addDaysToKey(date, 1));
  const shift = { date, startMinutes, endMinutes };
  for (const r of (Array.isArray(data) ? data : []) as { id: number; date: string; start_minutes: number; end_minutes: number }[]) {
    if (skip.has(r.id)) continue;
    const other = { date: String(r.date).slice(0, 10), startMinutes: r.start_minutes, endMinutes: r.end_minutes };
    if (other.date === date) continue; // same-day duplicates are rejected separately
    if (shiftsOverlap(shift, other)) {
      return `Overlaps this employee's ${fmtMinutes(other.startMinutes)} – ${fmtMinutes(other.endMinutes)} shift on ${formatDateKey(other.date, { weekday: "short", month: "short", day: "numeric" })}`;
    }
  }
  return null;
}

// Scheduling rules (rest, consecutive days, days and hours per week) a manual
// shift would break, as an overridable conflict. Live shifts are checked
// against the live schedule; a draft against the week as it will be after
// publishing (live shifts plus drafts).
export async function findRuleConflict(
  supabase: QueryClient,
  orgId: string,
  table: "schedules" | "draft_schedules",
  employeeId: number,
  shift: { id?: number; date: string; startMinutes: number; endMinutes: number },
): Promise<{ conflict: "rules"; message: string; warnings: RuleWarning[] } | null> {
  // Two weeks either side covers the store week and any consecutive-day run
  // the rules care about (at most 7).
  const from = addDaysToKey(shift.date, -14);
  const to = addDaysToKey(shift.date, 14);
  // Drafts: "*" for replaces_schedule_id / removes (migration 0071).
  const load = (t: "schedules" | "draft_schedules") =>
    supabase
      .from(t)
      .select(t === "draft_schedules" ? "*" : "id, date, start_minutes, end_minutes")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .gte("date", from)
      .lte("date", to);

  const [settingsRes, empRes, liveRes, draftRes] = await Promise.all([
    supabase.from("app_settings").select("key, value").eq("org_id", orgId),
    supabase
      .from("employees")
      .select("employment_type, min_weekly_hours, max_weekly_hours, max_days_per_week")
      .eq("org_id", orgId)
      .eq("id", employeeId)
      .maybeSingle(),
    load("schedules"),
    table === "draft_schedules" ? load("draft_schedules") : Promise.resolve({ data: [] }),
  ]);

  const list = <T,>(res: { data?: unknown } | null | undefined): T[] =>
    Array.isArray(res?.data) ? (res.data as T[]) : [];
  const settings = Object.fromEntries(
    (list<{ key: string; value: string }>(settingsRes) as { key: string; value: string }[]).map((r) => [r.key, r.value])
  );
  const rules = parseSchedulingRules(settings);
  const firstDay = Number.parseInt(settings.first_day_of_week ?? "6", 10);
  const empRow = empRes?.data && !Array.isArray(empRes.data) ? empRes.data : {};
  const limits = limitsFromColumns(empRow, rules);

  type Row = { id: number; date: string; start_minutes: number; end_minutes: number; replaces_schedule_id?: number | null; removes?: boolean };
  const toShift = (source: string) => (r: Row) => ({
    id: r.id,
    source,
    date: String(r.date).slice(0, 10),
    startMinutes: r.start_minutes,
    endMinutes: r.end_minutes,
  });
  const draftRows = list<Row>(draftRes);
  // A live shift a draft changes or removes counts as the draft says.
  const superseded = new Set(draftRows.map((r) => r.replaces_schedule_id).filter((id): id is number => id != null));
  const live = list<Row>(liveRes).filter((r) => !superseded.has(r.id)).map(toShift("schedules"));
  const drafts = draftRows.filter((r) => !r.removes).map(toShift("draft_schedules"));
  // The shift being edited is ignored by id, and only within its own table.
  const others = [...live, ...drafts].filter((s) => !(shift.id !== undefined && s.source === table && s.id === shift.id));

  const warnings = checkShiftRules({
    shift: { date: shift.date, startMinutes: shift.startMinutes, endMinutes: shift.endMinutes },
    others: others.map(({ date, startMinutes, endMinutes }) => ({ date, startMinutes, endMinutes })),
    rules,
    limits,
    firstDayOfWeek: Number.isInteger(firstDay) && firstDay >= 0 && firstDay <= 6 ? firstDay : 6,
  });
  if (warnings.length === 0) return null;
  return { conflict: "rules", message: warnings.map((w) => w.message).join(" "), warnings };
}
