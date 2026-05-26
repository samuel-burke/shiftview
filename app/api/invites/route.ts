import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const { name, email } = await request.json();

  if (!name || typeof name !== "string" || !name.trim())
    return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!email || typeof email !== "string")
    return NextResponse.json({ error: "email required" }, { status: 400 });
  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: "email format is invalid" }, { status: 400 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  // Use the admin client for both operations — bypasses RLS (we've already
  // verified manager status above) and keeps privileges consistent.
  const admin = createAdminClient();

  const { data: employee, error: insertError } = await admin
    .from("employees")
    .insert({ name: name.trim(), email })
    .select("id")
    .single();

  if (insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 });

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);

  if (inviteError) {
    // Roll back the employee row so retrying the invite starts clean
    await admin.from("employees").delete().eq("id", employee.id);
    return NextResponse.json({ error: inviteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, employeeId: employee.id }, { status: 201 });
}
