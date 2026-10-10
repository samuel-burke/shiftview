import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext, listMemberships } from "@/lib/org-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);

  // Unauthenticated or no org membership — return a blank identity, not an error.
  if (error) {
    return NextResponse.json({
      isManager: false, isOwner: false, orgName: null,
      employeeId: null, employeeName: null, isDemo: false,
      orgId: null, organizations: [],
    });
  }

  // The three lookups are independent; every app load waits on this route, so
  // run them together.
  const [emp, orgName, organizations] = await Promise.all([
    // The employee name, if the caller has a linked employee in this org.
    ctx.employeeId != null
      ? supabase
          .from("employees")
          .select("id, name")
          .eq("org_id", ctx.orgId)
          .eq("id", ctx.employeeId)
          .maybeSingle()
          .then(({ data }) => data)
      : null,
    // Owners get the org name so the delete-organization confirmation can ask
    // them to type it back.
    ctx.isOwner
      ? supabase
          .from("organizations")
          .select("name")
          .eq("id", ctx.orgId)
          .maybeSingle()
          .then(({ data }) => (data?.name as string | undefined) ?? null)
      : null,
    // Every organization the user belongs to, for the organization switcher.
    listMemberships(supabase, ctx.user.id),
  ]);
  const employeeId: number | null = emp?.id ?? null;
  const employeeName: string | null = emp?.name ?? null;

  return NextResponse.json({
    isManager: ctx.isManager,
    isOwner: ctx.isOwner,
    orgName,
    employeeId,
    employeeName,
    isDemo: ctx.isDemo,
    orgId: ctx.orgId,
    organizations,
  });
}
