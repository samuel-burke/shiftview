import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Sign-up provisioning: any authenticated (non-anonymous) user can create an
// organization and becomes its owner — a manager nobody can demote. The
// caller does NOT need an existing org membership, so this route uses
// auth.getUser() directly instead of getOrgContext()/requireManager().

const MAX_NAME_LENGTH = 80;

// A hostile authenticated user could otherwise provision orgs in a loop.
const MAX_OWNED_ORGS = 3;

// Slugs that must never be claimable through sign-up.
const RESERVED_SLUGS = new Set(["default", "demo"]);

// Slug collisions are resolved with a random suffix; a handful of attempts
// makes the odds of total failure negligible.
const SLUG_ATTEMPTS = 5;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { name, ownerName } = body;

  if (!name || typeof name !== "string" || !name.trim())
    return NextResponse.json({ error: "organization name required" }, { status: 400 });
  if (name.trim().length > MAX_NAME_LENGTH)
    return NextResponse.json({ error: `organization name must be ${MAX_NAME_LENGTH} characters or fewer` }, { status: 400 });
  if (!ownerName || typeof ownerName !== "string" || !ownerName.trim())
    return NextResponse.json({ error: "your name is required" }, { status: 400 });
  if (ownerName.trim().length > MAX_NAME_LENGTH)
    return NextResponse.json({ error: `your name must be ${MAX_NAME_LENGTH} characters or fewer` }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  // Demo visitors are anonymous; an org owner needs a real account with an
  // email (it also becomes their employee record's email).
  if (user.is_anonymous || !user.email)
    return NextResponse.json(
      { error: "An account with an email address is required to create an organization" },
      { status: 403 }
    );

  const admin = createAdminClient();

  const { count: ownedCount } = await admin
    .from("managers")
    .select("org_id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_owner", true);
  if ((ownedCount ?? 0) >= MAX_OWNED_ORGS)
    return NextResponse.json(
      { error: "You have reached the maximum number of organizations you can own" },
      { status: 403 }
    );

  const orgName = name.trim();
  const base = slugify(orgName) || "org";
  const baseTaken = RESERVED_SLUGS.has(base);

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 && !baseTaken ? base : `${base}-${randomSuffix()}`;

    const { data: orgId, error } = await admin.rpc("org_signup_create", {
      p_name: orgName,
      p_slug: slug,
      p_user_id: user.id,
      p_owner_name: ownerName.trim(),
      p_owner_email: user.email,
    });

    if (!error) {
      writeAuditLog({
        action:       "organization.create",
        orgId:        orgId as string,
        actorId:      user.id,
        resourceType: "organization",
        resourceId:   orgId as string,
        after: { name: orgName, slug },
        metadata: { ownerUserId: user.id },
      }).catch(() => {});

      return NextResponse.json({ ok: true, organizationId: orgId }, { status: 201 });
    }

    // unique_violation: another org claimed this slug — retry with a suffix.
    if (error.code === "23505") continue;

    console.error("[api/organizations]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  console.error("[api/organizations] slug generation exhausted for base:", base);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
