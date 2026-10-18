import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/require-manager";
import { getOrgContext } from "@/lib/org-context";
import { isDemoOrgId } from "@/lib/demo-org";
import { writeAuditLog } from "@/lib/audit";
import { validateEmployeeSchedulingPatch } from "@/lib/scheduling-rules";
import { loadPayRates, loadPayrollIds } from "@/lib/pay-rates";

export const dynamic = "force-dynamic";

function sortByName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const parts = (n: string) => {
      const p = n.trim().split(/\s+/);
      return { last: p.length > 1 ? p[p.length - 1] : p[0], first: p[0] };
    };
    const pa = parts(a.name);
    const pb = parts(b.name);
    return pa.last.localeCompare(pb.last) || pa.first.localeCompare(pb.first);
  });
}

// archived_at: null for active employees (migration 0054).
const BASE_COLUMNS = "id, name, email, user_id, archived_at";
// Employment type and weekly limits (migration 0034).
const SCHEDULING_COLUMNS = "employment_type, min_weekly_hours, max_weekly_hours, max_days_per_week";
// Postgres "undefined column": the database predates migration 0034.
const UNDEFINED_COLUMN = "42703";
// Postgres foreign_key_violation.
const FOREIGN_KEY_VIOLATION = "23503";
const PAYROLL_ID_MAX = 40;
const SCHEDULING_FIELDS = ["employmentType", "minWeeklyHours", "maxWeeklyHours", "maxDaysPerWeek"];

