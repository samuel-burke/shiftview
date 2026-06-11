import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";

// Verifies the caller is a manager and resolves which organization they are
// acting on. All manager-gated routes get their org scope from the returned
// orgId; pass the incoming Request through so multi-org managers can pin an
// org via the x-organization-id header.
export async function requireManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  request?: Request
) {
  const { ctx, user, error } = await getOrgContext(supabase, request);

  if (error === "Not authenticated")
    return { user: null, orgId: null, error: "Not authenticated" as const };
  if (error || !ctx.isManager)
    return { user, orgId: null, error: "Manager access required" as const };

  return { user: ctx.user, orgId: ctx.orgId, error: null };
}
