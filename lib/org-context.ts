import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";
import { isDemoOrgId } from "@/lib/demo-org";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Must match the org seeded by supabase/migrations/0001_multitenancy_expand.sql.
export const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

// Clients may pin a specific organization with this header; without it the
// user's (single) membership decides. Required only for multi-org users.
export const ORG_HEADER = "x-organization-id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrgContext = {
  user: User;
  orgId: string;
  isManager: boolean;
  // True when the caller is this org's owner (managers.is_owner) — the
  // sign-up creator, who alone may delete the organization.
  isOwner: boolean;
  // The caller's employee record in this org, when one exists.
  employeeId: number | null;
  // True when operating on the demo organization. Used to suppress outbound
  // side effects (email, push, invites) — never to relax org scoping.
  isDemo: boolean;
};

export type OrgContextError = "Not authenticated" | "No organization membership";

export type OrgContextResult =
  | { ctx: OrgContext; user: User; error: null }
  | { ctx: null; user: User | null; error: OrgContextError };

// Resolves the current user and the organization this request operates on.
// Every API route must derive its tenant scope from here — never from request
// parameters — so a client can only ever select among orgs it belongs to.
export async function getOrgContext(
  supabase: Supabase,
  request?: Request
): Promise<OrgContextResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ctx: null, user: null, error: "Not authenticated" };

  const headerOrg = request?.headers.get(ORG_HEADER)?.trim() ?? "";
  const requestedOrg = UUID_RE.test(headerOrg) ? headerOrg : null;

  // RLS already restricts these lookups to the user's own rows; the explicit
  // filters keep behavior identical in tests and with permissive policies.
  let managerQuery = supabase
    .from("managers")
    .select("user_id, org_id, is_owner")
    .eq("user_id", user.id);
  if (requestedOrg) managerQuery = managerQuery.eq("org_id", requestedOrg);
  const { data: managerRow } = await managerQuery.limit(1).maybeSingle();

  let employeeQuery = supabase
    .from("employees")
    .select("id, org_id")
    .eq("user_id", user.id);
  if (requestedOrg) employeeQuery = employeeQuery.eq("org_id", requestedOrg);
  const { data: employeeRow } = await employeeQuery.limit(1).maybeSingle();

  const orgId: string | null =
    managerRow?.org_id ?? employeeRow?.org_id ?? null;
  if (!orgId) return { ctx: null, user, error: "No organization membership" };

  return {
    ctx: {
      user,
      orgId,
      isManager: Boolean(managerRow),
      isOwner: Boolean(managerRow?.is_owner),
      employeeId: employeeRow?.org_id === orgId ? (employeeRow?.id ?? null) : null,
      isDemo: isDemoOrgId(orgId),
    },
    user,
    error: null,
  };
}
