import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { listMemberships, ORG_COOKIE } from "@/lib/org-context";

export const dynamic = "force-dynamic";

// POST /api/me/organization — the organization switcher. Body: { orgId }.
// Remembers the choice in a cookie that getOrgContext() reads on every
// request. Only orgs the caller belongs to can be picked, and the cookie is
// re-checked against their memberships on each request anyway.
export async function POST(request: Request) {
  const { orgId } = await request.json().catch(() => ({}));
  if (typeof orgId !== "string" || !orgId)
    return NextResponse.json({ error: "orgId required" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const memberships = await listMemberships(supabase, user.id);
  if (!memberships.some((m) => m.id === orgId))
    return NextResponse.json({ error: "You aren't a member of that organization" }, { status: 403 });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ORG_COOKIE, orgId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
