import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { salesPerLaborHour, validateSalesAmount } from "@/lib/splh";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/reports/splh?date=YYYY-MM-DD (manager-only)
// Sales-per-labor-hour for the day: recorded sales ÷ scheduled labor hours.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const [{ data: salesRow }, { data: scheduleRows, error: schedErr }] = await Promise.all([
    supabase.from("daily_sales").select("amount_cents").eq("org_id", orgId!).eq("date", date).maybeSingle(),
    supabase.from("schedules").select("start_minutes, end_minutes").eq("org_id", orgId!).eq("date", date).limit(10000),
  ]);

  if (schedErr) {
    console.error("[api/reports/splh]", schedErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const salesCents = salesRow?.amount_cents ?? 0;
  const laborMinutes = (scheduleRows ?? []).reduce((sum, s) => sum + (s.end_minutes - s.start_minutes), 0);

  return NextResponse.json({
    date,
    salesCents,
    laborMinutes,
    splhCents: salesPerLaborHour(salesCents, laborMinutes),
  });
}

// PUT /api/reports/splh { date, amountCents } (manager) — record the day's sales.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { date, amountCents } = body;

  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
  const check = validateSalesAmount(amountCents);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = await supabase
    .from("daily_sales")
    .upsert(
      withOrg(orgId!, { date, amount_cents: check.value, updated_at: new Date().toISOString() }),
      { onConflict: "org_id,date" }
    );

  if (error) {
    console.error("[api/reports/splh]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action: "sales.record", orgId: orgId!, actorId: user!.id,
    resourceType: "daily_sales", resourceId: date,
    after: { amountCents: check.value },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
