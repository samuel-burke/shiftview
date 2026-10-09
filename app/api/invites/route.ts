import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { withOrg } from "@/lib/org-scope";
import { isDemoOrgId } from "@/lib/demo-org";
import { notify } from "@/lib/notify";
import { escapeHtml, sendEmail } from "@/lib/email";

// Demo visitors hold manager access, and invites send real emails through
// Supabase Auth — an open spam vector if left enabled for the demo org.
const DEMO_BLOCKED = "Inviting employees is disabled in the demo organization";

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
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  if (isDemoOrgId(orgId!))
    return NextResponse.json({ error: DEMO_BLOCKED }, { status: 403 });

  const admin = createAdminClient();
  const formattedName = formatName(name);

  // Someone already on this team isn't added a second time.
  const { data: sameEmail } = await admin
    .from("employees")
    .select("id")
    .eq("org_id", orgId!)
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .limit(1);
  if (Array.isArray(sameEmail) && sameEmail.length > 0)
    return NextResponse.json({ error: "Someone with that email is already on your team" }, { status: 409 });

  const { data: employee, error: insertError } = await admin
    .from("employees")
    .insert(withOrg(orgId!, { name: formattedName, email }))
    .select("id")
    .single();

  if (insertError) {
    console.error("[api/invites]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Supabase won't invite an email that already has an account (someone who
  // works at another store, or never accepted an earlier invite), so link the
  // new row to that account instead (migration 0039). If the function is
  // missing, carry on with a plain invite as before.
  const { data: linked, error: linkError } = await admin.rpc("link_employee_account", {
    p_org: orgId!,
    p_employee: employee.id,
  });
  if (linkError) console.error("[api/invites] link_employee_account failed:", linkError);
  const account = Array.isArray(linked) ? (linked[0] as { user_id: string; confirmed: boolean } | undefined) : undefined;

  if (account?.confirmed) {
    // They already sign in to ShiftView: no invite, just tell them where to
    // find the new organization (the switcher under their profile picture).
    await tellExistingAccount(admin, orgId!, account.user_id, email);
    writeAuditLog({
      action:       "employee.invite",
      orgId:        orgId!,
      actorId:      user?.id,
      resourceType: "employee",
      resourceId:   String(employee.id),
      after: { name: formattedName, email, existingAccount: true },
      metadata: { employeeId: employee.id, employeeName: formattedName, email, existingAccount: true },
    }).catch(() => {});
    return NextResponse.json({ ok: true, employeeId: employee.id, existingAccount: true }, { status: 201 });
  }

  // No account yet, or one that never confirmed its email: Supabase sends
  // (or re-sends) the invite.
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  });

  if (inviteError) {
    // Roll back the employee row so retrying the invite starts clean
    await admin.from("employees").delete().eq("org_id", orgId!).eq("id", employee.id);
    console.error("[api/invites]", inviteError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "employee.invite",
    orgId:        orgId!,
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

// An in-app notification in the new org, plus an email (when Resend is set
// up), since they may not open ShiftView for a while.
async function tellExistingAccount(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  userId: string,
  email: string
) {
  const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
  const orgName: string = org?.name ?? "a new organization";
  const where = "Pick it from the organization menu under your profile picture.";
  await notify({
    orgId,
    userId,
    type: "added_to_organization",
    title: `You've joined ${orgName}`,
    body: where,
  }).catch(() => {});
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  await sendEmail({
    to: email,
    subject: `You've been added to ${orgName} on ShiftView`,
    html: `<p>You've been added to <strong>${escapeHtml(orgName)}</strong> on ShiftView.</p>` +
      `<p>Sign in as usual${site ? ` at <a href="${escapeHtml(site)}">${escapeHtml(site)}</a>` : ""}, then ${where.charAt(0).toLowerCase()}${where.slice(1)}</p>`,
  }).catch((err) => console.error("[api/invites] email failed:", err));
}

export async function PUT(request: Request) {
  const { email } = await request.json();

  if (!email || !EMAIL_RE.test(email))
    return NextResponse.json({ error: "valid email required" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  if (isDemoOrgId(orgId!))
    return NextResponse.json({ error: DEMO_BLOCKED }, { status: 403 });

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
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "employee",
    metadata: { email },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
