import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { withOrgAll } from "@/lib/org-scope";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const body = await request.json();
  const { fromDate, toDate } = body ?? {};

  if (!fromDate || !toDate)
    return NextResponse.json({ error: "fromDate and toDate are required" }, { status: 400 });
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate))
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  // Fetch schedules already existing on toDate (to skip those employees)
  const { data: existing, error: existingError } = await supabase
    .from("schedules")
    .select("employee_id")
    .eq("org_id", orgId)
    .eq("date", toDate);
  if (existingError) {
    console.error("[schedules/copy] existing schedules fetch failed:", existingError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const alreadyScheduled = new Set((existing ?? []).map((s: { employee_id: number }) => s.employee_id));

  // Fetch schedules from fromDate
  const { data: fromSchedules, error: fromError } = await supabase
    .from("schedules")
    .select("employee_id, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("date", fromDate);
  if (fromError) {
    console.error("[schedules/copy] fromDate schedules fetch failed:", fromError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const toInsert = (fromSchedules ?? []).filter(
    (s: { employee_id: number }) => !alreadyScheduled.has(s.employee_id)
  );
  const skipped = (fromSchedules ?? []).length - toInsert.length;

  if (toInsert.length === 0)
    return NextResponse.json({ copied: 0, skipped });

  const rows = toInsert.map((s: { employee_id: number; start_minutes: number; end_minutes: number }) => ({
    employee_id: s.employee_id,
    date: toDate,
    start_minutes: s.start_minutes,
    end_minutes: s.end_minutes,
  }));

  const { error: insertError } = await supabase
    .from("schedules")
    .insert(withOrgAll(orgId, rows));
  if (insertError) {
    console.error("[schedules/copy] schedules insert failed:", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "schedule.copy",
    orgId,
    actorId:      user?.id,
    resourceType: "schedule",
    metadata: {
      fromDate,
      toDate,
      copied:  toInsert.length,
      skipped,
    },
  }).catch(() => {});

  return NextResponse.json({ copied: toInsert.length, skipped });
}
