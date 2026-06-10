import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Daily labor budget hours per day of week, stored on store_hours.budget_hours. */
export async function GET() {
  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data, error } = await supabase
    .from("store_hours")
    .select("day_of_week, budget_hours")
    .order("day_of_week");

  if (error) {
    // Column missing → migration hasn't been run yet. Degrade to zeros so the page still works.
    console.error("[api/budgets]", error);
    return NextResponse.json({
      budgets: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, 0])),
      migrationRequired: true,
    });
  }

  const budgets = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, 0]));
  for (const row of data ?? []) budgets[row.day_of_week] = row.budget_hours ?? 0;

  return NextResponse.json({ budgets });
}

export async function PUT(request: Request) {
  const { dayOfWeek, budgetHours } = await request.json();

  if (dayOfWeek == null || budgetHours == null)
    return NextResponse.json({ error: "dayOfWeek, budgetHours required" }, { status: 400 });
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)
    return NextResponse.json({ error: "dayOfWeek must be 0–6" }, { status: 400 });
  if (!Number.isInteger(budgetHours) || budgetHours < 0 || budgetHours > 999)
    return NextResponse.json({ error: "budgetHours must be 0–999" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = await supabase
    .from("store_hours")
    .update({ budget_hours: budgetHours })
    .eq("day_of_week", dayOfWeek);

  if (error) {
    console.error("[api/budgets]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "budget_hours.update",
    actorId:      user?.id,
    resourceType: "store_hours",
    after: { dayOfWeek, budgetHours },
    metadata: { dayOfWeek, dayName: DAY_NAMES[dayOfWeek] ?? null, budgetHours },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
