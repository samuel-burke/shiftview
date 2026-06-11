import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

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

const MOCK_DB_SCHEDULES = [
  { id: 1, employee_id: 3, date: "2026-05-26", start_minutes: 480, end_minutes: 960 },
];
const MOCK_SCHEDULES = [
  { id: 1, employeeId: 3, date: "2026-05-26", startMinutes: 480, endMinutes: 960 },
];
const MOCK_EMPLOYEE = { id: 3, name: "Carol White" };

const URL_BASE = "http://localhost/api/my-schedule";
const VALID_URL = `${URL_BASE}?from=2026-05-24&to=2026-05-30`;

describe("GET /api/my-schedule", () => {
  it("returns 400 when from/to params are missing", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient() as any);
    const res = await GET(new Request(URL_BASE));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "from and to params required" });
  });

  it("returns 400 for invalid date format", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient() as any);
    const res = await GET(new Request(`${URL_BASE}?from=bad&to=2026-05-30`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "dates must be YYYY-MM-DD" });
  });

  it("returns 400 when from is after to", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient() as any);
    const res = await GET(new Request(`${URL_BASE}?from=2026-05-30&to=2026-05-24`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "from must not be after to" });
  });

  it("accepts from === to (single day)", async () => {
    const client = makeSupabaseClient({ user: null, queryData: [] });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request(`${URL_BASE}?from=2026-05-24&to=2026-05-24`));
    expect(res.status).toBe(200);
  });

  it("returns demo fixture schedules for unauthenticated users without querying Supabase", async () => {
    const client = makeSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request(VALID_URL));
    expect(res.status).toBe(200);
    expect(client.from).not.toHaveBeenCalledWith("schedules_demo");
    const json = await res.json();
    expect(json.employeeId).toBe(1);
    expect(json.employeeName).toBeNull();
    expect(Array.isArray(json.schedules)).toBe(true);
  });

  it("returns empty schedules when authenticated user has no linked employee", async () => {
    // isManager: true so org resolution succeeds (MOCK_ORG_ID from manager row),
    // but linkedEmployee: null means no employee record → employeeId = null → empty schedules
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, linkedEmployee: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request(VALID_URL));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ employeeId: null, employeeName: null, schedules: [] });
  });

  it("returns schedules mapped to camelCase for authenticated user", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      linkedEmployee: MOCK_EMPLOYEE,
      queryData: MOCK_DB_SCHEDULES,
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request(VALID_URL));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.employeeName).toBe(MOCK_EMPLOYEE.name);
    expect(json.employeeId).toBe(MOCK_EMPLOYEE.id);
    expect(json.schedules).toEqual(MOCK_SCHEDULES);
  });

  it("queries schedules (not demo) for authenticated users", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      linkedEmployee: MOCK_EMPLOYEE,
      queryData: MOCK_DB_SCHEDULES,
    });
    mockCreateClient.mockResolvedValue(client as any);
    await GET(new Request(VALID_URL));
    expect(client.from).toHaveBeenCalledWith("schedules");
  });

  it("returns 500 on database error", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      linkedEmployee: MOCK_EMPLOYEE,
      queryError: { message: "db error" },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request(VALID_URL));
    expect(res.status).toBe(500);
  });

  it("scopes schedules query to org_id", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      linkedEmployee: MOCK_EMPLOYEE,
      queryData: MOCK_DB_SCHEDULES,
    });
    mockCreateClient.mockResolvedValue(client as any);
    await GET(new Request(VALID_URL));
    // Find any schedules builder and confirm eq was called with org_id
    const calls = (client.from as any).mock.calls;
    const results = (client.from as any).mock.results;
    const scheduleIdx = calls.findIndex((c: string[]) => c[0] === "schedules");
    if (scheduleIdx >= 0) {
      expect(results[scheduleIdx].value.eq).toHaveBeenCalledWith("org_id", MOCK_ORG_ID);
    }
  });
});
