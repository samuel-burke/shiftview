// The demo tenant. Demo visitors authenticate anonymously (POST /api/demo/start)
// and become managers of this organization; all data lives in real tables,
// scoped and isolated exactly like any customer org. See docs/DEMO_ORG.md.

// Must match the org seeded by supabase/migrations/0006_demo_org.sql.
export const DEMO_ORG_ID = "00000000-0000-0000-0000-000000000002";

// Side-effect guard: routes and libs use this to suppress anything that
// leaves the database (email, web push, auth invites) for demo traffic.
// Guards must only ever suppress side effects — never relax org scoping.
export function isDemoOrgId(orgId: string): boolean {
  return orgId === DEMO_ORG_ID;
}

// The seeded employee that POST /api/demo/start links the current visitor to,
// so "My Schedule" and the clock page work in the demo. Looked up by email
// because employee ids are identity-generated per seed run.
export const DEMO_MANAGER_EMAIL = "jordan@example.com";
