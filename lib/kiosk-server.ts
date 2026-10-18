// Server side of kiosk mode: the device token, PIN checks and kiosk punches.
// Every kiosk request runs with the service role (there is no signed-in user
// on a kiosk), so the database checks everything again (migration 0063):
// kiosk_identify owns the PIN check and lockout, and enforce_kiosk_punch the
// punch rules. The checks here are for readable answers.

import { createHash, randomBytes } from "node:crypto";
import { readCookie } from "@/lib/org-context";
import { writeAuditLog } from "@/lib/audit";
import { notifyManagers } from "@/lib/notify";
import { fmtMinutes } from "@/data/types";
import { addDaysToKey, minutesFromScheduled, resolveTimezone, todayKeyInTz } from "@/lib/dates";
import { clockInTiming, parsePunchPolicy } from "@/lib/punch-policy";
import { loadCurrentShift } from "@/lib/current-shift-server";
import { pickClockInShift } from "@/lib/punch-schedule";
import {
  identifyFailure,
  kioskActions,
  kioskState,
  type KioskIdentifyResult,
  type KioskState,
  type PunchType,
} from "@/lib/kiosk";

type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

// HttpOnly so no script on the page (or an XSS) can read it, SameSite=Strict
// so another site can't make the tablet punch, and scoped to the kiosk API so
// it is sent nowhere else.
export const KIOSK_COOKIE = "sv_kiosk";
export const KIOSK_COOKIE_PATH = "/api/kiosk";
// Browsers cap cookie lifetimes at 400 days; a manager re-registers after.
export const KIOSK_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export function newKioskToken(): string {
  return randomBytes(32).toString("base64url");
}

// The only form of the token the database sees. The token is 256 random
// bits, so a fast hash is enough: there is nothing to brute-force.
export function hashKioskToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Tokens we issue are 43 base64url characters; anything else is refused
// before it reaches the database.
export function isKioskTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function kioskTokenFromRequest(request: Request): string | null {
  const token = readCookie(request.headers.get("cookie"), KIOSK_COOKIE);
  return isKioskTokenShape(token) ? token : null;
}

function isSecure(request: Request): boolean {
  return process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
}

