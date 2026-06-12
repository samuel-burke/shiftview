import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);

  // Unauthenticated or no org membership — return a blank identity, not an error.
  if (error) {
    return NextResponse.json({
      isManager: false, isOwner: false, orgName: null,
      employeeId: null, employeeName: null, isDemo: false,
    });
  }

  // Fetch the employee name if the caller has a linked employee in this org.
  let employeeId: number | null = ctx.employeeId;
  let employeeName: string | null = null;

  if (employeeId != null) {
    const { data: emp } = await supabase
      .from("employees")
      .select("id, name")
      .eq("org_id", ctx.orgId)
      .eq("id", employeeId)
      .maybeSingle();
    employeeId = emp?.id ?? null;
    employeeName = emp?.name ?? null;
  }

  // Owners get the org name so the delete-organization confirmation can ask
  // them to type it back.
  let orgName: string | null = null;
  if (ctx.isOwner) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", ctx.orgId)
      .maybeSingle();
    orgName = org?.name ?? null;
  }

  return NextResponse.json({
    isManager: ctx.isManager,
    isOwner: ctx.isOwner,
    orgName,
    employeeId,
    employeeName,
    isDemo: ctx.isDemo,
  });
}
