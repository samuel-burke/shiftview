import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseClient, MOCK_USER } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: any) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

import { createClient } from "@/lib/supabase-server";

// ——— GET /api/templates ———
describe("GET /api/templates", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseClient({ user: null }) as any
    );
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-manager", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns templates list for manager", async () => {
    const templateData = [
      { id: 1, name: "Week 1", created_at: "2026-01-01", schedule_template_rows: [{ id: 1 }, { id: 2 }] },
    ];
    const templatesBuilder: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: templateData, error: null }),
    };
    const managersBuilder = makeSupabaseClient({ user: MOCK_USER, isManager: true }).from("managers");
    const supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers") return managersBuilder;
        if (table === "schedule_templates") return templatesBuilder;
        return {} as any;
      }),
    };
    vi.mocked(createClient).mockResolvedValue(supabase as any);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0].rowCount).toBe(2);
  });
});

// ——— POST /api/templates ———
describe("POST /api/templates", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns 400 for empty name", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/templates", {
      method: "POST",
      body: JSON.stringify({ name: "", rows: [{ employeeId: 1, dayOfWeek: 1, startMinutes: 480, endMinutes: 960 }] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty rows", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/templates", {
      method: "POST",
      body: JSON.stringify({ name: "My Template", rows: [] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates template and returns id", async () => {
    const insertBuilder: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 42 }, error: null }),
    };
    const rowInsertBuilder: any = {
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const supabase = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    let callCount = 0;
    vi.spyOn(supabase, "from").mockImplementation((table: string) => {
      if (table === "managers") {
        return makeSupabaseClient({ user: MOCK_USER, isManager: true }).from("managers") as any;
      }
      if (table === "schedule_templates") return insertBuilder;
      if (table === "schedule_template_rows") return rowInsertBuilder;
      return {} as any;
    });
    vi.mocked(createClient).mockResolvedValue(supabase as any);
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/templates", {
      method: "POST",
      body: JSON.stringify({
        name: "My Template",
        rows: [{ employeeId: 1, dayOfWeek: 1, startMinutes: 480, endMinutes: 960 }],
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(42);
  });
});

// ——— DELETE /api/templates/[id] ———
describe("DELETE /api/templates/[id]", () => {
  beforeEach(() => { vi.resetModules(); });

  it("deletes a template successfully", async () => {
    const templateBuilder: any = {
      select: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 1, name: "Test" }, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
    const supabase = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    vi.spyOn(supabase, "from").mockImplementation((table: string) => {
      if (table === "managers") return makeSupabaseClient({ user: MOCK_USER, isManager: true }).from("managers") as any;
      if (table === "schedule_templates") return templateBuilder;
      return {} as any;
    });
    vi.mocked(createClient).mockResolvedValue(supabase as any);
    const { DELETE } = await import("./[id]/route");
    const req = new Request("http://localhost/api/templates/1", { method: "DELETE" });
    const res = await DELETE(req, { params: { id: "1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ——— POST /api/templates/[id]/apply ———
describe("POST /api/templates/[id]/apply", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns 422 when weekStartDate is not a Monday", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const { POST } = await import("./[id]/apply/route");
    const req = new Request("http://localhost/api/templates/1/apply", {
      method: "POST",
      body: JSON.stringify({ weekStartDate: "2026-06-02" }), // Tuesday
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: { id: "1" } });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/Monday/i);
  });

  it("returns { created, skipped } correctly", async () => {
    const templateRows = [
      { employee_id: 1, day_of_week: 0, start_minutes: 480, end_minutes: 960 },
      { employee_id: 2, day_of_week: 1, start_minutes: 540, end_minutes: 1020 },
    ];
    // employee 1 already scheduled on that day
    const existingSchedules = [{ employee_id: 1, date: "2026-06-01" }];

    const supabase = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    vi.spyOn(supabase, "from").mockImplementation((table: string) => {
      if (table === "managers") return makeSupabaseClient({ user: MOCK_USER, isManager: true }).from("managers") as any;
      if (table === "schedule_templates") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 1, name: "Test Template" }, error: null }),
        } as any;
      }
      if (table === "schedule_template_rows") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: templateRows, error: null }),
        } as any;
      }
      if (table === "schedules") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: existingSchedules, error: null }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      }
      return {} as any;
    });
    vi.mocked(createClient).mockResolvedValue(supabase as any);
    const { POST } = await import("./[id]/apply/route");
    const req = new Request("http://localhost/api/templates/1/apply", {
      method: "POST",
      body: JSON.stringify({ weekStartDate: "2026-06-01" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: { id: "1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    // employee_id 1 on day_of_week 0 = 2026-06-01, already scheduled → skipped
    // employee_id 2 on day_of_week 1 = 2026-06-02 → created
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(1);
  });
});
