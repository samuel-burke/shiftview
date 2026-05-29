import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";

function sortByName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const parts = (n: string) => {
      const p = n.trim().split(/\s+/);
      return { last: p.length > 1 ? p[p.length - 1] : p[0], first: p[0] };
    };
    const pa = parts(a.name);
    const pb = parts(b.name);
    return pa.last.localeCompare(pb.last) || pa.first.localeCompare(pb.first);
  });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const { data, error } = await supabase.from("employees_demo").select("id, name");
    if (error) {
    console.error("[api/employees]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
    return NextResponse.json(sortByName(data ?? []));
  }

  const { data, error } = await supabase.from("employees").select("id, name, email, user_id");
  if (error) {
    console.error("[api/employees]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(sortByName(data ?? []));
}

export async function PATCH(request: Request) {
  const { id, userId, name } = await request.json();

  if (id == null)
    return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });
  if (userId !== undefined && userId !== null && typeof userId !== "string")
    return NextResponse.json(
      { error: "userId must be a string (UUID) or null to unlink" },
      { status: 400 }
    );
  if (name !== undefined && (typeof name !== "string" || !name.trim()))
    return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const updates: Record<string, unknown> = {};
  if (userId !== undefined) updates.user_id = userId;
  if (name !== undefined) updates.name = name.trim();

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  const { error } = await supabase.from("employees").update(updates).eq("id", id);

  if (error) {
    console.error("[api/employees]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { id } = await request.json();

  if (id == null)
    return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  // Fetch the employee first to get their linked auth user_id
  const { data: employee } = await supabase
    .from("employees")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();

  if (!employee)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { user: currentUser } = await requireManager(supabase);
  if (employee.user_id && employee.user_id === currentUser?.id)
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 403 });

  // Delete schedules first so FK constraint doesn't block employee removal
  const { error: scheduleError } = await supabase.from("schedules").delete().eq("employee_id", id);
  if (scheduleError) return NextResponse.json({ error: scheduleError.message }, { status: 500 });

  const { data: deleted, error } = await supabase
    .from("employees")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    console.error("[api/employees]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!deleted || deleted.length === 0)
    return NextResponse.json({ error: "Employee not found or permission denied" }, { status: 404 });

  // Delete auth account and manager role if the employee had a linked user
  if (employee.user_id) {
    const admin = createAdminClient();
    await admin.from("managers").delete().eq("user_id", employee.user_id);
    await admin.auth.admin.deleteUser(employee.user_id);
  }

  return NextResponse.json({ ok: true });
}
