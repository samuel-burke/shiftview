// Per-organization punch-violation policy.
//
// Orgs decide precisely what counts as a punch violation: how many minutes late
// or early an in/out punch may be before it's flagged, how long or short a break
// may run, the no-call-no-show grace window, and a hard cap on the number of
// breaks allowed per shift (enforced by the punch state machine, not just
// flagged after the fact).
//
// Stored in app_settings as individual text key/value rows (same shape as every
// other org setting) and parsed into this typed object. Unset keys fall back to
// DEFAULT_PUNCH_POLICY, so existing orgs get sane behavior with no migration.

export type PunchPolicy = {
  // Clock-in later than the scheduled start by more than N minutes.
  lateInEnabled: boolean;     lateInMinutes: number;
  // Clock-in earlier than the scheduled start by more than N minutes.
  earlyInEnabled: boolean;    earlyInMinutes: number;
  // Clock-out later than the scheduled end by more than N minutes.
  lateOutEnabled: boolean;    lateOutMinutes: number;
  // Clock-out earlier than the scheduled end by more than N minutes.
  earlyOutEnabled: boolean;   earlyOutMinutes: number;
  // A break (break_start → break_end) running longer than N minutes.
  longBreakEnabled: boolean;  longBreakMinutes: number;
  // A break running shorter than N minutes.
  shortBreakEnabled: boolean; shortBreakMinutes: number;
  // Scheduled, but no clock-in and no call-out N minutes past the start.
  ncnsEnabled: boolean;       ncnsMinutes: number;
  // Hard limit enforced by the punch state machine. 0 = unlimited.
  maxBreaksPerShift: number;
};

export const DEFAULT_PUNCH_POLICY: PunchPolicy = {
  lateInEnabled: true,     lateInMinutes: 6,
  earlyInEnabled: false,   earlyInMinutes: 15,
  lateOutEnabled: false,   lateOutMinutes: 15,
  earlyOutEnabled: true,   earlyOutMinutes: 6,
  longBreakEnabled: false, longBreakMinutes: 35,
  shortBreakEnabled: false, shortBreakMinutes: 20,
  ncnsEnabled: true,       ncnsMinutes: 60,
  maxBreaksPerShift: 0,
};

// Field ↔ app_settings key mapping, used for both parsing and validation. Kept
// as data so parse/serialize/validate can never drift out of sync.
const BOOL_FIELDS: { field: keyof PunchPolicy; key: string }[] = [
  { field: "lateInEnabled",     key: "punch_late_in_enabled" },
  { field: "earlyInEnabled",    key: "punch_early_in_enabled" },
  { field: "lateOutEnabled",    key: "punch_late_out_enabled" },
  { field: "earlyOutEnabled",   key: "punch_early_out_enabled" },
  { field: "longBreakEnabled",  key: "punch_long_break_enabled" },
  { field: "shortBreakEnabled", key: "punch_short_break_enabled" },
  { field: "ncnsEnabled",       key: "punch_ncns_enabled" },
];

const NUMERIC_FIELDS: { field: keyof PunchPolicy; key: string; min: number; max: number }[] = [
  { field: "lateInMinutes",     key: "punch_late_in_minutes",     min: 0, max: 480 },
  { field: "earlyInMinutes",    key: "punch_early_in_minutes",    min: 0, max: 480 },
  { field: "lateOutMinutes",    key: "punch_late_out_minutes",    min: 0, max: 480 },
  { field: "earlyOutMinutes",   key: "punch_early_out_minutes",   min: 0, max: 480 },
  { field: "longBreakMinutes",  key: "punch_long_break_minutes",  min: 1, max: 480 },
  { field: "shortBreakMinutes", key: "punch_short_break_minutes", min: 1, max: 480 },
  { field: "ncnsMinutes",       key: "punch_ncns_minutes",        min: 1, max: 1440 },
  { field: "maxBreaksPerShift", key: "punch_max_breaks_per_shift", min: 0, max: 20 },
];

function parseBool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === "") return def;
  return v === "true";
}

function parseInt10(v: string | undefined, def: number): number {
  if (v === undefined || v === "") return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

// Builds a PunchPolicy from a raw app_settings key→value map.
export function parsePunchPolicy(map: Record<string, string>): PunchPolicy {
  const policy = { ...DEFAULT_PUNCH_POLICY };
  for (const { field, key } of BOOL_FIELDS) {
    (policy[field] as boolean) = parseBool(map[key], DEFAULT_PUNCH_POLICY[field] as boolean);
  }
  for (const { field, key } of NUMERIC_FIELDS) {
    (policy[field] as number) = parseInt10(map[key], DEFAULT_PUNCH_POLICY[field] as number);
  }
  return policy;
}

// Validates a partial policy patch and converts it to app_settings rows. Returns
// an error string instead of rows when any provided field is malformed.
export function punchPolicyRows(
  input: Record<string, unknown>
): { rows: { key: string; value: string }[]; error: string | null } {
  const rows: { key: string; value: string }[] = [];

  for (const { field, key } of BOOL_FIELDS) {
    const v = input[field];
    if (v === undefined) continue;
    if (typeof v !== "boolean")
      return { rows: [], error: `${field} must be a boolean` };
    rows.push({ key, value: String(v) });
  }

  for (const { field, key, min, max } of NUMERIC_FIELDS) {
    const v = input[field];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max)
      return { rows: [], error: `${field} must be an integer between ${min} and ${max}` };
    rows.push({ key, value: String(n) });
  }

  return { rows, error: null };
}