// numeric columns can arrive as strings; hours are plain numbers in the API.
function normalizeHours<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of ["min_weekly_hours", "max_weekly_hours"]) {
    if (out[key] != null) out[key] = Number(out[key]);
  }
  return out as T;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);

  if (error === "Not authenticated") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (error) {
    return NextResponse.json({ error: "No organization membership" }, { status: 403 });
  }

  // The roster is active employees: everything that schedules, clocks or
  // counts people uses it. Managers ask for archived ones too
  // (?include=archived) for reports over past periods and to restore someone.
  const includeArchived = ctx!.isManager && new URL(request.url).searchParams.get("include") === "archived";
  const roster = (columns: string) => {
    const q = supabase.from("employees").select(columns).eq("org_id", ctx!.orgId);
    return includeArchived ? q : q.is("archived_at", null);
  };

  const full = await roster(`${BASE_COLUMNS}, ${SCHEDULING_COLUMNS}`);
  let data = full.data as ({ name: string } & Record<string, unknown>)[] | null;
  let dbError = full.error;
  // Keep the roster working if this deploy lands before its migration does.
  if (dbError?.code === UNDEFINED_COLUMN) {
    const base = await roster(BASE_COLUMNS);
    data = base.data as ({ name: string } & Record<string, unknown>)[] | null;
    dbError = base.error;
  }
  if (dbError) {
    console.error("[api/employees]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const rows = (data ?? []).map(normalizeHours);
  if (!ctx!.isManager) return NextResponse.json(sortByName(rows));

  // Pay rates and payroll IDs are for managers (labor cost, payroll export);
  // coworkers get the roster without them.
  const [{ rates, error: rateError }, { ids: payrollIds, error: payrollIdError }] = await Promise.all([
    loadPayRates(supabase, ctx!.orgId),
    loadPayrollIds(supabase, ctx!.orgId),
  ]);
  if (rateError) {
    console.error("[api/employees] pay rates", rateError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  // Before migration 0061 there are no payroll IDs: the roster goes out without them.
  if (payrollIdError) console.error("[api/employees] payroll ids", payrollIdError);
  return NextResponse.json(sortByName(rows.map((r) => ({
    ...r,
    pay_rate: rates.get(Number(r.id)) ?? null,
    payroll_id: payrollIds.get(Number(r.id)) ?? null,
  }))));
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const { id, userId, name, payRate, archived, payrollId } = body;

  if (id == null)
    return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });
  if (userId !== undefined && userId !== null && typeof userId !== "string")
    return NextResponse.json(
      { error: "userId must be a string (UUID) or null to unlink" },
      { status: 400 }
    );
  // Archiving goes through DELETE, which also clears their future shifts.
  if (archived !== undefined && archived !== false)
    return NextResponse.json(
      { error: "archived can only be false (to restore); use DELETE to archive" },
      { status: 400 }
    );
  if (name !== undefined && (typeof name !== "string" || !name.trim()))
    return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
  if (
    payRate !== undefined &&
    payRate !== null &&
    (typeof payRate !== "number" || !Number.isFinite(payRate) || payRate < 0)
  )
    return NextResponse.json(
      { error: "payRate must be a non-negative number or null to clear" },
      { status: 400 }
    );
  // The employee's ID in the payroll provider (migration 0061). Blank clears it.
  if (
    payrollId !== undefined &&
    payrollId !== null &&
    (typeof payrollId !== "string" || payrollId.trim().length > PAYROLL_ID_MAX || /[\t\r\n]/.test(payrollId))
  )
    return NextResponse.json(
      { error: `payrollId must be text of at most ${PAYROLL_ID_MAX} characters on one line, or null to clear` },
      { status: 400 }
    );

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  // A manager may unlink a row or claim it for themselves, never attach
  // someone else's account: that would make the person a member of this org
  // without their say. The database enforces the same rule (migration 0035).
  if (typeof userId === "string" && userId !== user!.id)
    return NextResponse.json(
      { error: "You can only link an employee record to your own account" },
      { status: 403 }
    );

  const { data: before } = await supabase
    .from("employees")
    .select("id, name, email, user_id, archived_at")
    .eq("org_id", orgId!)
    .eq("id", id)
    .maybeSingle();

  const updates: Record<string, unknown> = {};
  // Restore: they are a member again, with the account and history they had.
  if (archived === false) updates.archived_at = null;
  if (userId !== undefined) updates.user_id = userId;
  if (name !== undefined) updates.name = name.trim();
  // Writing pay_rate adds a rate effective today to the history (0061); a
  // dated change goes through /api/employees/[id]/pay-rates.
  if (payRate !== undefined) updates.pay_rate = payRate;
  if (payrollId !== undefined)
    updates.payroll_id = typeof payrollId === "string" && payrollId.trim() ? payrollId.trim() : null;

  // Employment type and weekly limits. A one-sided min/max change is checked
  // against the stored other end, so the range can't invert.
  if (SCHEDULING_FIELDS.some((f) => body[f] !== undefined)) {
    const { data: stored } = await supabase
      .from("employees")
      .select("min_weekly_hours, max_weekly_hours")
      .eq("org_id", orgId!)
      .eq("id", id)
      .maybeSingle();
    const scheduling = validateEmployeeSchedulingPatch(body, {
      minWeeklyHours: stored?.min_weekly_hours == null ? null : Number(stored.min_weekly_hours),
      maxWeeklyHours: stored?.max_weekly_hours == null ? null : Number(stored.max_weekly_hours),
    });
    if (scheduling.error !== null)
      return NextResponse.json({ error: scheduling.error }, { status: 400 });
    Object.assign(updates, scheduling.updates);
  }

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  const { error } = await supabase
    .from("employees")
    .update(updates)
    .eq("org_id", orgId!)
    .eq("id", id);

  if (error) {
    console.error("[api/employees]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const restored = archived === false && before?.archived_at != null;
  writeAuditLog({
    action:       restored ? "employee.restore" : "employee.update",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "employee",
    resourceId:   String(id),
    before:       before ? { name: before.name, email: before.email, userId: before.user_id } : null,
    after:        updates,
    metadata: {
      employeeId:   id,
      employeeName: before?.name ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { id } = await request.json();

  if (id == null)
    return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  // Fetch the employee first to get their linked auth user_id
  const { data: employee } = await supabase
    .from("employees")
    .select("id, user_id, name, email")
    .eq("org_id", orgId!)
    .eq("id", id)
    .maybeSingle();

  if (!employee)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  if (employee.user_id && employee.user_id === user?.id)
    return NextResponse.json({ error: "You cannot remove yourself" }, { status: 403 });

  // Removing a linked employee also removes their manager role, so it follows
  // the owner policy: the owner can never be removed, and in owned orgs only
  // the owner may remove another manager. employee_remove checks the same.
  if (employee.user_id) {
    const { data: ownerRow } = await supabase
      .from("managers")
      .select("user_id")
      .eq("org_id", orgId!)
      .eq("is_owner", true)
      .maybeSingle();
    if (ownerRow?.user_id === employee.user_id)
      return NextResponse.json({ error: "The organization owner cannot be removed" }, { status: 403 });
    if (ownerRow && ownerRow.user_id !== user?.id) {
      const { data: targetManager } = await supabase
        .from("managers")
        .select("user_id")
        .eq("org_id", orgId!)
        .eq("user_id", employee.user_id)
        .maybeSingle();
      if (targetManager)
        return NextResponse.json(
          { error: "Only the organization owner can remove a manager" },
          { status: 403 }
        );
    }
  }

  // Removing someone archives them (migration 0054): their punches, time off
  // and past shifts are time records we must keep, so the row stays, with
  // archived_at set, and their shifts that haven't started are removed. Only
  // an employee with no history at all (a mistaken add) is deleted outright.
  // employee_remove does either in one transaction and also removes their
  // manager role.
  const { data: outcome, error } = await supabase.rpc("employee_remove", { p_org: orgId!, p_employee: id });

  if (error?.code === "P0002")
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  if (error?.code === "42501")
    return NextResponse.json({ error: error.message || "Permission denied" }, { status: 403 });
  // A punch landed between the history check and the delete.
  if (error?.code === FOREIGN_KEY_VIOLATION)
    return NextResponse.json({ error: "This employee just got a time record. Try again to archive them." }, { status: 409 });
  if (error) {
    console.error("[api/employees]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (outcome !== "deleted") {
    if (outcome === "archived")
      writeAuditLog({
        action:       "employee.archive",
        orgId:        orgId!,
        actorId:      user?.id,
        resourceType: "employee",
        resourceId:   String(id),
        before:       { name: employee.name, email: employee.email, userId: employee.user_id },
        metadata:     { employeeId: id, employeeName: employee.name, email: employee.email },
      }).catch(() => {});
    // Their account stays: it is linked to the archived row so a restore gives
    // the same person their history back, and it has no access meanwhile.
    return NextResponse.json({ ok: true, archived: true });
  }

  // Deleted outright (no history); their manager role went with the row.
  // Their account is shared by every organization they belong to, so it is
  // deleted only when this was their last membership. In the demo org the
  // linked user is another visitor in the middle of a session: leave them be;
  // the nightly reset removes demo accounts.
  if (employee.user_id && !isDemoOrgId(orgId!)) {
    const admin = createAdminClient();
    const [managerRows, employeeRows] = await Promise.all([
      admin.from("managers").select("org_id", { count: "exact", head: true }).eq("user_id", employee.user_id),
      admin.from("employees").select("id", { count: "exact", head: true }).eq("user_id", employee.user_id),
    ]);
    const lastMembership =
      !managerRows.error && !employeeRows.error && managerRows.count === 0 && employeeRows.count === 0;
    if (lastMembership) await admin.auth.admin.deleteUser(employee.user_id);
  }

  writeAuditLog({
    action:       "employee.delete",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "employee",
    resourceId:   String(id),
    before: {
      name:   employee.name,
      email:  employee.email,
      userId: employee.user_id,
    },
    metadata: {
      employeeId:   id,
      employeeName: employee.name,
      email:        employee.email,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, archived: false });
}
