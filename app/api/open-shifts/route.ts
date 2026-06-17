import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { notify } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";
import { validateOpenShift, isEmployeeEligible } from "@/lib/open-shifts";

export const dynamic = "force-dynamic";

type ClaimRow = {
  id: number;
  open_shift_id: number;
  employee_id: number;
  status: string;
};

// Shapes an open_shifts row + its claims into the API response object.
function shapeOpenShift(
  row: { id: number; date: string; start_minutes: number; end_minutes: number; note: string | null; status: string; filled_by: number | null },
  claims: ClaimRow[],
  names: Record<number, string>
) {
  return {
    id: row.id,
    date: row.date,
    startMinutes: row.start_minutes,
    endMinutes: row.end_minutes,
    note: row.note ?? null,
    status: row.status,
    filledBy: row.filled_by ?? null,
    filledByName: row.filled_by != null ? names[row.filled_by] ?? null : null,
    claims: claims
      .filter((c) => c.open_shift_id === row.id)
      .map((c) => ({
        id: c.id,
        openShiftId: c.open_shift_id,
        employeeId: c.employee_id,
        employeeName: names[c.employee_id] ?? "Unknown",
        status: c.status,
      })),
  };
}

// GET /api/open-shifts
//   Manager  → every active (open or filled) open shift with all its claims.
//   Employee → open shifts they are eligible to claim, each annotated with the
//              caller's own claim status (if any).
export async function GET(request?: Request) {
  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;
  const today = new Date().toISOString().slice(0, 10);

  // ── Manager view ──────────────────────────────────────────────────────────
  if (isManager) {
    const { data: shifts, error: shiftsError } = await supabase
      .from("open_shifts")
      .select("id, date, start_minutes, end_minutes, note, status, filled_by")
      .eq("org_id", orgId)
      .neq("status", "cancelled")
      .gte("date", today)
      .order("date", { ascending: true });

    if (shiftsError) {
      console.error("[api/open-shifts]", shiftsError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const shiftIds = (shifts ?? []).map((s) => s.id);
    let claims: ClaimRow[] = [];
    if (shiftIds.length > 0) {
      const { data: claimRows } = await supabase
        .from("open_shift_claims")
        .select("id, open_shift_id, employee_id, status")
        .eq("org_id", orgId)
        .in("open_shift_id", shiftIds);
      claims = (claimRows ?? []) as ClaimRow[];
    }

    const names = await resolveNames(supabase, orgId, [
      ...(shifts ?? []).map((s) => s.filled_by).filter((v): v is number => v != null),
      ...claims.map((c) => c.employee_id),
    ]);

    return NextResponse.json({
      openShifts: (shifts ?? []).map((s) => shapeOpenShift(s, claims, names)),
    });
  }

  // ── Employee view ─────────────────────────────────────────────────────────
  if (!employeeId) return NextResponse.json({ openShifts: [] });

  const { data: shifts, error: shiftsError } = await supabase
    .from("open_shifts")
    .select("id, date, start_minutes, end_minutes, note, status, filled_by")
    .eq("org_id", orgId)
    .eq("status", "open")
    .gte("date", today)
    .order("date", { ascending: true });

  if (shiftsError) {
    console.error("[api/open-shifts]", shiftsError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!shifts || shifts.length === 0) return NextResponse.json({ openShifts: [] });

  // Fetch the caller's own commitments to evaluate eligibility, plus any claims
  // they've already filed.
  const dates = [...new Set(shifts.map((s) => s.date))];
  const [{ data: schedules }, { data: timeOff }, { data: callouts }, { data: myClaims }] =
    await Promise.all([
      supabase
        .from("schedules")
        .select("date, start_minutes, end_minutes")
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .in("date", dates),
      supabase
        .from("time_off_requests")
        .select("date, status")
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .in("date", dates),
      supabase
        .from("callouts")
        .select("date")
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .in("date", dates),
      supabase
        .from("open_shift_claims")
        .select("id, open_shift_id, employee_id, status")
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .in("open_shift_id", shifts.map((s) => s.id)),
    ]);

  const ctxData = {
    schedules: (schedules ?? []).map((s) => ({
      date: s.date,
      startMinutes: s.start_minutes,
      endMinutes: s.end_minutes,
    })),
    timeOff: (timeOff ?? []).map((t) => ({ date: t.date, status: t.status })),
    callouts: (callouts ?? []).map((c) => ({ date: c.date })),
  };
  const claimByShift = new Map<number, ClaimRow>();
  for (const c of (myClaims ?? []) as ClaimRow[]) claimByShift.set(c.open_shift_id, c);

  const eligible = shifts
    .filter((s) => {
      // Always surface a shift the employee has already claimed; otherwise gate
      // on eligibility.
      if (claimByShift.has(s.id)) return true;
      return isEmployeeEligible(
        { date: s.date, startMinutes: s.start_minutes, endMinutes: s.end_minutes },
        ctxData
      ).eligible;
    })
    .map((s) => {
      const mine = claimByShift.get(s.id);
      return {
        id: s.id,
        date: s.date,
        startMinutes: s.start_minutes,
        endMinutes: s.end_minutes,
        note: s.note ?? null,
        status: s.status,
        myClaimStatus: mine ? mine.status : null,
      };
    });

  return NextResponse.json({ openShifts: eligible });
}

// POST /api/open-shifts — a manager posts an unassigned shift for pickup.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { date, startMinutes, endMinutes, note } = body;

  const validation = validateOpenShift({ date, startMinutes, endMinutes });
  if (!validation.valid)
    return NextResponse.json({ error: validation.error }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  }

  const trimmedNote =
    note && typeof note === "string" && note.trim() ? note.trim() : null;

  const { data: inserted, error: insertError } = await supabase
    .from("open_shifts")
    .insert(
      withOrg(orgId!, {
        date,
        start_minutes: startMinutes,
        end_minutes: endMinutes,
        note: trimmedNote,
        status: "open",
        created_by: user!.id,
      })
    )
    .select("id")
    .single();

  if (insertError) {
    console.error("[api/open-shifts]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Broadcast to the org's in-app feed that a shift is up for grabs.
  notify(supabase, {
    orgId: orgId!,
    userId: null,
    type: "open_shift_available",
    title: "Open Shift Available",
    body: `A shift on ${date} is open for pickup.`,
    data: { openShiftId: inserted.id, date },
  }).catch(() => {});

  writeAuditLog({
    action:       "open_shift.create",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "open_shift",
    resourceId:   String(inserted.id),
    after:        { date, startMinutes, endMinutes, note: trimmedNote },
  }).catch(() => {});

  return NextResponse.json({ id: inserted.id, ok: true }, { status: 201 });
}

// Batch-resolve employee id → name within the org.
async function resolveNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  ids: number[]
): Promise<Record<number, string>> {
  const unique = [...new Set(ids)];
  const names: Record<number, string> = {};
  if (unique.length === 0) return names;
  const { data } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId)
    .in("id", unique);
  for (const e of data ?? []) names[e.id] = e.name;
  return names;
}
