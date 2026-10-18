// Kiosk mode: a shared store tablet that employees punch on with a PIN.
// Shared by the kiosk API routes, the kiosk page and Settings. The database
// (migration 0063) is the authority on PINs, lockout and kiosk punches; this
// file only holds what the app needs around it, safe for the browser too;
// tokens and cookies are in lib/kiosk-server.ts.

export const KIOSK_NAME_MAX = 60;

// A PIN as the database accepts it: 4 to 6 digits.
export function isPinShape(pin: unknown): pin is string {
  return typeof pin === "string" && /^[0-9]{4,6}$/.test(pin);
}

// Mirrors kiosk_check_pin_format in 0063, so the PIN form can say why before
// the round trip. The database decides.
export function pinProblem(pin: string): string | null {
  if (!/^[0-9]{4,6}$/.test(pin)) return "A PIN must be 4 to 6 digits";
  if (/^(.)\1+$/.test(pin) || "01234567890".includes(pin) || "09876543210".includes(pin))
    return "That PIN is too easy to guess — choose another";
  return null;
}

export type PunchType = "clock_in" | "clock_out" | "break_start" | "break_end";
export const PUNCH_TYPES: PunchType[] = ["clock_in", "clock_out", "break_start", "break_end"];

export type KioskState = "clocked_out" | "on_shift" | "on_break";

// The employee's state from their current shift's latest punch type.
export function kioskState(lastType: string | null | undefined): KioskState {
  if (lastType === "clock_in" || lastType === "break_end") return "on_shift";
  if (lastType === "break_start") return "on_break";
  return "clocked_out";
}

// The punches allowed next — the same transitions as POST /api/punches.
export function kioskActions(lastType: string | null | undefined): PunchType[] {
  switch (kioskState(lastType)) {
    case "on_shift": return ["break_start", "clock_out"];
    case "on_break": return ["break_end"];
    default:         return ["clock_in"];
  }
}

export const KIOSK_STATE_LABEL: Record<KioskState, string> = {
  clocked_out: "Clocked out",
  on_shift:    "On shift",
  on_break:    "On break",
};

export const PUNCH_LABEL: Record<PunchType, string> = {
  clock_in:    "Clock in",
  clock_out:   "Clock out",
  break_start: "Start break",
  break_end:   "End break",
};

// The kiosk screen forgets the employee after this long without a tap, and
// shows a punch's confirmation for CONFIRM_MS before clearing.
export const KIOSK_IDLE_MS = 30_000;
export const KIOSK_CONFIRM_MS = 4_000;

// kiosk_identify's answer (0063).
export type KioskIdentifyResult =
  | { status: "ok"; org_id: string; kiosk_id: number; employee_id: number; employee_name: string | null }
  | { status: "no_kiosk" }
  | { status: "disabled" }
  | { status: "locked"; needs_manager: boolean; retry_after?: number }
  | { status: "wrong"; attempts_left: number };

// The HTTP reply for every non-ok identify. One message for every wrong PIN,
// whatever the reason (unknown, another store's, an archived employee's), so
// the kiosk never says whose PIN it was or that it was close.
export function identifyFailure(r: Exclude<KioskIdentifyResult, { status: "ok" }>): {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
} {
  switch (r.status) {
    case "no_kiosk":
      return { status: 401, body: { error: "This device isn't set up as a kiosk — ask a manager", code: "no_kiosk" } };
    case "disabled":
      return { status: 403, body: { error: "Kiosk mode is turned off for this store", code: "disabled" } };
    case "locked":
      return r.needs_manager
        ? { status: 423, body: { error: "Too many wrong PINs — a manager must unlock this kiosk in Settings", code: "locked", needsManager: true } }
        : {
            status: 429,
            body: { error: "Too many wrong PINs — try again in a few minutes", code: "locked", needsManager: false, retryAfter: r.retry_after ?? 300 },
            headers: { "Retry-After": String(r.retry_after ?? 300) },
          };
    case "wrong":
      return { status: 401, body: { error: "PIN not recognized", code: "wrong_pin", attemptsLeft: r.attempts_left } };
  }
}
