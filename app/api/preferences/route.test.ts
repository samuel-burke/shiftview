import { describe, it, expect, vi } from "vitest";
import { GET, PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_ORG_ID, MOCK_USER } from "../__tests__/helpers";

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

const ROW = {
  employee_id: 1,
  preferred_shift_types: ["opener"],
  preferred_days: [2, 1],
  avoid_days: [0],
  desired_weekly_hours: "24.0",
  note: "Mornings please",
  updated_at: "2026-10-01T12:00:00Z",
};

const MAPPED = {
  employeeId: 1,
  preferredShiftTypes: ["opener"],
  preferredDays: [1, 2],
  avoidDays: [0],
  desiredWeeklyHours: 24,
  note: "Mornings please",
  updatedAt: "2026-10-01T12:00:00Z",
};

function employeeClient(prefs: { data: any; error: any } = { data: ROW, error: null }) {
  return makeSupabaseClient({
    user: MOCK_USER,
    linkedEmployee: { id: 1, name: "Alice Smith", user_id: MOCK_USER.id },
    tableOverrides: { employee_preferences: prefs },
  });
}

function managerClient(prefs: { data: any; error: any } = { data: ROW, error: null }, linkedEmployee: any = { id: 2, name: "Bob Jones" }) {
  return makeSupabaseClient({
    user: MOCK_USER,
    isManager: true,
    linkedEmployee,
    tableOverrides: { employee_preferences: prefs },
  });
}

function builderFor(client: ReturnType<typeof makeSupabaseClient>, table: string) {
  const calls = (client.from as ReturnType<typeof vi.fn>).mock.calls;
  const idx = calls.findIndex((c: string[]) => c[0] === table);
  return (client.from as ReturnType<typeof vi.fn>).mock.results[idx].value;
}

// ── GET ──────────────────────────────────────────────────────────────────────

describe("GET /api/preferences", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await GET(new Request("http://localhost/api/preferences?employeeId=1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid employeeId", async () => {
    mockCreateClient.mockResolvedValue(employeeClient() as any);
    const res = await GET(new Request("http://localhost/api/preferences?employeeId=abc"));
    expect(res.status).toBe(400);
  });

  it("returns an employee's own preferences", async () => {
    const client = employeeClient();
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/preferences?employeeId=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(MAPPED);
    expect(builderFor(client, "employee_preferences").eq).toHaveBeenCalledWith("org_id", MOCK_ORG_ID);
  });

  it("returns empty preferences when none are saved", async () => {
    mockCreateClient.mockResolvedValue(employeeClient({ data: null, error: null }) as any);
    const res = await GET(new Request("http://localhost/api/preferences?employeeId=1"));
    expect(await res.json()).toEqual({
      employeeId: 1, preferredShiftTypes: [], preferredDays: [], avoidDays: [],
      desiredWeeklyHours: null, note: null, updatedAt: null,
    });
  });

  it("returns 403 when an employee reads a coworker's preferences", async () => {
    mockCreateClient.mockResolvedValue(employeeClient() as any);
    const res = await GET(new Request("http://localhost/api/preferences?employeeId=2"));
    expect(res.status).toBe(403);
  });

  it("lets a manager read anyone's preferences", async () => {
    mockCreateClient.mockResolvedValue(managerClient() as any);
    const res = await GET(new Request("http://localhost/api/preferences?employeeId=1"));
    expect(res.status).toBe(200);
  });

  it("lists every saved preference for a manager", async () => {
    mockCreateClient.mockResolvedValue(managerClient({ data: [ROW], error: null }) as any);
    const res = await GET(new Request("http://localhost/api/preferences"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([MAPPED]);
  });

  it("returns 403 when a non-manager lists everyone's preferences", async () => {
    mockCreateClient.mockResolvedValue(employeeClient() as any);
    const res = await GET(new Request("http://localhost/api/preferences"));
    expect(res.status).toBe(403);
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(employeeClient({ data: null, error: { message: "boom" } }) as any);
    const res = await GET(new Request("http://localhost/api/preferences?employeeId=1"));
    expect(res.status).toBe(500);
  });
});

// ── PUT ──────────────────────────────────────────────────────────────────────

describe("PUT /api/preferences", () => {
  function putReq(body: unknown) {
    return new Request("http://localhost/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const BODY = {
    employeeId: 1,
    preferredShiftTypes: ["opener"],
    preferredDays: [1, 2],
    avoidDays: [0],
    desiredWeeklyHours: 24,
    note: "Mornings please",
  };

  it("returns 400 without a valid employeeId", async () => {
    mockCreateClient.mockResolvedValue(employeeClient() as any);
    expect((await PUT(putReq({ ...BODY, employeeId: "1" }))).status).toBe(400);
  });

  it("returns 400 for invalid preferences", async () => {
    mockCreateClient.mockResolvedValue(employeeClient() as any);
    const res = await PUT(putReq({ ...BODY, avoidDays: [1] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/both preferred and avoided/);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    expect((await PUT(putReq(BODY))).status).toBe(401);
  });

  it("returns 403 when an employee saves a coworker's preferences", async () => {
    mockCreateClient.mockResolvedValue(employeeClient() as any);
    expect((await PUT(putReq({ ...BODY, employeeId: 2 }))).status).toBe(403);
  });

  it("saves an employee's own preferences, org-scoped", async () => {
    const client = employeeClient();
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PUT(putReq(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(MAPPED);
    const upsert = builderFor(client, "employee_preferences").upsert as ReturnType<typeof vi.fn>;
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: MOCK_ORG_ID,
        employee_id: 1,
        preferred_shift_types: ["opener"],
        preferred_days: [1, 2],
        avoid_days: [0],
        desired_weekly_hours: 24,
        note: "Mornings please",
      }),
      { onConflict: "org_id,employee_id" }
    );
  });

  it("lets a manager save anyone's preferences", async () => {
    mockCreateClient.mockResolvedValue(managerClient() as any);
    expect((await PUT(putReq({ ...BODY, employeeId: 2 }))).status).toBe(200);
  });

  it("returns 404 for an employee outside the org", async () => {
    mockCreateClient.mockResolvedValue(managerClient(undefined, null) as any);
    expect((await PUT(putReq({ ...BODY, employeeId: 99 }))).status).toBe(404);
  });

  it("returns 500 when saving fails", async () => {
    mockCreateClient.mockResolvedValue(employeeClient({ data: null, error: { message: "boom" } }) as any);
    expect((await PUT(putReq(BODY))).status).toBe(500);
  });
});
