import { describe, it, expect, vi } from "vitest";
import { getOrgContext, listMemberships, readCookie, ORG_COOKIE, ORG_HEADER } from "./org-context";

const USER = { id: "user-1" };
const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const ORG_C = "00000000-0000-0000-0000-00000000000c";

type Row = Record<string, unknown>;

// A tiny in-memory stand-in for the Supabase query builder: eq / in filters,
// order and limit are applied for real, so the org-selection logic is tested
// against actual rows rather than canned answers.
function fakeClient(tables: Record<string, Row[]>, user: { id: string } | null = USER) {
  function query(table: string) {
    let rows = [...(tables[table] ?? [])];
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return q; },
      in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return q; },
      order: (col: string) => { rows.sort((a, b) => String(a[col]).localeCompare(String(b[col]))); return q; },
      limit: (n: number) => { rows = rows.slice(0, n); return q; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return q;
  }
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn().mockImplementation(query),
  } as any;
}

function req(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/me", { headers });
}

// Manages B, works in A and C (and also in B).
const MULTI = {
  managers: [{ user_id: USER.id, org_id: ORG_B, is_owner: false }],
  employees: [
    { id: 11, user_id: USER.id, org_id: ORG_A },
    { id: 12, user_id: USER.id, org_id: ORG_B },
    { id: 13, user_id: USER.id, org_id: ORG_C },
  ],
  organizations: [
    { id: ORG_A, name: "Alder Street" },
    { id: ORG_B, name: "Birch Lane" },
    { id: ORG_C, name: "Cedar Mall" },
  ],
};

describe("getOrgContext", () => {
  it("defaults to the first org the user manages, with their employee row there", async () => {
    const { ctx } = await getOrgContext(fakeClient(MULTI), req());
    expect(ctx).toMatchObject({ orgId: ORG_B, isManager: true, employeeId: 12 });
  });

  it("defaults to the first org they work in when they manage none", async () => {
    const { ctx } = await getOrgContext(fakeClient({ ...MULTI, managers: [] }), req());
    expect(ctx).toMatchObject({ orgId: ORG_A, isManager: false, employeeId: 11 });
  });

  it("uses the org picked in the switcher", async () => {
    const { ctx } = await getOrgContext(fakeClient(MULTI), req({ cookie: `theme=dark; ${ORG_COOKIE}=${ORG_C}` }));
    expect(ctx).toMatchObject({ orgId: ORG_C, isManager: false, employeeId: 13 });
  });

  it("falls back to the default when the picked org is no longer theirs", async () => {
    const other = "00000000-0000-0000-0000-0000000000ff";
    const { ctx, error } = await getOrgContext(fakeClient(MULTI), req({ cookie: `${ORG_COOKIE}=${other}` }));
    expect(error).toBeNull();
    expect(ctx).toMatchObject({ orgId: ORG_B });
  });

  it("the header beats the cookie, and a header for a foreign org is refused", async () => {
    const both = await getOrgContext(fakeClient(MULTI), req({ [ORG_HEADER]: ORG_A, cookie: `${ORG_COOKIE}=${ORG_C}` }));
    expect(both.ctx).toMatchObject({ orgId: ORG_A });
    const foreign = await getOrgContext(fakeClient(MULTI), req({ [ORG_HEADER]: "00000000-0000-0000-0000-0000000000ff" }));
    expect(foreign.error).toBe("No organization membership");
  });

  it("reports no membership and not-authenticated", async () => {
    expect((await getOrgContext(fakeClient({}), req())).error).toBe("No organization membership");
    expect((await getOrgContext(fakeClient(MULTI, null), req())).error).toBe("Not authenticated");
  });
});

describe("listMemberships", () => {
  it("lists every org once, by name, marking the ones they manage", async () => {
    expect(await listMemberships(fakeClient(MULTI) as never, USER.id)).toEqual([
      { id: ORG_A, name: "Alder Street", isManager: false },
      { id: ORG_B, name: "Birch Lane", isManager: true },
      { id: ORG_C, name: "Cedar Mall", isManager: false },
    ]);
  });

  it("is empty for a user with no memberships", async () => {
    expect(await listMemberships(fakeClient({}) as never, USER.id)).toEqual([]);
  });
});

describe("readCookie", () => {
  it("finds one cookie among several", () => {
    expect(readCookie("a=1; sv_org=abc; b=2", "sv_org")).toBe("abc");
    expect(readCookie("a=1", "sv_org")).toBeNull();
    expect(readCookie(null, "sv_org")).toBeNull();
  });
});
