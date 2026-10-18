import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { notifyManagers } from "@/lib/notify";
import { fmtMinutes } from "@/data/types";
import { writeAuditLog } from "@/lib/audit";
import { haversineMeters } from "@/lib/haversine";
import { parseGeofenceConfig, parsePunchCoordinates } from "@/lib/geo-validation";
import { addDaysToKey, dateKeyInTz, formatDateKey, formatTimeInTz, isDateKey, localDayBoundsUtc, minutesFromScheduled, parseHHMM, resolveTimezone, todayKeyInTz, zonedTimeToUtc } from "@/lib/dates";
import { clockInTiming, parsePunchPolicy } from "@/lib/punch-policy";
import { resolveManualPunchTime } from "@/lib/manual-punch-time";
import { checkManualPunchAgainstHistory } from "@/lib/manual-punch-rules";
import { loadCarriedOverPunches, loadCurrentShift, PUNCH_COLUMNS } from "@/lib/current-shift-server";
import { isClockInShift, isScheduleIdInput, isShiftNearPunch, loadOwnSchedule, type PunchSchedule } from "@/lib/punch-schedule";
import { parsePunchNote } from "@/lib/punch-note";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Refusal for a geofenced clock-in sent without a location (the database's
// GF002 says the same).
const GEOFENCE_LOCATION_NEEDED =
  "Location needed to clock in — this store only allows clock-in near the store. Turn on location and try again";

// How far back an employee may ask for a missed punch to be added. Managers
// have no limit.
const CORRECTION_REQUEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function mapRow(r: Record<string, unknown>) {
  return {
    id:         r.id,
    employeeId: r.employee_id,
    scheduleId: r.schedule_id ?? null,
    punchType:  r.punch_type,
    punchedAt:  r.punched_at,
    lat:        r.lat ?? null,
    lng:        r.lng ?? null,
    isManual:   r.is_manual,
    note:       r.note ?? null,
    employeeNote: r.employee_note ?? null,
  };
}

// GET /api/punches?date=YYYY-MM-DD
// Managers receive all employees' punches; employees receive only their own.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) return NextResponse.json({ error: "date param required" }, { status: 400 });
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated") return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error) return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;

  // Resolve store timezone so the day window is in local time, not UTC.
  const { data: settingsData } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId);
  const settingsMap = Object.fromEntries(
    (settingsData ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
  const tz = resolveTimezone(settingsMap.timezone);
  const { start: dayStart, end: dayEnd } = localDayBoundsUtc(date, tz);

  // A day's view never includes punches that haven't happened yet. Attendance
  // status is derived from the latest punch, so a future-dated row (manual
  // correction typos, or the demo org's pre-seeded day) would flip someone to
  // "clocked out" hours before their shift ends.
  const upperBound = new Date(Math.min(dayEnd.getTime(), Date.now()));

  let query = supabase
    .from("punch_records")
    .select(PUNCH_COLUMNS)
    .eq("org_id", orgId)
    .gte("punched_at", dayStart.toISOString())
    .lte("punched_at", upperBound.toISOString())
    .order("punched_at");

  if (!isManager) {
    if (!employeeId) return NextResponse.json([]);
    query = query.eq("employee_id", employeeId);
  }

  const { data, error: fetchError } = await query;
  if (fetchError) {
    console.error("[api/punches]", fetchError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const rows = (data ?? []) as Record<string, unknown>[];

  // ?carried=1 on today's date: also include the earlier punches of shifts
  // still open from before midnight (closers, overnight shifts), so a live
  // view shows them as clocked in rather than "not here yet".
  if (searchParams.get("carried") === "1" && date === todayKeyInTz(tz)) {
    const { punches: carried } = await loadCarriedOverPunches(
      supabase, orgId, tz, Date.now(), isManager ? undefined : (employeeId ?? undefined),
    );
    const seen = new Set(rows.map((r) => r.id));
    const earlier = carried.filter((p) => !seen.has(p.id)) as unknown as Record<string, unknown>[];
    return NextResponse.json([...earlier, ...rows].map(mapRow));
  }

  return NextResponse.json(rows.map(mapRow));
}

// POST /api/punches — employee clocks a punch
// Body: { punchType, scheduleId?, lat?, lng?, note? }
// `note` is the employee's own optional short note on the punch (at most 140
// characters, cleaned by lib/punch-note.ts and again by the database).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { punchType, scheduleId } = body;

  const VALID_TYPES = ["clock_in", "clock_out", "break_start", "break_end"];
  if (!punchType || !VALID_TYPES.includes(punchType))
    return NextResponse.json({ error: "punchType must be one of: " + VALID_TYPES.join(", ") }, { status: 400 });
  if (!isScheduleIdInput(scheduleId))
    return NextResponse.json({ error: "scheduleId must be a positive integer" }, { status: 400 });

  // Coordinates are stored with every punch and fed to the geofence distance
  // check, so malformed values (strings, NaN, Infinity, out of range, half a
  // pair) are rejected before anything else uses them.
  const coords = parsePunchCoordinates(body.lat, body.lng);
  if (!coords.ok)
    return NextResponse.json({ error: coords.error }, { status: 400 });
  const { lat, lng } = coords;

  const parsedNote = parsePunchNote(body.note);
  if (!parsedNote.ok)
    return NextResponse.json({ error: parsedNote.error }, { status: 400 });
  const employeeNote = parsedNote.note;

  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, employeeId } = ctx!;

  if (!employeeId)
    return NextResponse.json({ error: "No employee record linked to this account" }, { status: 403 });

  // Fetch the employee name for notifications/audit
  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", employeeId)
    .maybeSingle();

  if (!emp)
    return NextResponse.json({ error: "No employee record linked to this account" }, { status: 403 });

  // Fetch settings up front — needed for timezone (store-day state machine),
  // geofence enforcement, and late clock-in notifications.
  const { data: settingsData } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId);
  const settingsMap = Object.fromEntries(
    (settingsData ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
  const tz = resolveTimezone(settingsMap.timezone);

  // State machine over the employee's *current shift*: today's punches, or a
  // shift still open from the previous store day within the overnight grace
  // window (a closer clocking out after midnight). An older open shift is a
  // forgotten clock-out and never blocks today's clock-in.
  const { shift, error: shiftError } = await loadCurrentShift(supabase, orgId, emp.id, tz);
  if (shiftError || !shift) {
    console.error("[api/punches]", shiftError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const lastType = shift.state;

  const VALID_TRANSITIONS: Record<string, (string | null)[]> = {
    clock_in:    [null, "clock_out"],
    clock_out:   ["clock_in", "break_end"],
    break_start: ["clock_in", "break_end"],
    break_end:   ["break_start"],
  };

  if (!VALID_TRANSITIONS[punchType].includes(lastType)) {
    const msg = shift.carriedOver && punchType === "clock_in"
      ? "You're still clocked in from your shift that started yesterday — clock out first"
      : lastType
        ? `Cannot ${punchType}: current state is ${lastType}`
        : `Cannot ${punchType}: no active clock-in`;
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  // Configurable break cap: orgs can limit how many breaks a single shift may
  // contain. Count break_start punches since the shift's clock-in (which may
  // have been yesterday) and reject the new break_start once the limit is hit.
  const policy = parsePunchPolicy(settingsMap);
  if (punchType === "break_start" && policy.maxBreaksPerShift > 0) {
    const breaksThisShift = shift.punches.filter((p) => p.punchType === "break_start").length;
    if (breaksThisShift >= policy.maxBreaksPerShift) {
      return NextResponse.json(
        {
          error: `Break limit reached — only ${policy.maxBreaksPerShift} ${
            policy.maxBreaksPerShift === 1 ? "break" : "breaks"
          } allowed per shift`,
        },
        { status: 409 }
      );
    }
  }

  // The shift a punch is for must be the employee's own — never a coworker's,
  // another org's or a guessed id — and one they can punch now. A clock-in
  // naming any other shift is refused. Later punches only carry the shift as
  // a label, so a stale one (the shift was reassigned mid-shift) is dropped
  // rather than trapping the employee on the clock. Migration 0043 enforces
  // ownership in the database too.
  let sched: PunchSchedule | null = null;
  if (scheduleId != null) {
    sched = await loadOwnSchedule(supabase, orgId, emp.id, scheduleId);
    if (punchType === "clock_in") {
      if (!sched || !isClockInShift(sched, tz, Date.now()))
        return NextResponse.json({ error: "That shift isn't one you can clock in to" }, { status: 422 });
    } else if (sched && !isShiftNearPunch(sched, Date.now(), tz)) {
      sched = null;
    }
  }

  // Server-side geofence enforcement for clock_in. It applies whenever the
  // geofence is on, whether or not "Require GPS" is; a clock-in without a
  // location is refused then, or the geofence would be pointless. The
  // database applies the same rule (migration 0065).
  if (punchType === "clock_in") {
    if (settingsMap.geofence_enabled === "true") {
      const geofence = parseGeofenceConfig(
        settingsMap.geofence_lat,
        settingsMap.geofence_lng,
        settingsMap.geofence_radius
      );
      if (geofence.status === "invalid") {
        // Fail closed: a stored centre or radius that can't be used must not
        // silently turn enforcement off.
        console.error("[api/punches] invalid geofence settings for org", orgId);
        return NextResponse.json(
          { error: "Geofence location is misconfigured — ask a manager to update it in Settings" },
          { status: 422 }
        );
      }
      if (geofence.status === "ok") {
        const { lat: geofenceLat, lng: geofenceLng, radius: geofenceRadius } = geofence;
        if (lat === null || lng === null) {
          return NextResponse.json(
            { error: GEOFENCE_LOCATION_NEEDED },
            { status: 422 }
          );
        }
        const dist = haversineMeters(lat, lng, geofenceLat, geofenceLng);
        if (!(dist <= geofenceRadius)) {
          writeAuditLog({
            action:       "punch.geofence_rejected",
            orgId,
            actorId:      user.id,
            resourceType: "punch_record",
            after: { employeeId: emp.id, punchType, lat, lng },
            metadata: {
              employeeId:      emp.id,
              employeeName:    emp.name,
              distanceMeters:  Math.round(dist),
              radiusMeters:    geofenceRadius,
              attemptedLat:    lat,
              attemptedLng:    lng,
              geofenceLat,
              geofenceLng,
            },
          }).catch(() => {});
          return NextResponse.json(
            { error: `Outside geofence — you must be within ${geofenceRadius}m of the designated location to clock in (currently ${Math.round(dist)}m away)` },
            { status: 422 }
          );
        }
      }
    }
  }

  const { data, error: insertError } = await supabase
    .from("punch_records")
    .insert(withOrg(orgId, {
      employee_id: emp.id,
      schedule_id: sched?.id ?? null,
      punch_type:  punchType,
      lat:         lat ?? null,
      lng:         lng ?? null,
      employee_note: employeeNote,
    }))
    .select()
    .single();

  if (insertError) {
    // The database re-checks the step under a per-employee lock (migration
    // 0035): another punch landed between the check above and this insert —
    // a double tap, a retry, or a second device.
    if (insertError.code === "23P01")
      return NextResponse.json(
        { error: "Your punch changed on another request — refresh and try again" },
        { status: 409 }
      );
    // The database's shift check (migration 0043) — the shift changed hands
    // after the check above.
    if (insertError.code === "23514")
      return NextResponse.json({ error: "That shift isn't yours to punch — refresh and try again" }, { status: 422 });
    // The database enforces the geofence too (migration 0050), for punches
    // written without this route. Settings changed since the check above.
    if (typeof insertError.code === "string" && /^GF00[123]$/.test(insertError.code))
      return NextResponse.json({ error: insertError.message }, { status: 422 });
    console.error("[api/punches]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Alert managers to a late clock-in — late by the org's punch policy, the
  // same rule the time card flags it with.
  if (punchType === "clock_in" && sched) {
    const lateMinutes = minutesFromScheduled(data.punched_at, sched.date, sched.start_minutes, tz);
    if (clockInTiming(policy, lateMinutes) === "late") {
      notifyManagers(
        orgId,
        "late_clock_in",
        "Late Clock-In",
        `${emp.name ?? "An employee"} clocked in ${lateMinutes}m late (scheduled ${fmtMinutes(sched.start_minutes)})`,
        { employeeId: sched.employee_id, scheduleId: sched.id, lateMinutes }
      ).catch(() => {});
    }
  }

  writeAuditLog({
    action:       `punch.${punchType}`,
    orgId,
    actorId:      user.id,
    resourceType: "punch_record",
    resourceId:   String(data.id),
    after: { employeeId: emp.id, punchType, scheduleId: sched?.id ?? null },
    metadata: {
      employeeId:   emp.id,
      employeeName: emp.name,
      punchType,
      punchedAt:    data.punched_at,
      lat:          lat ?? null,
      lng:          lng ?? null,
      employeeNote,
    },
  }).catch(() => {});

  return NextResponse.json(mapRow(data), { status: 201 });
}

// PUT /api/punches — correct / add a missed punch
// Managers can correct any punch directly. An employee's request to add a
// missed punch is filed for manager approval (202) — see /api/punch-corrections.
// Body: { id?, employeeId?, punchType, note, scheduleId?, localDate + localTime | punchedAt }
//
// The time may be given as the store-local wall clock (localDate YYYY-MM-DD +
// localTime HH:MM), which the server converts with the org's timezone — the
// browser's zone is never trusted — or as an absolute ISO punchedAt. Either
// way the server validates it against its own clock and stores a normalized
// timestamp. Live punches (POST) never accept a client time at all.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { id, employeeId, punchType, punchedAt, localDate, localTime, note, scheduleId } = body;

  const VALID_TYPES = ["clock_in", "clock_out", "break_start", "break_end"];

  if (!punchType || !VALID_TYPES.includes(punchType))
    return NextResponse.json({ error: "punchType required" }, { status: 400 });
  if (!isScheduleIdInput(scheduleId))
    return NextResponse.json({ error: "scheduleId must be a positive integer" }, { status: 400 });

  const usesLocalTime = localDate !== undefined || localTime !== undefined;
  if (usesLocalTime) {
    if (!isDateKey(localDate))
      return NextResponse.json({ error: "localDate must be a valid YYYY-MM-DD date" }, { status: 400 });
    if (parseHHMM(localTime) === null)
      return NextResponse.json({ error: "localTime must be HH:MM (24-hour)" }, { status: 400 });
  } else {
    if (!punchedAt)
      return NextResponse.json({ error: "punchedAt required" }, { status: 400 });
    if (typeof punchedAt !== "string" || isNaN(new Date(punchedAt).getTime()))
      return NextResponse.json({ error: "punchedAt must be a valid ISO timestamp" }, { status: 400 });
  }

  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, isManager } = ctx!;

  // Check if manual punch corrections are enabled
  const { data: settingsData } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId);
  const settingsMap = Object.fromEntries(
    (settingsData ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
  if (settingsMap.manual_punches_enabled === "false") {
    return NextResponse.json({ error: "Manual punch corrections are disabled" }, { status: 403 });
  }
  const tz = resolveTimezone(settingsMap.timezone);

  const ts = usesLocalTime
    ? zonedTimeToUtc(localDate, parseHHMM(localTime)!, tz)
    : new Date(punchedAt);
  const now = Date.now();
  if (ts.getTime() > now)
    return NextResponse.json({ error: "The punch time can't be in the future" }, { status: 400 });
  // An employee's correction request must be for the last 30 days (the
  // database refuses older ones too, 0051). A manager may add or fix a punch
  // of any age — a late payroll correction — and gives a reason like any
  // other manual punch (below; kept in its history by 0053).
  if (!isManager && ts.getTime() < now - CORRECTION_REQUEST_WINDOW_MS)
    return NextResponse.json({ error: "The punch time must be within the last 30 days and not in the future" }, { status: 400 });
  let punchedAtIso = ts.toISOString();

  // Employees may only *add* a missing punch — never rewrite an existing one,
  // which would let them move a real, server-stamped punch.
  if (!isManager && id != null)
    return NextResponse.json({ error: "Only managers can edit existing punches" }, { status: 403 });
  // Every manual punch says why, a manager's own add or edit included. The
  // reason is stored as the punch's note, which the punch_records_history
  // trigger (0053) copies into the punch's history.
  if (typeof note !== "string" || !note.trim())
    return NextResponse.json({ error: "A reason is required for manual corrections" }, { status: 400 });
  const reason = note.trim();

  // Determine target employee
  let targetEmployeeId: number;
  let targetEmployeeName: string | null = null;
  if (isManager) {
    if (!employeeId) return NextResponse.json({ error: "employeeId required for manager corrections" }, { status: 400 });
    targetEmployeeId = employeeId;
    const { data: empData } = await supabase
      .from("employees")
      .select("name")
      .eq("org_id", orgId)
      .eq("id", employeeId)
      .maybeSingle();
    targetEmployeeName = empData?.name ?? null;
  } else {
    const { employeeId: ctxEmployeeId } = ctx!;
    if (!ctxEmployeeId) return NextResponse.json({ error: "No employee record" }, { status: 403 });
    targetEmployeeId = ctxEmployeeId;
    const { data: empData } = await supabase
      .from("employees")
      .select("name")
      .eq("org_id", orgId)
      .eq("id", ctxEmployeeId)
      .maybeSingle();
    targetEmployeeName = empData?.name ?? null;
  }

  // A missed clock-out (or break punch) typed on the open shift's own date but
  // earlier than its clock-in means the next morning — an overnight shift
  // (lib/manual-punch-time.ts). Applies to an employee's request and a
  // manager's new punch alike; an absolute punchedAt or an edit of an existing
  // punch is taken as given.
  if (usesLocalTime && id == null && punchType !== "clock_in") {
    const { data: open } = await supabase
      .from("punch_records")
      .select("punch_type, punched_at")
      .eq("org_id", orgId)
      .eq("employee_id", targetEmployeeId)
      .gte("punched_at", zonedTimeToUtc(localDate, 0, tz).toISOString())
      .lt("punched_at", zonedTimeToUtc(addDaysToKey(localDate, 1), 0, tz).toISOString())
      .order("punched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    punchedAtIso = resolveManualPunchTime(
      punchType, localDate, parseHHMM(localTime)!, tz,
      open ? { punchType: open.punch_type, punchedAt: open.punched_at } : null,
      now,
    ).toISOString();
  }

  // Employees don't write punches directly: their correction is filed for a
  // manager to approve (see /api/punch-corrections), and only approval creates
  // the punch. It must still be a valid next step from their previous punch
  // and may only be slotted in before an existing punch to close a previous
  // shift left open (lib/manual-punch-rules.ts).
  if (!isManager) {
    const ruleError = await checkManualPunchAgainstHistory(supabase, orgId, targetEmployeeId, punchType, punchedAtIso, { tz });
    if (ruleError) return NextResponse.json({ error: ruleError }, { status: 409 });

    const { data: request, error: requestError } = await supabase
      .from("punch_corrections")
      .insert(withOrg(orgId, {
        employee_id:  targetEmployeeId,
        punch_type:   punchType,
        punched_at:   punchedAtIso,
        note:         reason,
        requested_by: user.id,
      }))
      .select("id")
      .single();
    if (requestError || !request) {
      console.error("[api/punches]", requestError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    notifyManagers(
      orgId,
      "punch_correction_requested",
      "Punch Correction Request",
      `${targetEmployeeName ?? "An employee"} asked to add a ${punchType.replace("_", " ")} at ${formatTimeInTz(punchedAtIso, tz)} on ${formatDateKey(dateKeyInTz(punchedAtIso, tz), { weekday: "short", month: "short", day: "numeric" })}`,
      { correctionId: request.id, employeeId: targetEmployeeId }
    ).catch(() => {});

    writeAuditLog({
      action:       "punch.correction_requested",
      orgId,
      actorId:      user.id,
      resourceType: "punch_correction",
      resourceId:   String(request.id),
      after: { employeeId: targetEmployeeId, punchType, punchedAt: punchedAtIso, note: reason },
      metadata: { employeeId: targetEmployeeId, employeeName: targetEmployeeName, punchType, punchedAt: punchedAtIso },
    }).catch(() => {});

    return NextResponse.json({ ok: true, pending: true, correctionId: request.id }, { status: 202 });
  }

  // For an edit, capture the original so the audit trail keeps the time being
  // replaced (the row itself is overwritten).
  let before: Record<string, unknown> | null = null;
  if (id != null) {
    const { data: existing } = await supabase
      .from("punch_records")
      .select("punch_type, punched_at, note, is_manual")
      .eq("org_id", orgId)
      .eq("id", id)
      .eq("employee_id", targetEmployeeId)
      .maybeSingle();
    if (!existing)
      return NextResponse.json({ error: "Punch not found" }, { status: 404 });
    before = {
      employeeId: targetEmployeeId,
      punchType:  existing.punch_type,
      punchedAt:  existing.punched_at,
      note:       existing.note ?? null,
      isManual:   existing.is_manual,
    };
  }

  // A manager's manual punch may name a shift only if it is the target
  // employee's own and falls on the punch's store day (or the day either side).
  if (id == null && scheduleId != null) {
    const sched = await loadOwnSchedule(supabase, orgId, targetEmployeeId, scheduleId);
    if (!sched || !isShiftNearPunch(sched, punchedAtIso, tz))
      return NextResponse.json({ error: "That shift doesn't belong to this employee on that day" }, { status: 422 });
  }

  if (id != null) {
    // Update existing punch
    const { error: updateError } = await supabase
      .from("punch_records")
      .update({ punch_type: punchType, punched_at: punchedAtIso, note: reason, is_manual: true })
      .eq("org_id", orgId)
      .eq("id", id)
      .eq("employee_id", targetEmployeeId);
    if (updateError) {
      console.error("[api/punches]", updateError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  } else {
    // Insert a new manual punch
    const { error: insertError } = await supabase
      .from("punch_records")
      .insert(withOrg(orgId, {
        employee_id: targetEmployeeId,
        schedule_id: scheduleId ?? null,
        punch_type:  punchType,
        punched_at:  punchedAtIso,
        is_manual:   true,
        note:        reason,
      }));
    if (insertError) {
      console.error("[api/punches]", insertError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  // Awaited so a failed write is logged against this request. It doesn't fail
  // the request: the punch is already saved, and the database's own
  // punch_record_history row (0053) is the guaranteed record of the change.
  const audited = await writeAuditLog({
    action:       "punch.correction",
    orgId,
    actorId:      user.id,
    resourceType: "punch_record",
    resourceId:   id != null ? String(id) : null,
    before,
    after: { employeeId: targetEmployeeId, punchType, punchedAt: punchedAtIso, note: reason },
    metadata: {
      employeeId:   targetEmployeeId,
      employeeName: targetEmployeeName,
      punchType,
      punchedAt:    punchedAtIso,
      isUpdate:     id != null,
      byManager:    isManager,
    },
  });
  if (!audited)
    console.error(`[api/punches] audit log NOT written for ${id != null ? `edit of punch ${id}` : "manual punch"} by ${user.id} in org ${orgId}`);

  return NextResponse.json({ ok: true });
}
