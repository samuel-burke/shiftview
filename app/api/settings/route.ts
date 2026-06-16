import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { getOrgContext } from "@/lib/org-context";
import { withOrgAll } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { parsePunchPolicy, punchPolicyRows } from "@/lib/punch-policy";

export const dynamic = "force-dynamic";

export async function GET(request?: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);

  if (error === "Not authenticated") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (error === "No organization membership") {
    return NextResponse.json({ error: "No organization membership" }, { status: 403 });
  }

  const { orgId } = ctx!;

  const { data, error: dbError } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId);

  if (dbError) {
    console.error("[api/settings]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return NextResponse.json({
    firstDayOfWeek:       parseInt(map.first_day_of_week  ?? "6"),
    coverageAlertsEnabled: map.coverage_alerts_enabled !== "false",
    timezone:             map.timezone ?? "America/New_York",
    emailNotifications:   map.email_notifications === "true",
    manualPunchesEnabled: map.manual_punches_enabled !== "false",
    gpsRequired:          map.gps_required === "true",
    geofenceEnabled:      map.geofence_enabled === "true",
    geofenceLat:          map.geofence_lat ? parseFloat(map.geofence_lat) : null,
    geofenceLng:          map.geofence_lng ? parseFloat(map.geofence_lng) : null,
    geofenceRadius:       parseInt(map.geofence_radius ?? "100"),
    geofenceAddress:      map.geofence_address || null,
    punchPolicy:          parsePunchPolicy(map),
  });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const supabase = await createClient();

  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const rows: { key: string; value: string }[] = [];

  if (body.firstDayOfWeek !== undefined) {
    const v = Number(body.firstDayOfWeek);
    if (!Number.isInteger(v) || v < 0 || v > 6)
      return NextResponse.json({ error: "firstDayOfWeek must be 0–6" }, { status: 400 });
    rows.push({ key: "first_day_of_week", value: String(v) });
  }

  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !body.timezone.trim())
      return NextResponse.json({ error: "timezone must be a non-empty string" }, { status: 400 });
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: body.timezone.trim() });
    } catch {
      return NextResponse.json({ error: "timezone is not a valid IANA timezone identifier" }, { status: 422 });
    }
    rows.push({ key: "timezone", value: body.timezone.trim() });
  }

  if (body.coverageAlertsEnabled !== undefined) {
    if (typeof body.coverageAlertsEnabled !== "boolean")
      return NextResponse.json({ error: "coverageAlertsEnabled must be a boolean" }, { status: 400 });
    rows.push({ key: "coverage_alerts_enabled", value: String(body.coverageAlertsEnabled) });
  }

  if (body.emailNotifications !== undefined) {
    if (typeof body.emailNotifications !== "boolean")
      return NextResponse.json({ error: "emailNotifications must be a boolean" }, { status: 400 });
    rows.push({ key: "email_notifications", value: String(body.emailNotifications) });
  }

  if (body.manualPunchesEnabled !== undefined) {
    if (typeof body.manualPunchesEnabled !== "boolean")
      return NextResponse.json({ error: "manualPunchesEnabled must be a boolean" }, { status: 400 });
    rows.push({ key: "manual_punches_enabled", value: String(body.manualPunchesEnabled) });
  }

  if (body.gpsRequired !== undefined) {
    if (typeof body.gpsRequired !== "boolean")
      return NextResponse.json({ error: "gpsRequired must be a boolean" }, { status: 400 });
    rows.push({ key: "gps_required", value: String(body.gpsRequired) });
  }

  if (body.geofenceEnabled !== undefined) {
    if (typeof body.geofenceEnabled !== "boolean")
      return NextResponse.json({ error: "geofenceEnabled must be a boolean" }, { status: 400 });
    rows.push({ key: "geofence_enabled", value: String(body.geofenceEnabled) });
  }

  if (body.geofenceLat !== undefined) {
    if (body.geofenceLat !== null && (typeof body.geofenceLat !== "number" || isNaN(body.geofenceLat)))
      return NextResponse.json({ error: "geofenceLat must be a number or null" }, { status: 400 });
    rows.push({ key: "geofence_lat", value: body.geofenceLat == null ? "" : String(body.geofenceLat) });
  }

  if (body.geofenceLng !== undefined) {
    if (body.geofenceLng !== null && (typeof body.geofenceLng !== "number" || isNaN(body.geofenceLng)))
      return NextResponse.json({ error: "geofenceLng must be a number or null" }, { status: 400 });
    rows.push({ key: "geofence_lng", value: body.geofenceLng == null ? "" : String(body.geofenceLng) });
  }

  if (body.geofenceRadius !== undefined) {
    const v = Number(body.geofenceRadius);
    if (!Number.isInteger(v) || v < 50 || v > 50000)
      return NextResponse.json({ error: "geofenceRadius must be 50–50000 meters" }, { status: 400 });
    rows.push({ key: "geofence_radius", value: String(v) });
  }

  if (body.geofenceAddress !== undefined) {
    if (body.geofenceAddress !== null && typeof body.geofenceAddress !== "string")
      return NextResponse.json({ error: "geofenceAddress must be a string or null" }, { status: 400 });
    rows.push({ key: "geofence_address", value: body.geofenceAddress ?? "" });
  }

  // Punch-violation policy — a nested object of booleans/integers. Validated and
  // converted to individual app_settings rows by punchPolicyRows.
  if (body.punchPolicy !== undefined) {
    if (typeof body.punchPolicy !== "object" || body.punchPolicy === null)
      return NextResponse.json({ error: "punchPolicy must be an object" }, { status: 400 });
    const { rows: policyRows, error: policyError } = punchPolicyRows(body.punchPolicy);
    if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
    rows.push(...policyRows);
  }

  if (rows.length === 0)
    return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });

  const { error } = await supabase
    .from("app_settings")
    .upsert(withOrgAll(orgId!, rows));

  if (error) {
    console.error("[api/settings]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "settings.update",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "app_settings",
    after:        Object.fromEntries(rows.map((r) => [r.key, r.value])),
    metadata: {
      changedKeys: rows.map((r) => r.key),
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
