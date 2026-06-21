// Pure helpers for shift positions/roles (e.g. Cashier, Cook, Floor). A position
// is an org-defined label that can be attached to a scheduled shift, so coverage
// can be reasoned about by role, not just headcount.

export const POSITION_NAME_MAX = 40;

export type ValidName = { valid: true; value: string } | { valid: false; error: string };

export function validatePositionName(name: unknown): ValidName {
  if (typeof name !== "string" || !name.trim()) {
    return { valid: false, error: "Name is required" };
  }
  const value = name.trim();
  if (value.length > POSITION_NAME_MAX) {
    return { valid: false, error: `Name must be ${POSITION_NAME_MAX} characters or fewer` };
  }
  return { valid: true, value };
}

// Tally shifts by their assigned position id, plus a count of shifts with no
// position. Useful for a "coverage by role" breakdown of a day or week.
export function countByPosition(
  shifts: { positionId?: number | null }[]
): { counts: Record<number, number>; unassigned: number } {
  const counts: Record<number, number> = {};
  let unassigned = 0;
  for (const s of shifts) {
    if (s.positionId == null) {
      unassigned++;
    } else {
      counts[s.positionId] = (counts[s.positionId] ?? 0) + 1;
    }
  }
  return { counts, unassigned };
}
