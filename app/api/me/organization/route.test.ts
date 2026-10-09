import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeQueryBuilder, MOCK_USER } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));

const mockCreateClient = vi.mocked(createClient);
const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";

// The user manages ORG_A and works in ORG_B.
function client(user: typeof MOCK_USER | null = MOCK_USER) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return makeQueryBuilder({ data: [{ org_id: ORG_A }], error: null });
      if (table === "employees") return makeQueryBuilder({ data: [{ org_id: ORG_B }], error: null });
      return makeQueryBuilder({ data: [{ id: ORG_A, name: "Alder" }, { id: ORG_B, name: "Birch" }], error: null });
    }),
  };
}

function post(body: unknown, url = "https://shiftview.app/api/me/organization") {
  return new Request(url, { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/me/organization", () => {
  it("remembers an org the user belongs to in a secure, http-only cookie", async () => {
    mockCreateClient.mockResolvedValue(client() as any);
    const res = await POST(post({ orgId: ORG_B }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`sv_org=${ORG_B}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("secure");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it("refuses an org the user doesn't belong to", async () => {
    mockCreateClient.mockResolvedValue(client() as any);
    const res = await POST(post({ orgId: "00000000-0000-0000-0000-0000000000ff" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("requires a session and an orgId", async () => {
    mockCreateClient.mockResolvedValue(client(null) as any);
    expect((await POST(post({ orgId: ORG_A }))).status).toBe(401);
    mockCreateClient.mockResolvedValue(client() as any);
    expect((await POST(post({}))).status).toBe(400);
  });
});
