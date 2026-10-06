// Turns the final schedule into the result the Planner shows: metrics (with the
// app's shared coverage, hours and cost helpers, so numbers match the Planner),
// per-employee totals, the gaps left and why nobody covered them, and one-tap
// suggestions.

import {
  coverageScoreFromCurves,
  curveHours,
  findUnderstaffedFromCurves,
  SLOT_MINUTES,
  type CoverageBlock,
} from "@/lib/coverage";
import { isUnavailableAllDay } from "@/lib/availability-rules";
import { summarizeWeeklyCost } from "@/lib/labor-cost";
import type { ShiftSpan } from "@/lib/draft-metrics";
import { DAY, FIRST_DAY, OVERTIME_THRESHOLD, SLOTS_PER_DAY, WEEK_SLOTS, type Model } from "./model";
import type { ScheduleState } from "./state";
import type {
  EmployeeResult,
  GapReason,
  GapReasonCode,
  ProposedShift,
  ScheduleGap,
  ScheduleResult,
  SchedulerInput,
  SchedulerWarning,
  Suggestion,
} from "./types";

const round1 = (n: number) => Math.round(n * 10) / 10;
const MAX_SUGGESTIONS = 3;

// The target, adjustments included, as coverage blocks per date.
export function targetCurves(model: Model): Record<string, CoverageBlock[]> {
  const out: Record<string, CoverageBlock[]> = {};
  model.dates.forEach((date, day) => {
    const blocks: CoverageBlock[] = [];
    for (let s = 0; s < SLOTS_PER_DAY; s++) {
      const headcount = model.target[day * SLOTS_PER_DAY + s];
      if (headcount <= 0) continue;
      const last = blocks[blocks.length - 1];
      if (last && last.endMinutes === s * SLOT_MINUTES && last.headcount === headcount) last.endMinutes += SLOT_MINUTES;
      else blocks.push({ startMinutes: s * SLOT_MINUTES, endMinutes: (s + 1) * SLOT_MINUTES, headcount });
    }
    out[date] = blocks;
  });
  return out;
}

// Why employee i isn't covering `minute` (minutes into `day`) of a gap
// `gapMinutes` long, or null if they are working then.
function blockingReason(state: ScheduleState, i: number, day: number, minute: number, gapMinutes: number): GapReasonCode | null {
  const m = state.model;
  const e = m.employees[i];
  const abs = day * DAY + minute;
  if (state.shifts[i].some((s) => s.abs <= abs && abs < s.absEnd)) return null;
  if (e.unavailable[day]) return "time_off";
  const rule = e.availability[m.dows[day]];
  if (rule && (isUnavailableAllDay(rule) || minute < rule.startMinutes! || minute >= rule.endMinutes!)) return "unavailable";

  // Working another part of the day: what stops their shift stretching over the gap?
  const sameDay = state.shifts[i].find((s) => s.day === day);
  if (sameDay) {
    if (sameDay.fixed) return "has_shift_that_day";
    const slotStart = Math.floor(minute / m.grid) * m.grid;
    const start = Math.min(sameDay.start, slotStart);
    const end = Math.max(sameDay.end, slotStart + m.grid);
    if (end - start > m.maxLength) return "has_shift_that_day";
    if (m.paid(day, start, end) - sameDay.paid > e.capMinutes - state.minutes[i]) return "max_hours";
    const w = e.windows[day];
    if (!w || start < w.lo || end > w.hi) return "no_fit";
    const rest = m.rules.minRestMinutes;
    for (const o of state.shifts[i]) {
      if (o === sameDay) continue;
      if (o.abs < day * DAY && day * DAY + start < o.absEnd + rest) return "rest";
      if (o.abs >= (day + 1) * DAY && day * DAY + end > o.abs - rest) return "rest";
    }
    if (e.avoidPending[day]) return "pending_time_off";
    return gapMinutes < m.minLength ? "short_gap" : "tradeoff";
  }

  if (state.workDays[i] + 1 > e.maxDays) return "max_days";
  let run = 1;
  const dc = state.dayCount[i];
  for (let d = day - 1; d - FIRST_DAY >= 0 && dc[d - FIRST_DAY] > 0; d--) run++;
  for (let d = day + 1; d - FIRST_DAY < dc.length && dc[d - FIRST_DAY] > 0; d++) run++;
  if (run > m.rules.maxConsecutiveDays) return "consecutive_days";
  if (e.capMinutes - state.minutes[i] < m.minLength) return "max_hours";
  const w = e.windows[day];
  if (!w) return "no_fit";
  // Could an allowed shift within [lo, hi] cover the minute? (lo, hi and the
  // shift lengths are all on the start grid.)
  const fits = (lo: number, hi: number) => {
    const latestStart = day * DAY + Math.floor(minute / m.grid) * m.grid;
    const earliestEnd = latestStart + m.grid;
    const from = Math.max(lo, earliestEnd - m.maxLength);
    const to = Math.min(latestStart, hi - m.minLength);
    return earliestEnd <= hi && from <= to;
  };
  if (!fits(day * DAY + w.lo, day * DAY + w.hi)) return "no_fit";
  const open = state.opening(i, day);
  if (!open || !fits(open.lo, open.hi)) return "rest";
  if (e.avoidPending[day]) return "pending_time_off";
  return gapMinutes < m.minLength ? "short_gap" : "tradeoff";
}

