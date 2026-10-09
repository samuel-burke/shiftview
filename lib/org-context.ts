import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";
import { isDemoOrgId } from "@/lib/demo-org";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Must match the org seeded by supabase/migrations/0001_multitenancy_expand.sql.
export const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

// Clients may pin a specific organization with this header; without it the
// organization picked in the app (ORG_COOKIE) decides, and failing that the
// user's first membership.
export const ORG_HEADER = "x-organization-id";

// The organization a person picked in the organization switcher
// (POST /api/me/organization). Sent with every same-site request, so the API
// needs no client changes; like the header, it only selects among the user's
// own memberships and never grants access.
export const ORG_COOKIE = "sv_org";

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

export type Membership = { orgId: string; isManager: boolean; isOwner: boolean; employeeId: number | null };

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

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
  const cookieOrg = readCookie(request?.headers.get("cookie"), ORG_COOKIE) ?? "";
  const pinnedByHeader = UUID_RE.test(headerOrg);
  const requestedOrg = pinnedByHeader ? headerOrg : UUID_RE.test(cookieOrg) ? cookieOrg : null;

  let membership = await findMembership(supabase, user.id, requestedOrg);
  // A switcher choice the user no longer belongs to (they left, or the org was
  // deleted) falls back to their default org. An explicit header doesn't.
  if (!membership && requestedOrg && !pinnedByHeader) {
    membership = await findMembership(supabase, user.id, null);
  }
  if (!membership) return { ctx: null, user, error: "No organization membership" };

  return {
    ctx: {
      user,
      orgId: membership.orgId,
      isManager: membership.isManager,
      isOwner: membership.isOwner,
      employeeId: membership.employeeId,
      isDemo: isDemoOrgId(membership.orgId),
    },
    user,
    error: null,
  };
}

// The user's membership in `orgId`, or — with no org given — in their default
// org: the first (by id) they manage, else the first they work in. Ordered so
// the default never changes between requests.
async function findMembership(
  supabase: Supabase,
  userId: string,
  orgId: string | null
): Promise<Membership | null> {
  // RLS already restricts these lookups to the user's own rows; the explicit
  // filters keep behavior identical in tests and with permissive policies.
  let managerQuery = supabase
    .from("managers")
    .select("user_id, org_id, is_owner")
    .eq("user_id", userId);
  if (orgId) managerQuery = managerQuery.eq("org_id", orgId);
  const { data: managerRow } = await managerQuery.order("org_id").limit(1).maybeSingle();

  // The employee row must be in the same org as the manager row, so a user
  // who manages one org and works in another gets the right employee id.
  const employeeOrg = orgId ?? managerRow?.org_id ?? null;
  let employeeQuery = supabase
    .from("employees")
    .select("id, org_id")
    .eq("user_id", userId);
  if (employeeOrg) employeeQuery = employeeQuery.eq("org_id", employeeOrg);
  const { data: employeeRow } = await employeeQuery.order("org_id").limit(1).maybeSingle();

  const resolvedOrg: string | null = managerRow?.org_id ?? employeeRow?.org_id ?? null;
  if (!resolvedOrg) return null;
  return {
    orgId: resolvedOrg,
    isManager: Boolean(managerRow),
    isOwner: Boolean(managerRow?.is_owner),
    employeeId: employeeRow?.org_id === resolvedOrg ? (employeeRow?.id ?? null) : null,
  };
}

// Every organization the user belongs to, with its name, for the switcher.
export async function listMemberships(
  supabase: Supabase,
  userId: string
): Promise<{ id: string; name: string; isManager: boolean }[]> {
  const rows = <T,>(data: unknown) => (Array.isArray(data) ? (data as T[]) : []);
  const [{ data: managerRows }, { data: employeeRows }] = await Promise.all([
    supabase.from("managers").select("org_id").eq("user_id", userId),
    supabase.from("employees").select("org_id").eq("user_id", userId),
  ]);
  const managed = new Set(rows<{ org_id: string }>(managerRows).map((r) => r.org_id));
  const ids = [...new Set([...managed, ...rows<{ org_id: string }>(employeeRows).map((r) => r.org_id)])];
  if (ids.length === 0) return [];
  const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", ids);
  const names = new Map(rows<{ id: string; name: string }>(orgs).map((o) => [o.id, o.name]));
  return ids
    .map((id) => ({ id, name: names.get(id) ?? "Organization", isManager: managed.has(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
