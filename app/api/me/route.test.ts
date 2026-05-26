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

const MOCK_EMPLOYEE = { id: 3, name: "Carol White" };

describe("GET /api/me", () => {
  // ── Unauthenticated ───────────────────────────────────────────────────────

  it("returns isManager: false and no employee link for unauthenticated users", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      isManager: false,
      employeeId: null,
      employeeName: null,
    });
  });

  // ── Authenticated, not a manager, no employee link ────────────────────────

  it("returns isManager: false and no employee link for authenticated non-managers with no link", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false, linkedEmployee: null }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      isManager: false,
      employeeId: null,
      employeeName: null,
    });
  });

  // ── Authenticated, not a manager, linked to an employee ───────────────────

  it("returns employeeId and employeeName when the user is linked to an employee", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: false,
        linkedEmployee: MOCK_EMPLOYEE,
      }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      isManager: false,
      employeeId: MOCK_EMPLOYEE.id,
      employeeName: MOCK_EMPLOYEE.name,
    });
  });

  // ── Manager with no employee link ─────────────────────────────────────────

  it("returns isManager: true with no employee link when manager is not in employees table", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, linkedEmployee: null }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      isManager: true,
      employeeId: null,
      employeeName: null,
    });
  });

  // ── Manager who is also an employee ───────────────────────────────────────

  it("returns isManager: true and employee data when user is both a manager and linked employee", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        linkedEmployee: MOCK_EMPLOYEE,
      }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      isManager: true,
      employeeId: MOCK_EMPLOYEE.id,
      employeeName: MOCK_EMPLOYEE.name,
    });
  });
});