export function diagnose(input: SchedulerInput, model: Model, state: ScheduleState, timedOut: boolean): ScheduleResult {
  const curves = targetCurves(model);
  const dates = model.dates;

  const generated = [...state.generated].sort((a, b) => a.abs - b.abs || a.end - b.end || a.emp - b.emp);
  const shifts: ProposedShift[] = generated.map((s) => ({
    employeeId: model.employees[s.emp].id,
    date: dates[s.day],
    startMinutes: s.start,
    endMinutes: s.end,
  }));
  const existingSpans: ShiftSpan[] = input.existing.map((s) => ({
    date: s.date.slice(0, 10),
    startMinutes: s.startMinutes,
    endMinutes: s.endMinutes,
  }));
  const allSpans = [...existingSpans, ...shifts];

  // Totals.
  let shortfallSlots = 0;
  let overstaffSlots = 0;
  for (let k = 0; k < WEEK_SLOTS; k++) {
    const diff = model.target[k] - state.cov[k];
    if (diff > 0) shortfallSlots += diff;
    else overstaffSlots -= diff;
  }
  const slotHours = SLOT_MINUTES / 60;
  const budgetHours = dates.reduce((sum, d) => sum + curveHours(curves[d]), 0);
  const existingInWeek = model.existing.filter((s) => s.day >= 0 && s.day < dates.length);
  const scheduledMinutes =
    existingInWeek.reduce((sum, s) => sum + s.paid, 0) + generated.reduce((sum, s) => sum + s.paid, 0);
  const cost = summarizeWeeklyCost(
    model.employees.map((e) => ({ employeeId: e.id, totalMinutes: state.minutes[e.index], payRate: e.payRate }))
  );

  // Per employee.
  const employees: EmployeeResult[] = model.employees.map((e) => {
    const mine = generated.filter((s) => s.emp === e.index);
    const statesPreference = e.preferredTypes !== null || e.avoidDays.size > 0;
    const honored = mine.filter(
      (s) => !e.avoidDays.has(model.dows[s.day]) && (e.preferredTypes === null || e.preferredTypes.has(s.type))
    ).length;
    const minutes = state.minutes[e.index];
    return {
      employeeId: e.id,
      employmentType: e.type,
      typeSet: e.typeSet,
      minutes,
      generatedMinutes: mine.reduce((sum, s) => sum + s.paid, 0),
      generatedShifts: mine.length,
      minMinutes: e.minMinutes,
      maxMinutes: e.regularMaxMinutes,
      overtimeMinutes: Math.max(0, minutes - OVERTIME_THRESHOLD),
      belowMinimum: minutes < e.minMinutes,
      preferencesHonored: statesPreference ? honored : 0,
      preferencesConsidered: statesPreference ? mine.length : 0,
      pendingTimeOffDates: mine.filter((s) => e.pending[s.day]).map((s) => dates[s.day]),
    };
  });
  const considered = employees.reduce((sum, e) => sum + e.preferencesConsidered, 0);
  const honored = employees.reduce((sum, e) => sum + e.preferencesHonored, 0);

  // Gaps, and why each wasn't covered.
  const blockedFor = new Map<number, number>(); // employee index → gap minutes they're capped out of
  const gaps: ScheduleGap[] = findUnderstaffedFromCurves(allSpans, dates, curves).map((g) => {
    const day = dates.indexOf(g.date);
    const byCode = new Map<GapReasonCode, number[]>();
    for (const e of model.employees) {
      const code = blockingReason(state, e.index, day, g.startMinutes, g.endMinutes - g.startMinutes);
      if (!code) continue;
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code)!.push(e.id);
      if (code === "max_hours") blockedFor.set(e.index, (blockedFor.get(e.index) ?? 0) + g.endMinutes - g.startMinutes);
    }
    const reasons: GapReason[] = [...byCode.entries()]
      .map(([code, employeeIds]) => ({ code, employeeIds }))
      .sort((a, b) => b.employeeIds.length - a.employeeIds.length);
    return { ...g, reasons };
  });

  // Raising the weekly limit of someone capped out of a gap.
  const suggestions: Suggestion[] = [...blockedFor.entries()]
    .map(([index, gapMinutes]): Suggestion | null => {
      const e = model.employees[index];
      const needed = Math.min(model.maxLength, Math.max(model.minLength, gapMinutes));
      const maxHours = Math.ceil(((state.minutes[index] + needed) / 60) * 2) / 2;
      if (maxHours > 80) return null;
      return { kind: "raise_hours", employeeId: e.id, maxHours, overtime: maxHours * 60 > OVERTIME_THRESHOLD, gapMinutes };
    })
    .filter((s): s is Suggestion => s !== null)
    .sort((a, b) => b.gapMinutes - a.gapMinutes || a.employeeId - b.employeeId)
    .slice(0, MAX_SUGGESTIONS);

  const warnings: SchedulerWarning[] = [];
  const closedDates = dates.filter((_, day) => model.windows[day] === null);
  if (closedDates.length) warnings.push({ code: "no_coverage_target", dates: closedDates });
  const untyped = model.employees.filter((e) => !e.typeSet).map((e) => e.id);
  if (untyped.length) warnings.push({ code: "employment_type_missing", employeeIds: untyped });
  const overBudget = scheduledMinutes / 60 - budgetHours;
  if (budgetHours > 0 && overBudget > 0.5) warnings.push({ code: "over_budget", hours: round1(overBudget) });
  const pendingScheduled = employees.filter((e) => e.pendingTimeOffDates.length).map((e) => e.employeeId);
  if (pendingScheduled.length) warnings.push({ code: "pending_time_off_scheduled", employeeIds: pendingScheduled });
  if (timedOut) warnings.push({ code: "time_limit" });

  return {
    shifts,
    metrics: {
      coverageScore: coverageScoreFromCurves(allSpans, dates, curves),
      coverageScoreBefore: coverageScoreFromCurves(existingSpans, dates, curves),
      budgetHours: round1(budgetHours),
      scheduledHours: round1(scheduledMinutes / 60),
      generatedHours: round1(generated.reduce((sum, s) => sum + s.paid, 0) / 60),
      generatedShifts: generated.length,
      shortfallHours: round1(shortfallSlots * slotHours),
      overstaffHours: round1(overstaffSlots * slotHours),
      overtimeHours: round1(employees.reduce((sum, e) => sum + e.overtimeMinutes, 0) / 60),
      laborCost: cost.totalCost,
      employeesMissingRate: cost.employeesMissingRate,
      preferenceScore: considered ? Math.round((honored / considered) * 100) : null,
    },
    gaps,
    suggestions,
    employees,
    warnings,
  };
}
