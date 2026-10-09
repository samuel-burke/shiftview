// Loads everything the auto-scheduler needs for one week of one org. Every
// query is org-scoped; the engine itself (lib/scheduler) never touches the
// database.

import { curveForDate, type CoverageBlock, type CoverageProfile } from "@/lib/coverage";
import { addDaysToKey, resolveTimezone } from "@/lib/dates";
import { weekDates } from "@/lib/draft-metrics";
import { parseSchedulingRules, type EmploymentType, type SchedulingRules } from "@/lib/scheduling-rules";
import { SHIFT_TYPES } from "@/lib/preferences";
import type { ShiftType } from "@/data/types";
import type { ExistingShift, SchedulerEmployee } from "@/lib/scheduler";
import { payRatesQuery, toPayRateMap } from "@/lib/pay-rates";

type QueryClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

// The database predates migration 0034: Postgres "undefined column" /
// "undefined table" / "undefined function", or PostgREST's schema-cache
// misses for a function (PGRST202), a column it's asked to write (PGRST204)
// and, from PostgREST 13, a table (PGRST205).
export const MIGRATION_ERROR_CODES = new Set(["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"]);

export type WeekDraft = ExistingShift & { id: number; generationRunId: number | null };

export type LoadedWeek = {
  dates: string[];
  timezone: string;
  rules: SchedulingRules;
  curves: Record<string, CoverageBlock[]>;
  storeHours: Record<number, { open: number; close: number }>;
  employees: SchedulerEmployee[];
  // Published shifts and drafts from a week before through a week after.
  published: ExistingShift[];
  drafts: WeekDraft[];
};

type Row = Record<string, unknown>;

const dateKey = (d: unknown) => String(d).slice(0, 10);
const num = (v: unknown) => (v == null ? null : Number(v));

function toShift(r: Row): ExistingShift {
  return {
    employeeId: Number(r.employee_id),
    date: dateKey(r.date),
    startMinutes: Number(r.start_minutes),
    endMinutes: Number(r.end_minutes),
  };
}

