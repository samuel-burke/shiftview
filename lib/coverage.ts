import { ShiftSpan, dayOfWeek, headcountAt } from "./draft-metrics";

/**
 * Target coverage curves: a profile is a set of non-overlapping time blocks,
 * each demanding a target headcount. Resolution is 15 minutes.
 */
export type CoverageBlock = {
  startMinutes: number;
  endMinutes: number;
  headcount: number;
};

export type CoverageProfile = {
  id: number;
  name: string;
  blocks: CoverageBlock[];
};

/** dayOfWeek -> profileId (default assignment) */
export type CoverageDefaults = Record<number, number | null>;
/** YYYY-MM-DD -> profileId (date override) */
export type CoverageOverrides = Record<string, number>;

export type UnderstaffedRange = {
  date: string;
  startMinutes: number;
  endMinutes: number;
  shortfall: number; // worst gap between target and scheduled in the range
};

export const SLOT_MINUTES = 15;
export const MAX_BLOCKS = 96;
export const MAX_HEADCOUNT = 99;

/** Validates a set of curve blocks. Returns an error string or null. */
export function validateBlocks(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return "blocks must be an array";
  if (blocks.length > MAX_BLOCKS) return `blocks must have at most ${MAX_BLOCKS} entries`;
  for (const b of blocks) {
    if (typeof b !== "object" || b === null) return "each block must be an object";
    const { startMinutes, endMinutes, headcount } = b as Record<string, unknown>;
    if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes) || !Number.isInteger(headcount))
      return "startMinutes, endMinutes, headcount must be integers";
    const s = startMinutes as number, e = endMinutes as number, h = headcount as number;
    if (s < 0 || s >= 1440) return "startMinutes out of range";
    if (e <= 0 || e > 1440) return "endMinutes out of range";
    if (s % SLOT_MINUTES !== 0 || e % SLOT_MINUTES !== 0) return `times must align to ${SLOT_MINUTES}-minute intervals`;
    if (s >= e) return "block start must be before end";
    if (h < 0 || h > MAX_HEADCOUNT) return `headcount must be 0–${MAX_HEADCOUNT}`;
  }
  const sorted = [...(blocks as CoverageBlock[])].sort((a, b) => a.startMinutes - b.startMinutes);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMinutes < sorted[i - 1].endMinutes) return "blocks must not overlap";
  }
  return null;
}

/** Target headcount at a given minute of the day. 0 when no block covers it. */
export function targetAt(blocks: CoverageBlock[], minute: number): number {
  for (const b of blocks) {
    if (minute >= b.startMinutes && minute < b.endMinutes) return b.headcount;
  }
  return 0;
}

/** Area under the curve, in staff-hours — this is the derived daily budget. */
export function curveHours(blocks: CoverageBlock[]): number {
  return blocks.reduce((sum, b) => sum + ((b.endMinutes - b.startMinutes) * b.headcount) / 60, 0);
}

/** Which profile applies to a date: explicit override first, then day-of-week default. */
export function resolveProfileId(
  date: string,
  overrides: CoverageOverrides,
  defaults: CoverageDefaults
): number | null {
  return overrides[date] ?? defaults[dayOfWeek(date)] ?? null;
}

export function curveForDate(
  date: string,
  overrides: CoverageOverrides,
  defaults: CoverageDefaults,
  profiles: CoverageProfile[]
): CoverageBlock[] {
  const profileId = resolveProfileId(date, overrides, defaults);
  if (profileId === null) return [];
  return profiles.find((p) => p.id === profileId)?.blocks ?? [];
}

/**
 * Percentage (0–100) of 15-minute slots with a target where scheduled headcount
 * meets the target. Null when no slot has a target.
 */
export function coverageScoreFromCurves(
  shifts: ShiftSpan[],
  dates: string[],
  curves: Record<string, CoverageBlock[]>
): number | null {
  let total = 0;
  let covered = 0;
  for (const date of dates) {
    for (const b of curves[date] ?? []) {
      if (b.headcount <= 0) continue;
      for (let t = b.startMinutes; t < b.endMinutes; t += SLOT_MINUTES) {
        total++;
        if (headcountAt(shifts, date, t) >= b.headcount) covered++;
      }
    }
  }
  if (total === 0) return null;
  return Math.round((covered / total) * 100);
}

/** Contiguous ranges where scheduled headcount falls below the target curve. */
export function findUnderstaffedFromCurves(
  shifts: ShiftSpan[],
  dates: string[],
  curves: Record<string, CoverageBlock[]>
): UnderstaffedRange[] {
  const alerts: UnderstaffedRange[] = [];
  for (const date of dates) {
    const blocks = curves[date] ?? [];
    if (blocks.length === 0) continue;
    const dayStart = Math.min(...blocks.map((b) => b.startMinutes));
    const dayEnd = Math.max(...blocks.map((b) => b.endMinutes));
    let rangeStart: number | null = null;
    let worst = 0;
    for (let t = dayStart; t <= dayEnd; t += SLOT_MINUTES) {
      const target = t < dayEnd ? targetAt(blocks, t) : 0;
      const gap = t < dayEnd ? target - headcountAt(shifts, date, t) : 0;
      if (target > 0 && gap > 0) {
        if (rangeStart === null) { rangeStart = t; worst = gap; }
        else worst = Math.max(worst, gap);
      } else if (rangeStart !== null) {
        alerts.push({ date, startMinutes: rangeStart, endMinutes: t, shortfall: worst });
        rangeStart = null;
      }
    }
  }
  return alerts;
}

export type LiveCoverageStatus = "optimal" | "low" | "critical";

/**
 * Live status against the curve: meets target = optimal, at least half = low,
 * below half = critical. No target right now = optimal (nothing required).
 */
export function liveCoverageStatus(hereCount: number, target: number): LiveCoverageStatus {
  if (target <= 0) return "optimal";
  if (hereCount >= target) return "optimal";
  if (hereCount >= Math.ceil(target / 2)) return "low";
  return "critical";
}

/**
 * Day status for calendar dots etc.: the worst slot of the day vs the curve.
 * Null when the date has no curve (unknown).
 */
export function dayCoverageStatusFromCurve(
  shifts: ShiftSpan[],
  date: string,
  blocks: CoverageBlock[]
): LiveCoverageStatus | null {
  if (blocks.length === 0) return null;
  let worst: LiveCoverageStatus = "optimal";
  for (const b of blocks) {
    if (b.headcount <= 0) continue;
    for (let t = b.startMinutes; t < b.endMinutes; t += SLOT_MINUTES) {
      const status = liveCoverageStatus(headcountAt(shifts, date, t), b.headcount);
      if (status === "critical") return "critical";
      if (status === "low") worst = "low";
    }
  }
  return worst;
}
