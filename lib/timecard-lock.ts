// Pay-period lock helpers for timecard approval.
//
// A `timecard_approvals` row freezes an inclusive [periodStart, periodEnd] date
// range for one employee: once approved, punches whose LOCAL date (in the org
// timezone) falls inside the range can no longer be added or edited. These pure
// helpers answer the two questions the write paths need — "what local date is
// this punch on?" and "is that date inside an approved period?" — and detect
// overlaps when a new approval is created.
//
// Dates are compared as YYYY-MM-DD strings; lexical order matches calendar
// order for that format, so no Date parsing (or timezone math) is needed here.

export type ApprovalPeriod = {
  periodStart: string; // YYYY-MM-DD, inclusive
  periodEnd: string;   // YYYY-MM-DD, inclusive
};

// The local calendar date (YYYY-MM-DD) a punch instant falls on in `tz`. A punch
// at 9:53 PM EDT is stored as the next UTC day but belongs to its local date —
// this is the date the lock is checked against, matching how the time card
// buckets punches.
export function localDateInTz(instant: string | Date, tz: string): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

// The approval covering `localDate`, or null. Bounds are inclusive on both ends.
export function lockForDate<T extends ApprovalPeriod>(
  localDate: string,
  periods: T[]
): T | null {
  for (const p of periods) {
    if (p.periodStart <= localDate && localDate <= p.periodEnd) return p;
  }
  return null;
}

// Whether two inclusive date ranges share at least one day. Touching ranges
// (one ending the same day another starts) count as overlapping.
export function periodsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
