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

const MOCK_EMPLOYEES = [
  { id: 1, name: "Alice Smith" },
  { id: 2, name: "Bob Jones" },
];

describe("GET /api/employees", () => {
  it("queries employees_demo for unauthenticated users", async () => {
    const client = makeSupabaseClient({ user: null, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith("employees_demo");
  });

  it("queries employees for authenticated users", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith("employees");
  });

  it("returns the employee list", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryData: MOCK_EMPLOYEES });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(await res.json()).toEqual(MOCK_EMPLOYEES);
  });

  it("returns 500 on database error", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryError: { message: "db error" } });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/employees"));
    expect(res.status).toBe(500);
  });
});