export async function loadWeek(
  supabase: QueryClient,
  orgId: string,
  weekStart: string
): Promise<{ week: LoadedWeek; error: null } | { week: null; error: "migration_required" | "internal" }> {
  const dates = weekDates(weekStart);
  const from = addDaysToKey(dates[0], -7);
  const to = addDaysToKey(dates[6], 7);

  const results = await Promise.all([
    supabase.from("employees")
      .select("id, name, employment_type, min_weekly_hours, max_weekly_hours, max_days_per_week")
      .eq("org_id", orgId),
    supabase.from("availability").select("employee_id, day_of_week, start_minutes, end_minutes").eq("org_id", orgId),
    supabase.from("time_off_requests").select("employee_id, date, status")
      .eq("org_id", orgId).gte("date", dates[0]).lte("date", dates[6]).in("status", ["approved", "pending"]),
    supabase.from("callouts").select("employee_id, date").eq("org_id", orgId).gte("date", dates[0]).lte("date", dates[6]),
    supabase.from("employee_preferences")
      .select("employee_id, preferred_shift_types, preferred_days, avoid_days, desired_weekly_hours")
      .eq("org_id", orgId),
    supabase.from("coverage_profiles").select("id, name").eq("org_id", orgId),
    supabase.from("coverage_profile_blocks").select("profile_id, start_minutes, end_minutes, headcount").eq("org_id", orgId),
    supabase.from("coverage_day_defaults").select("day_of_week, profile_id").eq("org_id", orgId),
    supabase.from("coverage_date_overrides").select("date, profile_id").eq("org_id", orgId).gte("date", dates[0]).lte("date", dates[6]),
    supabase.from("store_hours").select("day_of_week, open_minutes, close_minutes").eq("org_id", orgId),
    supabase.from("app_settings").select("key, value").eq("org_id", orgId),
    supabase.from("schedules").select("employee_id, date, start_minutes, end_minutes").eq("org_id", orgId).gte("date", from).lte("date", to),
    supabase.from("draft_schedules").select("id, employee_id, date, start_minutes, end_minutes, generation_run_id")
      .eq("org_id", orgId).gte("date", from).lte("date", to),
    payRatesQuery(supabase, orgId),
  ]);
  const failed = results.find((r) => r.error);
  if (failed) {
    if (MIGRATION_ERROR_CODES.has(failed.error.code)) return { week: null, error: "migration_required" };
    console.error("[auto-schedule] load failed", failed.error);
    return { week: null, error: "internal" };
  }
  const [
    employees, availability, timeOff, callouts, preferences,
    profiles, blocks, dayDefaults, overrides, storeHours, settings, schedules, drafts,
  ] = results.map((r) => (r.data ?? []) as Row[]);
  const payRates = toPayRateMap(results[results.length - 1].data);

  const settingsMap = Object.fromEntries(settings.map((r) => [String(r.key), String(r.value)]));

  // Coverage curve per date: date override, else the weekday's default profile.
  const blocksByProfile = new Map<number, CoverageBlock[]>();
  for (const b of blocks) {
    const id = Number(b.profile_id);
    if (!blocksByProfile.has(id)) blocksByProfile.set(id, []);
    blocksByProfile.get(id)!.push({
      startMinutes: Number(b.start_minutes),
      endMinutes: Number(b.end_minutes),
      headcount: Number(b.headcount),
    });
  }
  const profileList: CoverageProfile[] = profiles.map((p) => ({
    id: Number(p.id),
    name: String(p.name),
    blocks: (blocksByProfile.get(Number(p.id)) ?? []).sort((a, b) => a.startMinutes - b.startMinutes),
  }));
  const defaults = Object.fromEntries(dayDefaults.map((d) => [Number(d.day_of_week), Number(d.profile_id)]));
  const overrideMap = Object.fromEntries(overrides.map((o) => [dateKey(o.date), Number(o.profile_id)]));
  const curves = Object.fromEntries(dates.map((d) => [d, curveForDate(d, overrideMap, defaults, profileList)]));

  const prefsById = new Map(preferences.map((p) => [Number(p.employee_id), p]));
  const roster: SchedulerEmployee[] = employees.map((e) => {
    const id = Number(e.id);
    const prefs = prefsById.get(id);
    return {
      id,
      name: String(e.name),
      employmentType: (e.employment_type ?? null) as EmploymentType | null,
      minWeeklyHours: num(e.min_weekly_hours),
      maxWeeklyHours: num(e.max_weekly_hours),
      maxDaysPerWeek: num(e.max_days_per_week),
      payRate: payRates.get(id) ?? null,
      availability: Object.fromEntries(
        availability
          .filter((a) => Number(a.employee_id) === id)
          .map((a) => [Number(a.day_of_week), { startMinutes: num(a.start_minutes), endMinutes: num(a.end_minutes) }])
      ),
      unavailableDates: [
        ...timeOff.filter((t) => Number(t.employee_id) === id && t.status === "approved").map((t) => dateKey(t.date)),
        ...callouts.filter((c) => Number(c.employee_id) === id).map((c) => dateKey(c.date)),
      ],
      pendingTimeOffDates: timeOff
        .filter((t) => Number(t.employee_id) === id && t.status === "pending")
        .map((t) => dateKey(t.date)),
      preferences: {
        shiftTypes: ((prefs?.preferred_shift_types as string[] | null) ?? []).filter((t): t is ShiftType =>
          SHIFT_TYPES.includes(t as ShiftType)
        ),
        preferredDays: ((prefs?.preferred_days as number[] | null) ?? []).map(Number),
        avoidDays: ((prefs?.avoid_days as number[] | null) ?? []).map(Number),
        desiredWeeklyHours: num(prefs?.desired_weekly_hours),
      },
    };
  });

  return {
    week: {
      dates,
      timezone: resolveTimezone(settingsMap.timezone),
      rules: parseSchedulingRules(settingsMap),
      curves,
      storeHours: Object.fromEntries(
        storeHours.map((h) => [Number(h.day_of_week), { open: Number(h.open_minutes), close: Number(h.close_minutes) }])
      ),
      employees: roster,
      published: schedules.map(toShift),
      drafts: drafts.map((d) => ({
        ...toShift(d),
        id: Number(d.id),
        generationRunId: d.generation_run_id == null ? null : Number(d.generation_run_id),
      })),
    },
    error: null,
  };
}
