// Seeds the demo organization with realistic sample data. Runs with the
// service-role (admin) client against an EMPTY demo org — callers must invoke
// the reset_demo_org() SQL function first (see /api/cron/demo-reset).
//
// data/demo-fixtures.ts stays the single source of truth for WHAT the demo
// contains; this module turns it into rows. Schedules and punches are seeded
// on a rolling window around "today" so the demo never goes stale.

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_ORG_ID, DEMO_MANAGER_EMAIL } from "@/lib/demo-org";
import {
  DEMO_EMPLOYEES,
  EMPLOYEE_PATTERNS,
  DEMO_AVAILABILITY,
  DEMO_SETTINGS,
  DEMO_STORE_HOURS,
  DEMO_COVERAGE_PROFILES,
  DEMO_COVERAGE_DEFAULTS,
} from "@/data/demo-fixtures";

const PAST_DAYS = 7;    // published history (timesheets, reports)
const FUTURE_DAYS = 14; // published schedule horizon
const DRAFT_DAYS = 7;   // unpublished drafts beyond the horizon

export type DemoSeedResult = {
  employees: number;
  schedules: number;
  punches: number;
};

function must<T>(data: T | null, error: { message: string } | null, step: string): T {
  if (error || data == null) {
    throw new Error(`[demo-seed] ${step} failed: ${error?.message ?? "no data returned"}`);
  }
  return data;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// `date` + minutes-since-midnight as wall-clock time in `timeZone` → UTC ISO.
function zonedToUtcIso(date: string, minutes: number, timeZone: string): string {
  const guess = new Date(`${date}T00:00:00Z`).getTime() + minutes * 60_000;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return new Date(guess - (asUtc - guess)).toISOString();
}

export async function seedDemoOrg(admin: SupabaseClient): Promise<DemoSeedResult> {
  const timezone = DEMO_SETTINGS.timezone;
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const today = new Date(`${todayKey}T12:00:00Z`);

  // 1. Employees. Ids are identity-generated, so build a fixture-id → db-id
  //    map from the insert result. user_id stays null — POST /api/demo/start
  //    links the visiting anonymous user to the demo manager's row.
  const employeeRows = DEMO_EMPLOYEES.map((e) => ({
    org_id: DEMO_ORG_ID,
    name: e.name,
    email: e.id === 1 ? DEMO_MANAGER_EMAIL : (e.email ?? null),
    user_id: null,
  }));
  const { data: insertedEmployees, error: empError } = await admin
    .from("employees")
    .insert(employeeRows)
    .select("id, name");
  const employees = must(insertedEmployees, empError, "employees insert");
  const empId = new Map<number, number>(
    DEMO_EMPLOYEES.map((fixture) => [
      fixture.id,
      employees.find((row) => row.name === fixture.name)!.id,
    ])
  );

  // 2. Availability.
  const availabilityRows = Object.entries(DEMO_AVAILABILITY).flatMap(([fixtureId, records]) =>
    records.map((r) => ({
      org_id: DEMO_ORG_ID,
      employee_id: empId.get(Number(fixtureId))!,
      day_of_week: r.dayOfWeek,
      start_minutes: r.startMinutes,
      end_minutes: r.endMinutes,
      note: r.note,
    }))
  );
  if (availabilityRows.length > 0) {
    const { error } = await admin.from("availability").insert(availabilityRows);
    if (error) throw new Error(`[demo-seed] availability insert failed: ${error.message}`);
  }

  // 3. Settings. email_notifications stays "false" as an extra layer on top of
  //    the demo-org email suppression.
  const settingsRows = [
    { key: "first_day_of_week",       value: String(DEMO_SETTINGS.firstDayOfWeek) },
    { key: "timezone",                value: timezone },
    { key: "coverage_alerts_enabled", value: String(DEMO_SETTINGS.coverageAlertsEnabled) },
    { key: "email_notifications",     value: "false" },
    { key: "manual_punches_enabled",  value: String(DEMO_SETTINGS.manualPunchesEnabled) },
    { key: "gps_required",            value: "false" },
    { key: "geofence_enabled",        value: "false" },
    { key: "geofence_radius",         value: String(DEMO_SETTINGS.geofenceRadius) },
  ].map((r) => ({ ...r, org_id: DEMO_ORG_ID }));
  {
    const { error } = await admin.from("app_settings").insert(settingsRows);
    if (error) throw new Error(`[demo-seed] app_settings insert failed: ${error.message}`);
  }

  // 4. Store hours.
  const storeHoursRows = Object.entries(DEMO_STORE_HOURS).map(([dow, h]) => ({
    org_id: DEMO_ORG_ID,
    day_of_week: Number(dow),
    open_minutes: h.open,
    close_minutes: h.close,
  }));
  {
    const { error } = await admin.from("store_hours").insert(storeHoursRows);
    if (error) throw new Error(`[demo-seed] store_hours insert failed: ${error.message}`);
  }

  // 5. Coverage profiles, blocks, and day defaults.
  const profileId = new Map<number, number>();
  for (const profile of DEMO_COVERAGE_PROFILES) {
    const { data, error } = await admin
      .from("coverage_profiles")
      .insert({ org_id: DEMO_ORG_ID, name: profile.name })
      .select("id")
      .single();
    const row = must(data, error, `coverage_profiles insert (${profile.name})`);
    profileId.set(profile.id, row.id);

    const { error: blocksError } = await admin.from("coverage_profile_blocks").insert(
      profile.blocks.map((b) => ({
        org_id: DEMO_ORG_ID,
        profile_id: row.id,
        start_minutes: b.startMinutes,
        end_minutes: b.endMinutes,
        headcount: b.headcount,
      }))
    );
    if (blocksError) throw new Error(`[demo-seed] coverage blocks insert failed: ${blocksError.message}`);
  }
  {
    const { error } = await admin.from("coverage_day_defaults").insert(
      Object.entries(DEMO_COVERAGE_DEFAULTS).map(([dow, fixtureProfileId]) => ({
        org_id: DEMO_ORG_ID,
        day_of_week: Number(dow),
        profile_id: profileId.get(fixtureProfileId)!,
      }))
    );
    if (error) throw new Error(`[demo-seed] coverage_day_defaults insert failed: ${error.message}`);
  }

  // 6. Time off — one approved (suppresses that day's shift below) and one
  //    pending request so the approvals queue isn't empty.
  const plusDays = (n: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + n);
    return dateKey(d);
  };
  const approvedPto = { fixtureId: 2, date: plusDays(5) };
  const pendingPto  = { fixtureId: 4, date: plusDays(8) };
  {
    const { error } = await admin.from("time_off_requests").insert([
      {
        org_id: DEMO_ORG_ID,
        employee_id: empId.get(approvedPto.fixtureId)!,
        date: approvedPto.date,
        status: "approved",
        note: "Family event",
      },
      {
        org_id: DEMO_ORG_ID,
        employee_id: empId.get(pendingPto.fixtureId)!,
        date: pendingPto.date,
        status: "pending",
        note: "Dentist appointment",
      },
    ]);
    if (error) throw new Error(`[demo-seed] time_off_requests insert failed: ${error.message}`);
  }

  // 7. Published schedules on a rolling window around today.
  const scheduleRows: Array<{
    org_id: string; employee_id: number; date: string;
    start_minutes: number; end_minutes: number;
  }> = [];
  for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset++) {
    const date = plusDays(offset);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const fixture of DEMO_EMPLOYEES) {
      const shift = EMPLOYEE_PATTERNS[fixture.id]?.[dow];
      if (!shift) continue;
      if (fixture.id === approvedPto.fixtureId && date === approvedPto.date) continue;
      scheduleRows.push({
        org_id: DEMO_ORG_ID,
        employee_id: empId.get(fixture.id)!,
        date,
        start_minutes: shift[0],
        end_minutes: shift[1],
      });
    }
  }
  const { data: insertedSchedules, error: schedError } = await admin
    .from("schedules")
    .insert(scheduleRows)
    .select("id, employee_id, date, start_minutes, end_minutes");
  const schedules = must(insertedSchedules, schedError, "schedules insert");

  // 8. Punches for past shifts AND today's: clocked in a touch early/late,
  //    a mid-shift break, out near shift end. Today's punches are written for
  //    the whole day up front — /api/punches caps the day window at "now", so
  //    a visitor at any hour sees people live: clocked in, on break during
  //    their (staggered) break window, and clocked out after their shift.
  const punchRows: Array<Record<string, unknown>> = [];
  for (const s of schedules) {
    if (s.date > todayKey) continue;
    const jitterIn  = ((s.id * 7) % 9) - 3;  // deterministic -3..+5 min
    const jitterOut = (s.id * 5) % 8;        // deterministic 0..+7 min
    const punch = (punch_type: string, minutes: number) =>
      punchRows.push({
        org_id: DEMO_ORG_ID,
        employee_id: s.employee_id,
        schedule_id: s.id,
        punch_type,
        punched_at: zonedToUtcIso(s.date, minutes, timezone),
      });

    punch("clock_in", s.start_minutes + jitterIn);

    // 30-minute break for shifts of 5h+, staggered per employee (35–56% into
    // the shift) so someone is usually "On Break" whenever a visitor looks.
    const shiftLen = s.end_minutes - s.start_minutes;
    if (shiftLen >= 300) {
      const fraction = 0.35 + (s.employee_id % 4) * 0.07;
      const breakStart = s.start_minutes + Math.round((shiftLen * fraction) / 5) * 5;
      punch("break_start", breakStart);
      punch("break_end", breakStart + 30);
    }

    punch("clock_out", s.end_minutes + jitterOut);
  }
  if (punchRows.length > 0) {
    const { error } = await admin.from("punch_records").insert(punchRows);
    if (error) throw new Error(`[demo-seed] punch_records insert failed: ${error.message}`);
  }

  // 9. One pending shift swap between two upcoming shifts.
  const upcomingFor = (fixtureId: number) =>
    schedules
      .filter((s) => s.employee_id === empId.get(fixtureId) && s.date > todayKey)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
  const swapA = upcomingFor(3);
  const swapB = upcomingFor(5);
  if (swapA && swapB) {
    const { error } = await admin.from("shift_swaps").insert({
      org_id: DEMO_ORG_ID,
      requester_id: empId.get(3)!,
      target_id: empId.get(5)!,
      schedule_a_id: swapA.id,
      schedule_b_id: swapB.id,
    });
    if (error) throw new Error(`[demo-seed] shift_swaps insert failed: ${error.message}`);
  }

  // 10. Draft schedules for the week beyond the published horizon.
  const draftRows: Array<Record<string, unknown>> = [];
  for (let offset = FUTURE_DAYS + 1; offset <= FUTURE_DAYS + DRAFT_DAYS; offset++) {
    const date = plusDays(offset);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const fixture of DEMO_EMPLOYEES) {
      const shift = EMPLOYEE_PATTERNS[fixture.id]?.[dow];
      if (!shift) continue;
      draftRows.push({
        org_id: DEMO_ORG_ID,
        employee_id: empId.get(fixture.id)!,
        date,
        start_minutes: shift[0],
        end_minutes: shift[1],
      });
    }
  }
  if (draftRows.length > 0) {
    const { error } = await admin.from("draft_schedules").insert(draftRows);
    if (error) throw new Error(`[demo-seed] draft_schedules insert failed: ${error.message}`);
  }

  // 11. A reusable template mirroring the weekly pattern.
  const { data: template, error: tplError } = await admin
    .from("schedule_templates")
    .insert({ org_id: DEMO_ORG_ID, name: "Standard Week" })
    .select("id")
    .single();
  const tpl = must(template, tplError, "schedule_templates insert");
  const templateRows = DEMO_EMPLOYEES.flatMap((fixture) =>
    (EMPLOYEE_PATTERNS[fixture.id] ?? []).flatMap((shift, dow) =>
      shift
        ? [{
            org_id: DEMO_ORG_ID,
            template_id: tpl.id,
            employee_id: empId.get(fixture.id)!,
            day_of_week: dow,
            start_minutes: shift[0],
            end_minutes: shift[1],
          }]
        : []
    )
  );
  {
    const { error } = await admin.from("schedule_template_rows").insert(templateRows);
    if (error) throw new Error(`[demo-seed] schedule_template_rows insert failed: ${error.message}`);
  }

  return {
    employees: employees.length,
    schedules: schedules.length,
    punches: punchRows.filter((p) => p.punch_type === "clock_in").length,
  };
}
