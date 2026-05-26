import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient } from "../__tests__/helpers";

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

const MOCK_DB_ROWS = [
  { day_of_week: 0, open_minutes: 480, close_minutes: 1200 },
  { day_of_week: 1, open_minutes: 360, close_minutes: 1320 },
];

const EXPECTED_MAPPED = {
  0: { open: 480, close: 1200 },
  1: { open: 360, close: 1320 },
};

describe("GET /api/store-hours", () => {
  it("returns store hours keyed by day of week", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ queryData: MOCK_DB_ROWS }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EXPECTED_MAPPED);
  });

  it("maps snake_case DB fields to open/close", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ queryData: MOCK_DB_ROWS }) as any
    );
    const res = await GET();
    const body = await res.json();
    expect(body[0]).toHaveProperty("open", 480);
    expect(body[0]).toHaveProperty("close", 1200);
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ queryError: { message: "db error" } }) as any
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
