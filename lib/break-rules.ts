// Pure break-compliance rules. Many jurisdictions require a meal break once a
// shift passes a threshold (e.g. > 6h) and paid rest breaks per worked interval
// (e.g. one per 4h). ShiftView doesn't schedule the breaks themselves, but
// flagging which shifts *require* one lets managers plan break coverage and stay
// compliant. Times are minutes. Defaults are a common US baseline; everything is
// overridable.

export type BreakRules = {
  // A shift strictly longer than this requires a meal break.
  mealBreakThresholdMinutes: number;
  // Length of that meal break (informational, surfaced in the UI).
  mealBreakMinutes: number;
  // One paid rest break per this many minutes worked. 0 disables rest breaks.
  restBreakPerMinutes: number;
};

export const DEFAULT_BREAK_RULES: BreakRules = {
  mealBreakThresholdMinutes: 360, // 6h
  mealBreakMinutes: 30,
  restBreakPerMinutes: 240, // one per 4h
};

export type ShiftBreakRequirement = {
  mealBreakRequired: boolean;
  restBreaks: number;
};

export function requiredBreaks(
  shiftMinutes: number,
  rules: BreakRules = DEFAULT_BREAK_RULES
): ShiftBreakRequirement {
  return {
    mealBreakRequired: shiftMinutes > rules.mealBreakThresholdMinutes,
    restBreaks:
      rules.restBreakPerMinutes > 0 ? Math.floor(shiftMinutes / rules.restBreakPerMinutes) : 0,
  };
}

export type BreakSummary = {
  totalShifts: number;
  mealBreaksRequired: number;
  restBreaksRequired: number;
};

export function summarizeBreakRequirements(
  shifts: { startMinutes: number; endMinutes: number }[],
  rules: BreakRules = DEFAULT_BREAK_RULES
): BreakSummary {
  const summary: BreakSummary = { totalShifts: shifts.length, mealBreaksRequired: 0, restBreaksRequired: 0 };
  for (const s of shifts) {
    const req = requiredBreaks(s.endMinutes - s.startMinutes, rules);
    if (req.mealBreakRequired) summary.mealBreaksRequired++;
    summary.restBreaksRequired += req.restBreaks;
  }
  return summary;
}
