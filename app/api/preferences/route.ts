import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import {
  emptyPreferences,
  preferencesFromRow,
  validatePreferencesInput,
  type PreferencesRow,
} from "@/lib/preferences";

export const dynamic = "force-dynamic";

const COLUMNS = "employee_id, preferred_shift_types, preferred_days, avoid_days, desired_weekly_hours, note, updated_at";

// GET /api/preferences?employeeId=N — one employee's shift preferences (the
// employee themself or a manager). Without employeeId, managers get every
// employee's saved preferences.
export async function GET(request: Request) {
  const employeeIdParam = new URL(request.url).searchParams.get("employeeId");
  const employeeId = employeeIdParam === null ? null : Number(employeeIdParam);
  if (employeeId !== null && (!Number.isInteger(employeeId) || employeeId <= 0))
    return NextResponse.json({ error: "employeeId must be a positive integer" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error) return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId: ownEmployeeId } = ctx;

  if (employeeId === null) {
    if (!isManager) return NextResponse.json({ error: "Manager access required" }, { status: 403 });
    const { data, error: fetchError } = await supabase
      .from("employee_preferences")
      .select(COLUMNS)
      .eq("org_id", orgId);
    if (fetchError) {
      console.error("[api/preferences]", fetchError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json(((data ?? []) as PreferencesRow[]).map(preferencesFromRow));
  }

  if (!isManager && ownEmployeeId !== employeeId)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error: fetchError } = await supabase
    .from("employee_preferences")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (fetchError) {
    console.error("[api/preferences]", fetchError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(data ? preferencesFromRow(data as PreferencesRow) : emptyPreferences(employeeId));
}

// PUT /api/preferences { employeeId, preferredShiftTypes, preferredDays,
// avoidDays, desiredWeeklyHours, note } — replaces the employee's preferences.
// Employees may set their own; managers anyone's in their org.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { employeeId } = body as { employeeId?: unknown };
  if (!Number.isInteger(employeeId) || (employeeId as number) <= 0)
    return NextResponse.json({ error: "employeeId must be a positive integer" }, { status: 400 });

  const validated = validatePreferencesInput(body as Record<string, unknown>);
  if (validated.error !== null) return NextResponse.json({ error: validated.error }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error) return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, isManager, employeeId: ownEmployeeId } = ctx;
  if (!isManager && ownEmployeeId !== employeeId)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: employee } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", employeeId as number)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { data: saved, error: saveError } = await supabase
    .from("employee_preferences")
    .upsert(
      withOrg(orgId, { employee_id: employeeId, ...validated.values, updated_at: new Date().toISOString() }),
      { onConflict: "org_id,employee_id" }
    )
    .select(COLUMNS)
    .single();
  if (saveError) {
    console.error("[api/preferences]", saveError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "preferences.update",
    orgId,
    actorId:      user.id,
    resourceType: "employee_preferences",
    resourceId:   String(employeeId),
    after:        validated.values,
    metadata: {
      employeeId,
      employeeName: employee.name,
      byManager:    isManager,
    },
  }).catch(() => {});

  return NextResponse.json(preferencesFromRow(saved as PreferencesRow));
}
