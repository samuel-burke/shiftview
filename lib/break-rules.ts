// Break types and the optional break rules (G8).
//
// A store's break types live in break_types (migration 0065): each is paid or
// unpaid, with an optional minimum length. A store with none configured has
// one implicit unpaid "Break" (DEFAULT_BREAK_TYPE), so every break is deducted
// exactly as before. Paid breaks are worked time (lib/payroll.ts).
//
// The rules are app_settings rows, off by default:
//   meal_required_after_minutes  0 = off; otherwise a shift worked longer than
//                                this needs a meal break (an unpaid break of at
//                                least its type's minimum, or MEAL_MIN_MINUTES)
//                                starting no later than this much work in. A
//                                flag on the time card and a count in the
//                                payroll export; nothing is paid automatically.
//   break_attestation_enabled    "true": the clock asks "I was able to take my
//                                breaks" at clock-out and stores the answer.

export type BreakType = {
  id: number;
  name: string;
  paid: boolean;
  minMinutes: number | null;
  sortOrder: number;
  archived: boolean;
};

/** The one type a store has before any are configured. Not a database row. */
export const DEFAULT_BREAK_TYPE = { id: null, name: "Break", paid: false, minMinutes: null } as const;

export const BREAK_TYPE_NAME_MAX = 40;
export const BREAK_TYPE_MIN_MINUTES_MAX = 240;

/** A meal break with no minimum set on its type must last at least this long. */
export const MEAL_MIN_MINUTES = 30;

export type BreakRules = {
  // 0 = off.
  mealRequiredAfterMinutes: number;
  attestationEnabled: boolean;
};

export const DEFAULT_BREAK_RULES: BreakRules = { mealRequiredAfterMinutes: 0, attestationEnabled: false };

const MEAL_KEY = "meal_required_after_minutes";
const ATTEST_KEY = "break_attestation_enabled";
// A meal rule from 1 hour to 16 hours (the longest shift) of work.
const MEAL_MIN = 60;
const MEAL_MAX = 960;

export function parseBreakRules(map: Record<string, string | undefined>): BreakRules {
  const raw = map[MEAL_KEY]?.trim() ?? "";
  const n = /^\d{1,4}$/.test(raw) ? Number(raw) : 0;
  return {
    mealRequiredAfterMinutes: n >= MEAL_MIN && n <= MEAL_MAX ? n : 0,
    attestationEnabled: map[ATTEST_KEY] === "true",
  };
}

/** Validates a PUT /api/settings `breakRules` patch into app_settings rows. */
export function breakRulesRows(patch: unknown): { rows: { key: string; value: string }[]; error: string | null } {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch))
    return { rows: [], error: "breakRules must be an object" };
  const p = patch as Record<string, unknown>;
  const rows: { key: string; value: string }[] = [];
  if (p.mealRequiredAfterMinutes !== undefined) {
    const v = p.mealRequiredAfterMinutes;
    if (typeof v !== "number" || !Number.isInteger(v) || (v !== 0 && (v < MEAL_MIN || v > MEAL_MAX)))
      return { rows: [], error: `breakRules.mealRequiredAfterMinutes must be 0 (off) or ${MEAL_MIN}–${MEAL_MAX}` };
    rows.push({ key: MEAL_KEY, value: String(v) });
  }
  if (p.attestationEnabled !== undefined) {
    if (typeof p.attestationEnabled !== "boolean")
      return { rows: [], error: "breakRules.attestationEnabled must be a boolean" };
    rows.push({ key: ATTEST_KEY, value: String(p.attestationEnabled) });
  }
  return { rows, error: null };
}

export type BreakTypeRow = {
  id: number;
  name: string;
  paid: boolean;
  min_minutes: number | null;
  sort_order: number;
  archived_at: string | null;
};

export const BREAK_TYPE_COLUMNS = "id, name, paid, min_minutes, sort_order, archived_at";

export function toBreakType(r: BreakTypeRow): BreakType {
  return {
    id: Number(r.id),
    name: r.name,
    paid: !!r.paid,
    minMinutes: r.min_minutes ?? null,
    sortOrder: r.sort_order ?? 0,
    archived: r.archived_at != null,
  };
}

/** Active types in the order the clock offers them. */
export function activeBreakTypes(types: BreakType[]): BreakType[] {
  return types.filter((t) => !t.archived).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/** Validates a break type's name; returns the trimmed name or an error. */
export function parseBreakTypeName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "name must be a string" };
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "name is required" };
  if ([...name].length > BREAK_TYPE_NAME_MAX) return { ok: false, error: `name must be ${BREAK_TYPE_NAME_MAX} characters or fewer` };
  return { ok: true, name };
}

/** Validates an optional minimum length in minutes (null = none). */
export function parseBreakMinMinutes(raw: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > BREAK_TYPE_MIN_MINUTES_MAX)
    return { ok: false, error: `minMinutes must be null or 1–${BREAK_TYPE_MIN_MINUTES_MAX}` };
  return { ok: true, value: raw };
}
