import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { notifyManagers } from "@/lib/notify";
import { fmtMinutes } from "@/data/types";
import { writeAuditLog } from "@/lib/audit";
import { haversineMeters } from "@/lib/haversine";
import { getLocalMinutes, localDayBoundsUtc, todayKeyInTz } from "@/lib/punch-date-utils";

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
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json([]);

  // Resolve store timezone so the day window is in local time, not UTC.
  const { data: settingsData } = await supabase.from("app_settings").select("key, value");
  const settingsMap = Object.fromEntries(
    (settingsData ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
  const tz = settingsMap.timezone ?? "America/New_York";
  const { start: dayStart, end: dayEnd } = localDayBoundsUtc(date, tz);

  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let query = supabase
    .from("punch_records")
    .select("*")
    .gte("punched_at", dayStart.toISOString())
    .lte("punched_at", dayEnd.toISOString())
    .order("punched_at");

  if (!managerRow) {
    // Scope to employee's own records
    const { data: emp } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!emp) return NextResponse.json([]);
    query = query.eq("employee_id", emp.id);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[api/punches]", error);
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
  const { data: { user } } = await supabase.auth.getUser();

  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!emp)
    return NextResponse.json({ error: "No employee record linked to this account" }, { status: 403 });

  // Fetch settings up front — needed for timezone (day-scoped state machine),
  // geofence enforcement, and late clock-in notifications.
  const { data: settingsData } = await supabase.from("app_settings").select("key, value");
  const settingsMap = Object.fromEntries(
    (settingsData ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
  const tz = settingsMap.timezone ?? "America/New_York";

  // Day-scoped state machine: only consider today's punches (local timezone).
  // This prevents a missed clock-out from a previous day from blocking today's clock-in.
  const todayKey = todayKeyInTz(tz);
  const { start: todayStart, end: todayEnd } = localDayBoundsUtc(todayKey, tz);

  const { data: todayLastPunch, error: todayPunchError } = await supabase
    .from("punch_records")
    .select("punch_type, punched_at")
    .eq("employee_id", emp.id)
    .gte("punched_at", todayStart.toISOString())
    .lte("punched_at", todayEnd.toISOString())
    .order("punched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (todayPunchError) {
    console.error("[api/punches]", todayPunchError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const lastType = todayLastPunch?.punch_type ?? null;

  const VALID_TRANSITIONS: Record<string, (string | null)[]> = {
    clock_in:    [null, "clock_out"],
    clock_out:   ["clock_in", "break_end"],
    break_start: ["clock_in", "break_end"],
    break_end:   ["break_start"],
  };

  if (!VALID_TRANSITIONS[punchType].includes(lastType)) {
    const msg = lastType
      ? `Cannot ${punchType}: current state is ${lastType}`
      : `Cannot ${punchType}: no active clock-in`;
    return NextResponse.json({ error: msg }, { status: 409 });
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

  const { data, error } = await supabase
    .from("punch_records")
    .insert({
      employee_id: emp.id,
      schedule_id: scheduleId ?? null,
      punch_type:  punchType,
      lat:         lat ?? null,
      lng:         lng ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error("[api/punches]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Check for late clock-in and alert managers
  if (punchType === "clock_in" && scheduleId) {
    const { data: sched } = await supabase
      .from("schedules")
      .select("start_minutes, date, employee_id")
      .eq("id", scheduleId)
      .maybeSingle();
    if (sched) {
      const punchedAt = new Date(data.punched_at);
      const clockInMinutes = getLocalMinutes(punchedAt, tz);
      const lateMinutes = clockInMinutes - sched.start_minutes;
      if (lateMinutes > 5) {
        notifyManagers(
          supabase,
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
// Managers can correct any; employees can only add a manual punch for themselves.
// Body: { id?, employeeId?, punchType, punchedAt, note, scheduleId? }
export async function PUT(request: Request) {
  const body = await request.json();
  const { id, employeeId, punchType, punchedAt, note, scheduleId } = body;

  const VALID_TYPES = ["clock_in", "clock_out", "break_start", "break_end"];

  if (!punchType || !VALID_TYPES.includes(punchType))
    return NextResponse.json({ error: "punchType required" }, { status: 400 });
  if (!punchedAt)
    return NextResponse.json({ error: "punchedAt required" }, { status: 400 });

  const ts = new Date(punchedAt);
  if (isNaN(ts.getTime()))
    return NextResponse.json({ error: "punchedAt must be a valid ISO timestamp" }, { status: 400 });
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  if (ts.getTime() > now || ts.getTime() < now - thirtyDaysMs)
    return NextResponse.json({ error: "punchedAt must be within the last 30 days and not in the future" }, { status: 400 });

  const supabase = await createClient();

  // Check if manual punch corrections are enabled
  const { data: settingsData } = await supabase.from("app_settings").select("key, value");
  const settingsMap = Object.fromEntries(
    (settingsData ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
  if (settingsMap.manual_punches_enabled === "false") {
    return NextResponse.json({ error: "Manual punch corrections are disabled" }, { status: 403 });
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Determine target employee
  let targetEmployeeId: number;
  let targetEmployeeName: string | null = null;
  if (managerRow) {
    if (!employeeId) return NextResponse.json({ error: "employeeId required for manager corrections" }, { status: 400 });
    targetEmployeeId = employeeId;
    const { data: empData } = await supabase
      .from("employees")
      .select("name")
      .eq("id", employeeId)
      .maybeSingle();
    targetEmployeeName = empData?.name ?? null;
  } else {
    const { data: emp } = await supabase
      .from("employees")
      .select("id, name")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!emp) return NextResponse.json({ error: "No employee record" }, { status: 403 });
    targetEmployeeId = emp.id;
    targetEmployeeName = emp.name;
  }

  if (id != null) {
    // Update existing punch
    const { error } = await supabase
      .from("punch_records")
      .update({ punch_type: punchType, punched_at: punchedAt, note: note ?? null, is_manual: true })
      .eq("id", id)
      .eq("employee_id", targetEmployeeId);
    if (error) {
      console.error("[api/punches]", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  } else {
    // Insert a new manual punch
    const { error } = await supabase
      .from("punch_records")
      .insert({
        employee_id: targetEmployeeId,
        schedule_id: scheduleId ?? null,
        punch_type:  punchType,
        punched_at:  punchedAt,
        is_manual:   true,
        note:        note ?? null,
      });
    if (error) {
      console.error("[api/punches]", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  writeAuditLog({
    action:       "punch.correction",
    actorId:      user.id,
    resourceType: "punch_record",
    resourceId:   id != null ? String(id) : null,
    after: { employeeId: targetEmployeeId, punchType, punchedAt, note: note ?? null },
    metadata: {
      employeeId:   targetEmployeeId,
      employeeName: targetEmployeeName,
      punchType,
      punchedAt,
      isUpdate:     id != null,
      byManager:    !!managerRow,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
