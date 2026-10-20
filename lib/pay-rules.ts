// Per-organization pay rules: how worked time becomes regular, overtime and
// double-time hours.
//
// Stored in app_settings as individual text rows, like the punch policy
// (lib/punch-policy.ts). Unset keys fall back to DEFAULT_PAY_RULES, which is
// what payroll did before these settings existed: the federal 40 h/week rule,
// a Monday workweek, exact punch times. The database checks the values too
// (migration 0060), since managers can write app_settings directly.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocalMinutes, resolveTimezone } from "@/lib/dates";
import { fetchAllRows } from "@/lib/fetch-all-rows";

export type OvertimeRule = "federal" | "california" | "alaska" | "nevada" | "colorado";

export const OVERTIME_RULES: OvertimeRule[] = ["federal", "california", "alaska", "nevada", "colorado"];

// 0 = exact punch times; otherwise punches round to the nearest N minutes.
export type RoundingMinutes = 0 | 5 | 6 | 15;

export const ROUNDING_OPTIONS: RoundingMinutes[] = [0, 5, 6, 15];

export type PayRules = {
  overtimeRule: OvertimeRule;
  // Nevada's daily overtime (over 8 h in a workday) only applies to employees
  // paid less than 1.5x the state minimum wage. The app doesn't know who that
  // is, so "nevada" is the weekly rule unless the store turns this on (when
  // every hourly employee earns under that line).
  nevadaDailyOvertime: boolean;
  // The day (0 = Sunday … 6 = Saturday) the payroll workweek starts on. It
  // must stay fixed: the FLSA lets a workweek start any day, but not move to
  // avoid overtime.
  workweekStartDay: number;
  roundingMinutes: RoundingMinutes;
};

export const DEFAULT_PAY_RULES: PayRules = {
  overtimeRule: "federal",
  nevadaDailyOvertime: false,
  workweekStartDay: 1,
  roundingMinutes: 0,
};

export const PAY_RULE_KEYS = {
  overtimeRule: "overtime_rule",
  nevadaDailyOvertime: "overtime_nevada_daily",
  workweekStartDay: "payroll_week_start",
  roundingMinutes: "punch_rounding_minutes",
} as const satisfies Record<keyof PayRules, string>;

// The thresholds a rule applies, in hours. null = that rule doesn't apply.
export type OvertimeThresholds = {
  // Hours in a workday past this are overtime.
  dailyOvertime: number | null;
  // Hours in a workday past this are double time.
  dailyDoubleTime: number | null;
  // Regular hours in a workweek past this are overtime.
  weeklyOvertime: number;
  // California: the 7th consecutive workday of a workweek is all premium
  // time, overtime up to 8 h and double time beyond.
  seventhDay: boolean;
};

export function overtimeThresholds(rules: Pick<PayRules, "overtimeRule" | "nevadaDailyOvertime">): OvertimeThresholds {
  switch (rules.overtimeRule) {
    case "california":
      return { dailyOvertime: 8, dailyDoubleTime: 12, weeklyOvertime: 40, seventhDay: true };
    case "alaska":
      return { dailyOvertime: 8, dailyDoubleTime: null, weeklyOvertime: 40, seventhDay: false };
    case "nevada":
      return { dailyOvertime: rules.nevadaDailyOvertime ? 8 : null, dailyDoubleTime: null, weeklyOvertime: 40, seventhDay: false };
    case "colorado":
      return { dailyOvertime: 12, dailyDoubleTime: null, weeklyOvertime: 40, seventhDay: false };
    default:
      return { dailyOvertime: null, dailyDoubleTime: null, weeklyOvertime: 40, seventhDay: false };
  }
}

// Whether a rule measures anything per workday, so hours must be split at the
// store's midnight to count toward the right day.
export function hasDailyRules(t: OvertimeThresholds): boolean {
  return t.dailyOvertime !== null || t.dailyDoubleTime !== null || t.seventhDay;
}

function isOvertimeRule(v: unknown): v is OvertimeRule {
  return typeof v === "string" && (OVERTIME_RULES as string[]).includes(v);
}

function isRounding(v: unknown): v is RoundingMinutes {
  return typeof v === "number" && (ROUNDING_OPTIONS as number[]).includes(v);
}

// Builds PayRules from a raw app_settings key→value map. A malformed value
// (only possible in rows written before migration 0060) reads as the default.
export function parsePayRules(map: Record<string, string | undefined>): PayRules {
  const rule = map[PAY_RULE_KEYS.overtimeRule];
  const week = Number(map[PAY_RULE_KEYS.workweekStartDay]);
  const rounding = Number(map[PAY_RULE_KEYS.roundingMinutes]);
  return {
    overtimeRule: isOvertimeRule(rule) ? rule : DEFAULT_PAY_RULES.overtimeRule,
    nevadaDailyOvertime: map[PAY_RULE_KEYS.nevadaDailyOvertime] === "true",
    workweekStartDay:
      map[PAY_RULE_KEYS.workweekStartDay] !== undefined && map[PAY_RULE_KEYS.workweekStartDay] !== "" &&
      Number.isInteger(week) && week >= 0 && week <= 6
        ? week
        : DEFAULT_PAY_RULES.workweekStartDay,
    roundingMinutes: isRounding(rounding) ? rounding : DEFAULT_PAY_RULES.roundingMinutes,
  };
}

