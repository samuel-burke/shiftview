// Pure youth-labor compliance helpers. Minors are subject to limits adults
// aren't — most commonly a latest end-of-shift time and a daily hours cap.
// Exact rules vary by jurisdiction (and school vs non-school days); the defaults
// here are a conservative baseline and everything is overridable. Surfacing
// violations lets a manager catch them before the schedule is published.
//
// Times are minutes since midnight; dates are YYYY-MM-DD.

import { fmtMinutes } from "../data/types";

export const ADULT_AGE = 18;

// Full years from `dob` to `onDate`.
export function ageOn(dob: string, onDate: string): number {
  const [by, bm, bd] = dob.slice(0, 10).split("-").map(Number);
  const [yy, ym, yd] = onDate.slice(0, 10).split("-").map(Number);
  let age = yy - by;
  if (ym < bm || (ym === bm && yd < bd)) age--;
  return age;
}

export function isMinor(dob: string, onDate: string, adultAge: number = ADULT_AGE): boolean {
  return ageOn(dob, onDate) < adultAge;
}

export type MinorRules = {
  // Latest minute a minor's shift may end (e.g. 1320 = 10:00 PM).
  latestEndMinute: number;
  // Maximum minutes a minor may work in a day (e.g. 480 = 8h).
  maxDailyMinutes: number;
};

export const DEFAULT_MINOR_RULES: MinorRules = {
  latestEndMinute: 1320, // 10:00 PM
  maxDailyMinutes: 480, // 8h
};

// Human-readable violations for a single shift against the minor rules. Empty
// array means compliant.
export function minorShiftViolations(
  shift: { startMinutes: number; endMinutes: number },
  rules: MinorRules = DEFAULT_MINOR_RULES
): string[] {
  const violations: string[] = [];
  if (shift.endMinutes > rules.latestEndMinute) {
    violations.push(`Ends after ${fmtMinutes(rules.latestEndMinute)}`);
  }
  if (shift.endMinutes - shift.startMinutes > rules.maxDailyMinutes) {
    violations.push(`Exceeds ${Math.round(rules.maxDailyMinutes / 60)}h/day`);
  }
  return violations;
}
