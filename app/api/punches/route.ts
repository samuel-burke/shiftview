import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { notifyManagers } from "@/lib/notify";
import { fmtMinutes } from "@/data/types";
import { writeAuditLog } from "@/lib/audit";
import { haversineMeters } from "@/lib/haversine";
import { dateKeyInTz, formatDateKey, formatTimeInTz, isDateKey, localDayBoundsUtc, minutesFromScheduled, parseHHMM, resolveTimezone, zonedTimeToUtc } from "@/lib/dates";
import { parsePunchPolicy } from "@/lib/punch-policy";
import { checkManualPunchAgainstHistory } from "@/lib/manual-punch-rules";
import { loadCurrentShift } from "@/lib/current-shift-server";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    .select("*")
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

  return NextResponse.json((data ?? []).map(mapRow));
}

// POST /api/punches — employee clocks a punch
// Body: { punchType, scheduleId?, lat?, lng? }
export async function POST(request: Request) {
  const body = await request.json();
  const { punchType, scheduleId, lat, lng } = body;

  const VALID_TYPES = ["clock_in", "clock_out", "break_start", "break_end"];
  if (!punchType || !VALID_TYPES.includes(punchType))
    return NextResponse.json({ error: "punchType must be one of: " + VALID_TYPES.join(", ") }, { status: 400 });

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


  // Server-side geofence enforcement for clock_in
  if (punchType === "clock_in") {
    const gpsRequired    = settingsMap.gps_required === "true";
    const geofenceEnabled = settingsMap.geofence_enabled === "true";
    if (gpsRequired && geofenceEnabled) {
      const geofenceLat = settingsMap.geofence_lat ? parseFloat(settingsMap.geofence_lat) : null;
      const geofenceLng = settingsMap.geofence_lng ? parseFloat(settingsMap.geofence_lng) : null;
      const geofenceRadius = parseInt(settingsMap.geofence_radius ?? "100");
      if (geofenceLat !== null && geofenceLng !== null && !isNaN(geofenceLat) && !isNaN(geofenceLng)) {
        if (lat == null || lng == null) {
          return NextResponse.json(
            { error: "GPS location required — geofence enforcement is active" },
            { status: 422 }
          );
        }
        const dist = haversineMeters(lat, lng, geofenceLat, geofenceLng);
        if (dist > geofenceRadius) {
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
      schedule_id: scheduleId ?? null,
      punch_type:  punchType,
      lat:         lat ?? null,
      lng:         lng ?? null,
    }))
    .select()
    .single();

  if (insertError) {
    console.error("[api/punches]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Check for late clock-in and alert managers
  if (punchType === "clock_in" && scheduleId) {
    const { data: sched } = await supabase
      .from("schedules")
      .select("start_minutes, date, employee_id")
      .eq("org_id", orgId)
      .eq("id", scheduleId)
      .maybeSingle();
    if (sched) {
      const lateMinutes = minutesFromScheduled(data.punched_at, sched.date, sched.start_minutes, tz);
      if (lateMinutes > 5) {
        notifyManagers(
          supabase,
          orgId,
          "late_clock_in",
          "Late Clock-In",
          `${emp.name ?? "An employee"} clocked in ${lateMinutes}m late (scheduled ${fmtMinutes(sched.start_minutes)})`,
          { employeeId: sched.employee_id, scheduleId, lateMinutes }
        ).catch(() => {});
      }
    }
  }

  writeAuditLog({
    action:       `punch.${punchType}`,
    orgId,
    actorId:      user.id,
    resourceType: "punch_record",
    resourceId:   String(data.id),
    after: { employeeId: emp.id, punchType, scheduleId: scheduleId ?? null },
    metadata: {
      employeeId:   emp.id,
      employeeName: emp.name,
      punchType,
      punchedAt:    data.punched_at,
      lat:          lat ?? null,
      lng:          lng ?? null,
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
  const body = await request.json();
  const { id, employeeId, punchType, punchedAt, localDate, localTime, note, scheduleId } = body;

  const VALID_TYPES = ["clock_in", "clock_out", "break_start", "break_end"];

  if (!punchType || !VALID_TYPES.includes(punchType))
    return NextResponse.json({ error: "punchType required" }, { status: 400 });

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
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  if (ts.getTime() > now || ts.getTime() < now - thirtyDaysMs)
    return NextResponse.json({ error: "The punch time must be within the last 30 days and not in the future" }, { status: 400 });
  const punchedAtIso = ts.toISOString();

  // Employees may only *add* a missing punch — never rewrite an existing one,
  // which would let them move a real, server-stamped punch.
  if (!isManager && id != null)
    return NextResponse.json({ error: "Only managers can edit existing punches" }, { status: 403 });
  if (!isManager && (typeof note !== "string" || !note.trim()))
    return NextResponse.json({ error: "A note is required for manual corrections" }, { status: 400 });

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

  // Employees don't write punches directly: their correction is filed for a
  // manager to approve (see /api/punch-corrections), and only approval creates
  // the punch. It must still be a valid next step from their previous punch
  // and may only be slotted in before an existing punch to close a previous
  // shift left open (lib/manual-punch-rules.ts).
  if (!isManager) {
    const ruleError = await checkManualPunchAgainstHistory(supabase, orgId, targetEmployeeId, punchType, punchedAtIso);
    if (ruleError) return NextResponse.json({ error: ruleError }, { status: 409 });

    const { data: request, error: requestError } = await supabase
      .from("punch_corrections")
      .insert(withOrg(orgId, {
        employee_id:  targetEmployeeId,
        punch_type:   punchType,
        punched_at:   punchedAtIso,
        note:         note.trim(),
        requested_by: user.id,
      }))
      .select("id")
      .single();
    if (requestError || !request) {
      console.error("[api/punches]", requestError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    notifyManagers(
      supabase,
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
      after: { employeeId: targetEmployeeId, punchType, punchedAt: punchedAtIso, note: note.trim() },
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

  if (id != null) {
    // Update existing punch
    const { error: updateError } = await supabase
      .from("punch_records")
      .update({ punch_type: punchType, punched_at: punchedAtIso, note: note ?? null, is_manual: true })
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
        note:        note ?? null,
      }));
    if (insertError) {
      console.error("[api/punches]", insertError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  writeAuditLog({
    action:       "punch.correction",
    orgId,
    actorId:      user.id,
    resourceType: "punch_record",
    resourceId:   id != null ? String(id) : null,
    before,
    after: { employeeId: targetEmployeeId, punchType, punchedAt: punchedAtIso, note: note ?? null },
    metadata: {
      employeeId:   targetEmployeeId,
      employeeName: targetEmployeeName,
      punchType,
      punchedAt:    punchedAtIso,
      isUpdate:     id != null,
      byManager:    isManager,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