// Validates a partial PayRules patch and converts it to app_settings rows.
export function payRulesRows(
  input: Record<string, unknown>,
): { rows: { key: string; value: string }[]; error: string | null } {
  const rows: { key: string; value: string }[] = [];
  if (input.overtimeRule !== undefined) {
    if (!isOvertimeRule(input.overtimeRule))
      return { rows: [], error: `overtimeRule must be one of ${OVERTIME_RULES.join(", ")}` };
    rows.push({ key: PAY_RULE_KEYS.overtimeRule, value: input.overtimeRule });
  }
  if (input.nevadaDailyOvertime !== undefined) {
    if (typeof input.nevadaDailyOvertime !== "boolean")
      return { rows: [], error: "nevadaDailyOvertime must be a boolean" };
    rows.push({ key: PAY_RULE_KEYS.nevadaDailyOvertime, value: String(input.nevadaDailyOvertime) });
  }
  if (input.workweekStartDay !== undefined) {
    const v = input.workweekStartDay;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 6)
      return { rows: [], error: "workweekStartDay must be an integer 0–6" };
    rows.push({ key: PAY_RULE_KEYS.workweekStartDay, value: String(v) });
  }
  if (input.roundingMinutes !== undefined) {
    if (!isRounding(input.roundingMinutes))
      return { rows: [], error: `roundingMinutes must be one of ${ROUNDING_OPTIONS.join(", ")}` };
    rows.push({ key: PAY_RULE_KEYS.roundingMinutes, value: String(input.roundingMinutes) });
  }
  return { rows, error: null };
}

const MINUTE_MS = 60_000;

// A punch time rounded to the nearest `minutes` on the store's clock (so a
// store at UTC+5:45 still rounds to :00/:06/:12…), half-way rounding up. With
// 15 this is the "7-minute rule": up to 7 min 29 s past a quarter hour rounds
// back, from 7 min 30 s it rounds forward. Clock-ins and clock-outs round the
// same way, so over time it favours neither side. 0 returns the time as is.
export function roundPunchMs(ms: number, minutes: RoundingMinutes, tz: string): number {
  if (!minutes) return ms;
  const block = minutes * MINUTE_MS;
  // Offsets are whole minutes, so the seconds past the local minute equal the
  // seconds past the UTC minute.
  const intoMinute = ((ms % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
  const pos = (getLocalMinutes(ms, tz) % minutes) * MINUTE_MS + intoMinute;
  return pos * 2 >= block ? ms - pos + block : ms - pos;
}

// Rounds the clock-ins and clock-outs of chronologically sorted punches.
// Break punches stay exact. A rounded punch never passes the punch before or
// after it, so rounding can't reorder a shift (a clock-in at 9:08 with a break
// at 9:10 rounds to 9:10, not 9:15).
export function roundPunchTimes<P extends { punchType: string; ms: number }>(
  punches: P[],
  minutes: RoundingMinutes,
  tz: string,
): number[] {
  return punches.map((p, i) => {
    if (!minutes || (p.punchType !== "clock_in" && p.punchType !== "clock_out")) return p.ms;
    let r = roundPunchMs(p.ms, minutes, tz);
    const prev = punches[i - 1];
    const next = punches[i + 1];
    if (next && r > next.ms) r = next.ms;
    if (prev && r < prev.ms) r = prev.ms;
    return r;
  });
}

// The org's store timezone and pay rules, from app_settings in one read.
export async function getOrgPayrollSettings(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ tz: string; rules: PayRules }> {
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId)
    .in("key", ["timezone", ...Object.values(PAY_RULE_KEYS)]);
  const rows = Array.isArray(data) ? (data as { key: string; value: string }[]) : [];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { tz: resolveTimezone(map.timezone), rules: parsePayRules(map) };
}

// Postgres "undefined column": the database predates migration 0060.
const UNDEFINED_COLUMN = "42703";

// Ids of the org's exempt (salaried) employees, who get no overtime. Empty
// before migration 0060 adds the column, so payroll keeps working if the app
// deploys first. With `employeeId`, only that employee is looked up.
export async function loadExemptEmployeeIds(
  supabase: SupabaseClient,
  orgId: string,
  employeeId?: number,
): Promise<{ ids: Set<number>; error: unknown }> {
  const { data, error } = await fetchAllRows((first, last) => {
    let q = supabase.from("employees").select("id").eq("org_id", orgId).eq("exempt", true);
    if (employeeId !== undefined) q = q.eq("id", employeeId);
    return q.order("id").range(first, last);
  });
  if ((error as { code?: string } | null)?.code === UNDEFINED_COLUMN) return { ids: new Set(), error: null };
  if (error) return { ids: new Set(), error };
  return { ids: new Set((data ?? []).map((r) => Number((r as { id: number }).id))), error: null };
}
