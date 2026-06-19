import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { countTotal, tillVariance, validateTillCount, type DenominationCounts } from "@/lib/till";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/till-counts?date=YYYY-MM-DD — the day's drawer counts (any member),
// each with its over/short status and the counter's name.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId } = ctx!;
  const { data, error: dbError } = await supabase
    .from("till_counts")
    .select("id, employee_id, count_type, expected_cents, counted_cents, variance_cents, note, created_at")
    .eq("org_id", orgId)
    .eq("date", date)
    .order("created_at", { ascending: true });

  if (dbError) {
    console.error("[api/till-counts]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const ids = [...new Set((data ?? []).map((r) => r.employee_id))];
  const nameById = new Map<number, string>();
  if (ids.length > 0) {
    const { data: emps } = await supabase.from("employees").select("id, name").eq("org_id", orgId).in("id", ids);
    for (const e of emps ?? []) nameById.set(e.id, e.name);
  }

  return NextResponse.json({
    counts: (data ?? []).map((r) => ({
      id: r.id,
      counterName: nameById.get(r.employee_id) ?? "Unknown",
      type: r.count_type,
      expectedCents: r.expected_cents,
      countedCents: r.counted_cents,
      varianceCents: r.variance_cents,
      status: tillVariance(r.expected_cents, r.counted_cents).status,
      note: r.note ?? null,
      createdAt: r.created_at,
    })),
  });
}

// POST /api/till-counts { date, type, expectedCents, countedCents? | counts? } —
// record a drawer count. `counts` (a denomination map) is summed to countedCents
// when provided.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { date, type, expectedCents, note } = body;

  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });

  const countedCents =
    body.counts && typeof body.counts === "object"
      ? countTotal(body.counts as DenominationCounts)
      : body.countedCents;

  const check = validateTillCount({ type, expectedCents, countedCents });
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, employeeId } = ctx!;
  if (!employeeId)
    return NextResponse.json({ error: "No employee record found" }, { status: 403 });

  const { varianceCents, status } = tillVariance(check.value.expectedCents, check.value.countedCents);
  const trimmedNote = note && typeof note === "string" && note.trim() ? note.trim() : null;

  const { data, error: insertError } = await supabase
    .from("till_counts")
    .insert(
      withOrg(orgId, {
        employee_id: employeeId,
        date,
        count_type: check.value.type,
        expected_cents: check.value.expectedCents,
        counted_cents: check.value.countedCents,
        variance_cents: varianceCents,
        note: trimmedNote,
      })
    )
    .select("id")
    .single();

  if (insertError) {
    console.error("[api/till-counts]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action: "till.count", orgId, actorId: user.id,
    resourceType: "till_count", resourceId: String(data.id),
    after: { type: check.value.type, varianceCents },
  }).catch(() => {});

  return NextResponse.json({
    id: data.id,
    ok: true,
    countedCents: check.value.countedCents,
    varianceCents,
    status,
  }, { status: 201 });
}
