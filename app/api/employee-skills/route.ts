import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { validateSkillName } from "@/lib/skills";

export const dynamic = "force-dynamic";

// GET /api/employee-skills
//   ?employeeId=  → that employee's skills.
//   ?skill=Name   → employees who have that skill (the "who can do X?" lookup).
// Any org member may read.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const employeeIdParam = searchParams.get("employeeId");
  const skillParam = searchParams.get("skill")?.trim();

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId } = ctx!;

  if (employeeIdParam) {
    const { data, error: dbError } = await supabase
      .from("employee_skills")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("employee_id", Number(employeeIdParam))
      .order("name", { ascending: true });
    if (dbError) {
      console.error("[api/employee-skills]", dbError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({ skills: (data ?? []).map((s) => ({ id: s.id, name: s.name })) });
  }

  if (skillParam) {
    const { data, error: dbError } = await supabase
      .from("employee_skills")
      .select("employee_id, name")
      .eq("org_id", orgId)
      .eq("name", skillParam);
    if (dbError) {
      console.error("[api/employee-skills]", dbError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    const ids = [...new Set((data ?? []).map((r) => r.employee_id))];
    const nameById = new Map<number, string>();
    if (ids.length > 0) {
      const { data: emps } = await supabase
        .from("employees")
        .select("id, name")
        .eq("org_id", orgId)
        .in("id", ids);
      for (const e of emps ?? []) nameById.set(e.id, e.name);
    }
    return NextResponse.json({
      skill: skillParam,
      employees: ids.map((id) => ({ employeeId: id, name: nameById.get(id) ?? "Unknown" })),
    });
  }

  return NextResponse.json({ error: "employeeId or skill param required" }, { status: 400 });
}

// POST /api/employee-skills { employeeId, name } (manager) — add a skill.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!Number.isInteger(body.employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  const check = validateSkillName(body.name);
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
    .from("employee_skills")
    .insert(withOrg(orgId!, { employee_id: body.employeeId, name: check.value }))
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ error: "That employee already has this skill" }, { status: 409 });
    console.error("[api/employee-skills]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action: "employee_skill.add", orgId: orgId!, actorId: user!.id,
    resourceType: "employee_skill", resourceId: String(data.id),
    after: { employeeId: body.employeeId, name: check.value },
  }).catch(() => {});

  return NextResponse.json({ id: data.id, ok: true }, { status: 201 });
}

// DELETE /api/employee-skills { id } (manager) — remove a skill.
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!Number.isInteger(body.id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("employee_skills")
    .select("id")
    .eq("org_id", orgId!)
    .eq("id", body.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Skill not found" }, { status: 404 });

  const { error } = await supabase
    .from("employee_skills")
    .delete()
    .eq("org_id", orgId!)
    .eq("id", body.id);

  if (error) {
    console.error("[api/employee-skills]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
