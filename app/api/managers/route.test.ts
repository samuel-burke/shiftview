import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const mockCreateClient = vi.mocked(createClient);

// Custom client that handles two separate queries to "managers":
// 1st call (requireManager check) returns maybeSingle result
// 2nd call (select all) returns array result
function makeManagersListClient(managerListData: any[], managerListError: any = null) {
  let callCount = 0;
  const makeBuilder = (data: any, error: any) => {
    const b: any = {};
    for (const m of ["select", "eq", "order"]) b[m] = vi.fn().mockReturnValue(b);
    b.maybeSingle = vi.fn().mockResolvedValue({ data, error });
    b.then = (resolve: any, reject: any) => Promise.resolve({ data, error }).then(resolve, reject);
    return b;
  };
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") {
        callCount++;
        if (callCount === 1) {
          // requireManager check — return single manager row
          return makeBuilder({ user_id: MOCK_USER.id }, null);
        }
        // select all managers
        return makeBuilder(managerListData, managerListError);
      }
      return makeBuilder(null, null);
    }),
  };
}

describe("GET /api/managers", () => {
  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-managers", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the list of manager user_ids for a manager", async () => {
    const managerRows = [{ user_id: MOCK_USER.id }, { user_id: "other-manager-uuid" }];
    mockCreateClient.mockResolvedValue(makeManagersListClient(managerRows) as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.managerUserIds).toContain(MOCK_USER.id);
    expect(json.managerUserIds).toContain("other-manager-uuid");
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeManagersListClient(null, { message: "db error" }) as any
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
