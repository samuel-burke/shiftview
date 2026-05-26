import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const { employeeId, email } = await request.json();

  if (employeeId == null)
    return NextResponse.json({ error: "employeeId required" }, { status: 400 });
  if (!Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
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

  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("id", employeeId)
    .maybeSingle();

  if (!employee)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { error: updateError } = await supabase
    .from("employees")
    .update({ email })
    .eq("id", employeeId);

  if (updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 });

  const admin = createAdminClient();
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);

  if (inviteError)
    return NextResponse.json({ error: inviteError.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 201 });
}
