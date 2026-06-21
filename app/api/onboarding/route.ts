import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { validateOnboardingLabel, onboardingProgress } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

// GET /api/onboarding?employeeId= — an employee's onboarding checklist + progress.
// Employees may read only their own; managers may read anyone's.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("employeeId") ? Number(searchParams.get("employeeId")) : null;

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;
  const targetId = requested == null ? employeeId : (isManager ? requested : (requested === employeeId ? employeeId : null));
  if (targetId == null)
    return NextResponse.json({ error: "Not authorized for that employee" }, { status: 403 });

  const { data, error: dbError } = await supabase
    .from("onboarding_items")
    .select("id, employee_id, label, done")
    .eq("org_id", orgId)
    .eq("employee_id", targetId)
    .order("id", { ascending: true });

  if (dbError) {
    console.error("[api/onboarding]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const items = (data ?? []).map((i) => ({ id: i.id, label: i.label, done: i.done }));
  return NextResponse.json({ employeeId: targetId, items, progress: onboardingProgress(items) });
}

// POST /api/onboarding { employeeId, label } (manager) — add a checklist item.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!Number.isInteger(body.employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  const check = validateOnboardingLabel(body.label);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId!)
    .eq("id", body.employeeId)
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("onboarding_items")
    .insert(withOrg(orgId!, { employee_id: body.employeeId, label: check.value, done: false }))
    .select("id")
    .single();

  if (error) {
    console.error("[api/onboarding]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action: "onboarding.add", orgId: orgId!, actorId: user!.id,
    resourceType: "onboarding_item", resourceId: String(data.id),
    after: { employeeId: body.employeeId, label: check.value },
  }).catch(() => {});

  return NextResponse.json({ id: data.id, ok: true }, { status: 201 });
}

// PATCH /api/onboarding { id, done } (manager) — check/uncheck an item.
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!Number.isInteger(body.id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });
  if (typeof body.done !== "boolean")
    return NextResponse.json({ error: "done must be a boolean" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("onboarding_items")
    .select("id")
    .eq("org_id", orgId!)
    .eq("id", body.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const { error } = await supabase
    .from("onboarding_items")
    .update({ done: body.done })
    .eq("org_id", orgId!)
    .eq("id", body.id);

  if (error) {
    console.error("[api/onboarding]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/onboarding { id } (manager) — remove an item.
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!Number.isInteger(body.id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("onboarding_items")
    .select("id")
    .eq("org_id", orgId!)
    .eq("id", body.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const { error } = await supabase
    .from("onboarding_items")
    .delete()
    .eq("org_id", orgId!)
    .eq("id", body.id);

  if (error) {
    console.error("[api/onboarding]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
