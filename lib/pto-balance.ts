// Pure PTO-balance math. Time off is modelled as one approved request per
// calendar day (see data/types.ts), so "days used" is simply the count of
// distinct approved dates in a year. An employee may have an annual allowance
// (in days); a null allowance means PTO isn't tracked for them, in which case
// usage is still reported but there's no remaining figure.

// Count distinct approved time-off dates that fall within `year`. Date strings
// are compared on their YYYY prefix so a timestamptz value works too.
export function approvedDaysUsed(approvedDates: string[], year: number): number {
  const prefix = String(year);
  const inYear = new Set(
    approvedDates.filter((d) => d.slice(0, 4) === prefix).map((d) => d.slice(0, 10))
  );
  return inYear.size;
}

export type PtoBalance = {
  tracked: boolean;
  allowanceDays: number | null;
  usedDays: number;
  remainingDays: number | null;
};

export function computePtoBalance(
  allowanceDays: number | null,
  approvedDates: string[],
  year: number
): PtoBalance {
  const usedDays = approvedDaysUsed(approvedDates, year);
  if (allowanceDays == null) {
    return { tracked: false, allowanceDays: null, usedDays, remainingDays: null };
  }
  return {
    tracked: true,
    allowanceDays,
    usedDays,
    // Can go negative — surfacing an over-used balance is more useful than
    // clamping it to zero.
    remainingDays: allowanceDays - usedDays,
  };
}