export function kioskCookieHeader(token: string, request: Request): string {
  return [
    `${KIOSK_COOKIE}=${token}`,
    `Path=${KIOSK_COOKIE_PATH}`,
    `Max-Age=${KIOSK_COOKIE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(isSecure(request) ? ["Secure"] : []),
  ].join("; ");
}

export function clearKioskCookieHeader(request: Request): string {
  return [
    `${KIOSK_COOKIE}=`,
    `Path=${KIOSK_COOKIE_PATH}`,
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    ...(isSecure(request) ? ["Secure"] : []),
  ].join("; ");
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export type KioskEmployee = { orgId: string; kioskId: number; employeeId: number; employeeName: string };

// Checks the device token and PIN. Either the employee, or the reply to send.
// A missing or malformed token never reaches the database.
export async function identifyAtKiosk(
  admin: Client,
  request: Request,
  pin: unknown,
): Promise<{ who: KioskEmployee; response: null } | { who: null; response: Response }> {
  const token = kioskTokenFromRequest(request);
  if (!token) {
    const f = identifyFailure({ status: "no_kiosk" });
    return { who: null, response: jsonResponse(f.body, f.status) };
  }
  // A malformed PIN still goes to the database, which counts it as a wrong
  // attempt — otherwise it would be a free probe.
  const { data, error } = await admin.rpc("kiosk_identify", {
    p_token_hash: hashKioskToken(token),
    p_pin: typeof pin === "string" ? pin.slice(0, 16) : "",
  });
  if (error || !data || typeof data !== "object") {
    console.error("[kiosk] identify", error);
    return { who: null, response: jsonResponse({ error: "Internal server error" }, 500) };
  }
  const r = data as KioskIdentifyResult;
  if (r.status === "ok") {
    return {
      who: {
        orgId: r.org_id,
        kioskId: Number(r.kiosk_id),
        employeeId: Number(r.employee_id),
        employeeName: r.employee_name ?? "Employee",
      },
      response: null,
    };
  }
  if (r.status === "wrong" && r.attempts_left === 0) {
    // The attempt that locked the kiosk. Kiosk ids aren't secret; the store
    // is resolved from the token by kiosk_status.
    const { data: k } = await admin.rpc("kiosk_status", { p_token_hash: hashKioskToken(token) });
    if (k && typeof k === "object" && (k as { status?: string }).status === "ok") {
      const ks = k as { org_id: string; kiosk_id: number; kiosk_name: string };
      writeAuditLog({
        action: "kiosk.locked",
        orgId: ks.org_id,
        actorId: null,
        resourceType: "kiosk",
        resourceId: String(ks.kiosk_id),
        metadata: { kioskId: ks.kiosk_id, kioskName: ks.kiosk_name },
      }).catch(() => {});
    }
  }
  const f = identifyFailure(r);
  return { who: null, response: jsonResponse(f.body, f.status, f.headers) };
}

async function loadSettings(admin: Client, orgId: string): Promise<Record<string, string>> {
  const { data } = await admin.from("app_settings").select("key, value").eq("org_id", orgId);
  return Object.fromEntries(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
}

export type KioskShiftView = {
  employeeName: string;
  state: KioskState;
  actions: PunchType[];
  // When the current shift began (its clock-in), if on the clock.
  since: string | null;
};

// What the kiosk shows after a PIN: the employee's own name and state. Never
// anything about anyone else.
export async function kioskShiftView(admin: Client, who: KioskEmployee): Promise<KioskShiftView | null> {
  const settings = await loadSettings(admin, who.orgId);
  const tz = resolveTimezone(settings.timezone);
  const { shift, error } = await loadCurrentShift(admin, who.orgId, who.employeeId, tz);
  if (error || !shift) return null;
  const clockIn = [...shift.punches].reverse().find((p) => p.punchType === "clock_in");
  return {
    employeeName: who.employeeName,
    state: kioskState(shift.state),
    actions: kioskActions(shift.state),
    since: shift.state && shift.state !== "clock_out" ? clockIn?.punchedAt ?? null : null,
  };
}

// Records a punch at the kiosk with the same rules as POST /api/punches:
// the current-shift state machine, the break cap, the shift the clock-in is
// for, late clock-in alerts and the audit log. The database applies the
// state machine and break cap again under the employee's punch lock, stamps
// the time, and refuses archived employees and revoked kiosks.
export async function recordKioskPunch(
  admin: Client,
  who: KioskEmployee,
  punchType: PunchType,
): Promise<Response> {
  const settings = await loadSettings(admin, who.orgId);
  const tz = resolveTimezone(settings.timezone);

  const { shift, error: shiftError } = await loadCurrentShift(admin, who.orgId, who.employeeId, tz);
  if (shiftError || !shift) {
    console.error("[kiosk] current shift", shiftError);
    return jsonResponse({ error: "Internal server error" }, 500);
  }

  if (!kioskActions(shift.state).includes(punchType)) {
    const msg = shift.carriedOver && punchType === "clock_in"
      ? "You're still clocked in from your shift that started yesterday — clock out first"
      : shift.state
        ? `Can't ${punchType.replace("_", " ")} now: you're ${kioskState(shift.state).replace("_", " ")}`
        : `Can't ${punchType.replace("_", " ")}: you're not clocked in`;
    return jsonResponse({ error: msg }, 409);
  }

  const policy = parsePunchPolicy(settings);
  if (punchType === "break_start" && policy.maxBreaksPerShift > 0) {
    const breaks = shift.punches.filter((p) => p.punchType === "break_start").length;
    if (breaks >= policy.maxBreaksPerShift)
      return jsonResponse({
        error: `Break limit reached — only ${policy.maxBreaksPerShift} ${policy.maxBreaksPerShift === 1 ? "break" : "breaks"} allowed per shift`,
      }, 409);
  }

  // A clock-in is booked against the shift it is for (the employee doesn't
  // pick one at the kiosk): the one running now, else the next today, else
  // the one that just ended — as the clock page picks it.
  type SchedRow = { id: number; employee_id: number; date: string; start_minutes: number; end_minutes: number };
  let sched: SchedRow | null = null;
  if (punchType === "clock_in") {
    const today = todayKeyInTz(tz);
    const { data: rows } = await admin
      .from("schedules")
      .select("id, employee_id, date, start_minutes, end_minutes")
      .eq("org_id", who.orgId)
      .eq("employee_id", who.employeeId)
      .gte("date", addDaysToKey(today, -1))
      .lte("date", today);
    const shifts = ((rows ?? []) as SchedRow[]).map((s) => ({
      ...s,
      employeeId: s.employee_id,
      startMinutes: s.start_minutes,
      endMinutes: s.end_minutes,
    }));
    const picked = pickClockInShift(who.employeeId, shifts, tz);
    sched = picked
      ? { id: picked.id, employee_id: picked.employee_id, date: picked.date, start_minutes: picked.start_minutes, end_minutes: picked.end_minutes }
      : null;
  }

  const { data, error: insertError } = await admin
    .from("punch_records")
    .insert({
      org_id:      who.orgId,
      employee_id: who.employeeId,
      schedule_id: sched?.id ?? null,
      punch_type:  punchType,
      source:      "kiosk",
      kiosk_id:    who.kioskId,
    })
    .select("id, punch_type, punched_at")
    .single();

  if (insertError || !data) {
    const code = insertError?.code;
    if (code === "23P01")
      return jsonResponse({ error: "Your punch changed on another device — try again" }, 409);
    if (code === "KP001")
      return jsonResponse({ error: "This kiosk is no longer active — ask a manager", code: "no_kiosk" }, 401);
    if (code === "42501")
      return jsonResponse({ error: "You can't clock in or out here — ask a manager" }, 403);
    if (code === "23514")
      return jsonResponse({ error: "Your shift changed — try again" }, 409);
    console.error("[kiosk] punch insert", insertError);
    return jsonResponse({ error: "Internal server error" }, 500);
  }

  if (punchType === "clock_in" && sched) {
    const lateMinutes = minutesFromScheduled(data.punched_at, sched.date, sched.start_minutes, tz);
    if (clockInTiming(policy, lateMinutes) === "late") {
      notifyManagers(
        who.orgId,
        "late_clock_in",
        "Late Clock-In",
        `${who.employeeName} clocked in ${lateMinutes}m late at the kiosk (scheduled ${fmtMinutes(sched.start_minutes)})`,
        { employeeId: who.employeeId, scheduleId: sched.id, lateMinutes },
      ).catch(() => {});
    }
  }

  writeAuditLog({
    action:       `punch.${punchType}`,
    orgId:        who.orgId,
    actorId:      null,
    resourceType: "punch_record",
    resourceId:   String(data.id),
    after: { employeeId: who.employeeId, punchType, scheduleId: sched?.id ?? null, source: "kiosk", kioskId: who.kioskId },
    metadata: {
      employeeId:   who.employeeId,
      employeeName: who.employeeName,
      punchType,
      punchedAt:    data.punched_at,
      source:       "kiosk",
      kioskId:      who.kioskId,
    },
  }).catch(() => {});

  return jsonResponse({
    employeeName: who.employeeName,
    punchType,
    punchedAt: data.punched_at,
    state: kioskState(punchType),
  }, 201);
}
