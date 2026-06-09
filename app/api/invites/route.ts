import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatName(raw: string): string {
  return raw.trim().replace(/\S+/g, (word) =>
    word.replace(/(^|[-])(\S)/g, (_, sep, char) => sep + char.toUpperCase())
  );
}

export async function POST(request: Request) {
  const { name, email } = await request.json();

  if (!name || typeof name !== "string" || !name.trim())
    return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!email || typeof email !== "string")
    return NextResponse.json({ error: "email required" }, { status: 400 });
  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: "email format is invalid" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const admin = createAdminClient();
  const formattedName = formatName(name);

  const { data: employee, error: insertError } = await admin
    .from("employees")
    .insert({ name: formattedName, email })
    .select("id")
    .single();

  if (insertError) {
    console.error("[api/invites]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  });

  if (inviteError) {
    // Roll back the employee row so retrying the invite starts clean
    await admin.from("employees").delete().eq("id", employee.id);
    console.error("[api/invites]", inviteError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "employee.invite",
    actorId:      user?.id,
    resourceType: "employee",
    resourceId:   String(employee.id),
    after: { name: formattedName, email },
    metadata: {
      employeeId:   employee.id,
      employeeName: formattedName,
      email,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, employeeId: employee.id }, { status: 201 });
}

export async function PUT(request: Request) {
  const { email } = await request.json();

  if (!email || !EMAIL_RE.test(email))
    return NextResponse.json({ error: "valid email required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const admin = createAdminClient();
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  });

  if (inviteError) {
    console.error("[api/invites]", inviteError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "employee.reinvite",
    actorId:      user?.id,
    resourceType: "employee",
    metadata: { email },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
