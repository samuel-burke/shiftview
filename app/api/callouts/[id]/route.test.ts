import { describe, it, expect, vi } from "vitest";
import { DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

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

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const req = () => new Request("http://localhost/api/callouts/1", { method: "DELETE" });

describe("DELETE /api/callouts/[id]", () => {
  it("returns 400 for a non-integer id", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await DELETE(req(), makeParams("abc"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await DELETE(req(), makeParams("1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the call-out does not exist", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        tableOverrides: { callouts: { data: null, error: null } },
      }) as any
    );
    const res = await DELETE(req(), makeParams("1"));
    expect(res.status).toBe(404);
  });

  it("lets a manager rescind any call-out", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        tableOverrides: { callouts: { data: { id: 1, employee_id: 5, date: "2099-06-15" }, error: null } },
      }) as any
    );
    const res = await DELETE(req(), makeParams("1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("lets an employee rescind their own call-out", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: false,
        linkedEmployee: { id: 5, name: "Alice Smith" },
        tableOverrides: { callouts: { data: { id: 1, employee_id: 5, date: "2099-06-15" }, error: null } },
      }) as any
    );
    const res = await DELETE(req(), makeParams("1"));
    expect(res.status).toBe(200);
  });

  it("returns 403 when an employee tries to rescind someone else's call-out", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: false,
        linkedEmployee: { id: 5, name: "Alice Smith" },
        tableOverrides: { callouts: { data: { id: 1, employee_id: 999, date: "2099-06-15" }, error: null } },
      }) as any
    );
    const res = await DELETE(req(), makeParams("1"));
    expect(res.status).toBe(403);
  });

  it("scopes the delete to org_id", async () => {
    const calloutEqArgs: [string, unknown][] = [];
    const client: any = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
      from: vi.fn().mockImplementation((table: string) => {
        const b: any = {};
        for (const m of ["select", "delete", "order", "limit"]) b[m] = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockImplementation((col: string, _val: unknown) => {
          if (table === "callouts") calloutEqArgs.push([col, _val]);
          return b;
        });
        b.maybeSingle = vi.fn().mockResolvedValue({
          data:
            table === "managers"
              ? { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID }
              : table === "callouts"
                ? { id: 1, employee_id: 5, date: "2099-06-15" }
                : null,
          error: null,
        });
        b.then = (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve);
        return b;
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);
    await DELETE(req(), makeParams("1"));
    expect(calloutEqArgs.some(([col]) => col === "org_id")).toBe(true);
  });
});
