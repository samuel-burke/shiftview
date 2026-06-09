import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Action category prefixes actually written via writeAuditLog (see lib/audit.ts usages).
const VALID_CATEGORIES = new Set([
  "availability",
  "employee",
  "manager",
  "payroll",
  "punch",
  "schedule",
  "settings",
  "store_hours",
  "swap",
  "template",
  "time_off",
]);

export async function GET(request: Request) {
  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { searchParams } = new URL(request.url);
  const from     = searchParams.get("from");
  const to       = searchParams.get("to");
  const category = searchParams.get("category"); // e.g. "schedule", "employee", "punch"
  const actorId  = searchParams.get("actorId");
  const page     = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit    = 50;
  const offset   = (page - 1) * limit;

  if (category && !VALID_CATEGORIES.has(category))
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });

  const admin = createAdminClient();
  let query = admin
    .from("audit_logs")
    .select("id, action, actor_id, resource_type, resource_id, before, after, metadata, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (from)     query = query.gte("created_at", `${from}T00:00:00.000Z`);
  if (to)       query = query.lte("created_at", `${to}T23:59:59.999Z`);
  if (category) query = query.like("action", `${category}.%`);
  if (actorId)  query = query.eq("actor_id", actorId);

  const { data, count, error } = await query;
  if (error) {
    console.error("[api/audit-log]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Enrich with actor names from employees table
  const actorIds = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const actorNameMap: Record<string, string> = {};
  if (actorIds.length > 0) {
    const { data: employees } = await admin
      .from("employees")
      .select("user_id, name")
      .in("user_id", actorIds);
    for (const emp of employees ?? []) {
      if (emp.user_id) actorNameMap[emp.user_id] = emp.name;
    }
  }

  const entries = (data ?? []).map((r) => ({
    id:           r.id,
    action:       r.action,
    actorId:      r.actor_id,
    actorName:    r.actor_id ? (actorNameMap[r.actor_id] ?? "Deleted user") : null,
    resourceType: r.resource_type,
    resourceId:   r.resource_id,
    before:       r.before,
    after:        r.after,
    metadata:     r.metadata,
    createdAt:    r.created_at,
  }));

  return NextResponse.json({
    entries,
    total:   count ?? 0,
    page,
    limit,
    hasMore: offset + limit < (count ?? 0),
  });
}
