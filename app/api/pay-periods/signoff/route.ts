import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { isDateKey } from "@/lib/dates";
import { payPeriodErrorResponse } from "@/lib/pay-periods-server";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const MAX_NOTE = 1000;

// POST /api/pay-periods/signoff  { date, status: "signed" | "disputed", note? }
// The caller confirms their own hours for the period containing `date`
// ("signed"), or disputes them with a note. There is no employee id to pass:
// pay_period_sign finds the caller's own employee record, so nobody, manager
// or not, can sign for someone else.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { date, status, note, employeeId } = body as Record<string, unknown>;
  if (!isDateKey(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  if (status !== "signed" && status !== "disputed")
    return NextResponse.json({ error: 'status must be "signed" or "disputed"' }, { status: 400 });
  if (note !== undefined && note !== null && typeof note !== "string")
    return NextResponse.json({ error: "note must be a string" }, { status: 400 });
  const trimmedNote = typeof note === "string" ? note.trim() : "";
  if (trimmedNote.length > MAX_NOTE)
    return NextResponse.json({ error: `note must be at most ${MAX_NOTE} characters` }, { status: 400 });
  if (status === "disputed" && !trimmedNote)
    return NextResponse.json({ error: "Say what's wrong with your hours" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error: authError } = await getOrgContext(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });
  if (ctx.employeeId === null)
    return NextResponse.json({ error: "No employee record linked to this account" }, { status: 403 });
  if (employeeId !== undefined && employeeId !== ctx.employeeId)
    return NextResponse.json({ error: "You can only sign off your own hours" }, { status: 403 });

  const { data, error } = await supabase.rpc("pay_period_sign", {
    p_org: ctx.orgId,
    p_date: date,
    p_status: status,
    p_note: trimmedNote || null,
  });
  if (error) return payPeriodErrorResponse(error, "api/pay-periods/signoff");

  const row = (data ?? {}) as { period_id?: number; signed_at?: string };
  writeAuditLog({
    action:       status === "signed" ? "pay_period.sign" : "pay_period.dispute",
    orgId:        ctx.orgId,
    actorId:      ctx.user.id,
    resourceType: "pay_period",
    resourceId:   row.period_id != null ? String(row.period_id) : null,
    after:        { status, note: trimmedNote || null },
    metadata:     { employeeId: ctx.employeeId, date },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    signoff: { employeeId: ctx.employeeId, status, note: trimmedNote || null, signedAt: row.signed_at ?? null },
  });
}
