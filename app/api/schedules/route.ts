import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { validateShiftMinutes } from "./validation";
import { requireManager } from "@/lib/require-manager";
import { getOrgContext } from "@/lib/org-context";
import { notify } from "@/lib/notify";
import { sendEmail } from "@/lib/email";
import { fmtMinutes } from "@/data/types";
import { writeAuditLog } from "@/lib/audit";
import { withOrg } from "@/lib/org-scope";
import { isDemoOrgId } from "@/lib/demo-org";
import { getCurveForDate } from "@/lib/coverage-server";
import { findUnderstaffedFromCurves } from "@/lib/coverage";
import { findShiftConflict, findShiftOverlap } from "@/lib/shift-conflicts-server";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) return NextResponse.json({ error: "date param required" }, { status: 400 });
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

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
    .from("schedules")
    .select("*")
    .eq("org_id", orgId)
    .eq("date", date)
    .order("start_minutes");

  if (dbError) {
    console.error("[api/schedules]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const mapped = data.map((s) => ({
    id:           s.id,
    employeeId:   s.employee_id,
    date:         s.date,
    startMinutes: s.start_minutes,
    endMinutes:   s.end_minutes,
  }));

  return NextResponse.json(mapped);
}

export async function PUT(request: Request) {
  const { id, startMinutes, endMinutes, override = false } = await request.json();

  if (id == null || startMinutes == null || endMinutes == null)
    return NextResponse.json({ error: "id, startMinutes, endMinutes required" }, { status: 400 });

  const validationError = validateShiftMinutes(startMinutes, endMinutes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("schedules")
    .select("employee_id, date, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (existing) {
    const dateStr = String(existing.date).slice(0, 10);
    // Never double-book across days (an overnight shift running into the next
    // morning's shift, or vice versa) — not overridable.
    const overlap = await findShiftOverlap(supabase, "schedules", orgId, existing.employee_id, dateStr, startMinutes, endMinutes, id);
    if (overlap) return NextResponse.json({ error: overlap }, { status: 409 });

    // Time off / availability on every day the shift touches (skip if override)
    if (!override) {
      const conflict = await findShiftConflict(supabase, orgId, existing.employee_id, dateStr, startMinutes, endMinutes);
      if (conflict) return NextResponse.json(conflict, { status: 409 });
    }
  }

  const { error } = await supabase
    .from("schedules")
    .update({ start_minutes: startMinutes, end_minutes: endMinutes })
    .eq("org_id", orgId)
    .eq("id", id);

  if (error) {
    console.error("[api/schedules]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Notify the affected employee of their shift change
  if (existing) {
    const { data: emp } = await supabase
      .from("employees")
      .select("user_id, name")
      .eq("org_id", orgId)
      .eq("id", existing.employee_id)
      .maybeSingle();
    if (emp?.user_id) {
      notify(supabase, {
        orgId,
        userId: emp.user_id,
        type: "shift_change",
        title: "Shift Updated",
        body: `Your shift on ${existing.date} has been updated to ${fmtMinutes(startMinutes)} – ${fmtMinutes(endMinutes)}`,
        data: { scheduleId: id, date: existing.date },
      }).catch(() => {});
    }

    writeAuditLog({
      action:       "schedule.update",
      orgId,
      actorId:      user?.id,
      resourceType: "schedule",
      resourceId:   String(id),
      before: {
        startMinutes: existing.start_minutes,
        endMinutes:   existing.end_minutes,
      },
      after: { startMinutes, endMinutes },
      metadata: {
        employeeId:   existing.employee_id,
        employeeName: emp?.name ?? null,
        date:         existing.date,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const { employeeId, date, startMinutes, endMinutes, override = false } = await request.json();

  if (employeeId == null || !date || startMinutes == null || endMinutes == null)
    return NextResponse.json({ error: "employeeId, date, startMinutes, endMinutes required" }, { status: 400 });
  if (!DATE_RE.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const validationError = validateShiftMinutes(startMinutes, endMinutes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("schedules")
    .select("id")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("date", date)
    .maybeSingle();

  if (existing)
    return NextResponse.json({ error: "Employee is already scheduled on this date" }, { status: 409 });

  const overlap = await findShiftOverlap(supabase, "schedules", orgId, employeeId, date, startMinutes, endMinutes);
  if (overlap) return NextResponse.json({ error: overlap }, { status: 409 });

  // Time off / availability on every day the shift touches (skip if override)
  if (!override) {
    const conflict = await findShiftConflict(supabase, orgId, employeeId, date, startMinutes, endMinutes);
    if (conflict) return NextResponse.json(conflict, { status: 409 });
  }

  const { error } = await supabase
    .from("schedules")
    .insert(withOrg(orgId, { employee_id: employeeId, date, start_minutes: startMinutes, end_minutes: endMinutes }));

  if (error) {
    console.error("[api/schedules]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Notify the employee of their new shift
  const { data: emp } = await supabase
    .from("employees")
    .select("user_id, name")
    .eq("org_id", orgId)
    .eq("id", employeeId)
    .maybeSingle();
  if (emp?.user_id) {
    notify(supabase, {
      orgId,
      userId: emp.user_id,
      type: "shift_change",
      title: "New Shift Scheduled",
      body: `You have a new shift on ${date}: ${fmtMinutes(startMinutes)} – ${fmtMinutes(endMinutes)}`,
      data: { date, employeeId },
    }).catch(() => {});
  }

  writeAuditLog({
    action:       "schedule.create",
    orgId,
    actorId:      user?.id,
    resourceType: "schedule",
    after: { employeeId, date, startMinutes, endMinutes },
    metadata: {
      employeeId,
      employeeName: emp?.name ?? null,
      date,
      startMinutes,
      endMinutes,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const { id } = await request.json();

  if (id == null)
    return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  // Fetch the schedule before deletion
  const { data: existing } = await supabase
    .from("schedules")
    .select("id, date, employee_id, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("schedules")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);

  if (error) {
    console.error("[api/schedules]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Check if coverage dropped below the day's target curve and alert managers
  if (existing?.date) {
    const { data: settingsData } = await supabase
      .from("app_settings")
      .select("key, value")
      .eq("org_id", orgId);
    const settingsMap = Object.fromEntries((settingsData ?? []).map((r) => [r.key, r.value]));

    // Coverage alert emails never leave the demo org (visitor-editable
    // settings can't re-enable them).
    if (settingsMap.email_notifications === "true" && !isDemoOrgId(orgId!)) {
      const curve = await getCurveForDate(supabase, orgId!, existing.date);

      const { data: remaining } = await supabase
        .from("schedules")
        .select("date, start_minutes, end_minutes")
        .eq("org_id", orgId)
        .eq("date", existing.date);

      const remainingSpans = (remaining ?? []).map((s) => ({
        date:         existing.date,
        startMinutes: s.start_minutes,
        endMinutes:   s.end_minutes,
      }));
      const understaffed = findUnderstaffedFromCurves(remainingSpans, [existing.date], { [existing.date]: curve });

      if (understaffed.length > 0) {
        const worstShortfall = Math.max(...understaffed.map((u) => u.shortfall));
        const { data: managerRows } = await supabase
          .from("managers")
          .select("user_id")
          .eq("org_id", orgId);
        const managerUserIds = (managerRows ?? []).map((r: { user_id: string }) => r.user_id);

        if (managerUserIds.length > 0) {
          const { data: managerEmployees } = await supabase
            .from("employees")
            .select("email")
            .eq("org_id", orgId)
            .in("user_id", managerUserIds);

          const managerEmails = (managerEmployees ?? [])
            .map((e: { email: string | null }) => e.email)
            .filter((e): e is string => Boolean(e));

          await Promise.allSettled(
            managerEmails.map((email) =>
              sendEmail({
                to: email,
                subject: `Low coverage alert — ${existing.date}`,
                html: `<p>Coverage for <strong>${existing.date}</strong> has fallen below the target coverage curve (short by up to <strong>${worstShortfall}</strong> staff). Please review the schedule.</p><p>— ShiftView</p>`,
              })
            )
          );
        }
      }
    }

    const { data: emp } = await supabase
      .from("employees")
      .select("name")
      .eq("org_id", orgId)
      .eq("id", existing.employee_id)
      .maybeSingle();

    writeAuditLog({
      action:       "schedule.delete",
      orgId,
      actorId:      user?.id,
      resourceType: "schedule",
      resourceId:   String(id),
      before: {
        employeeId:   existing.employee_id,
        date:         existing.date,
        startMinutes: existing.start_minutes,
        endMinutes:   existing.end_minutes,
      },
      metadata: {
        employeeId:   existing.employee_id,
        employeeName: emp?.name ?? null,
        date:         existing.date,
        startMinutes: existing.start_minutes,
        endMinutes:   existing.end_minutes,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
