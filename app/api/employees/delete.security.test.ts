import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { MOCK_ORG_ID, MOCK_USER } from "../__tests__/helpers";

// Regression: deleting an employee who had ever called out or claimed an open
// shift failed with a foreign key error (500) after their shifts had already
// been deleted, leaving them on the roster with no schedule. Migration 0052
// makes the history cascade; the route now deletes the employee row first and
// never removes shifts when the delete can't finish.

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200 }),
  },
}));

const FK = { code: "23503", message: "violates foreign key constraint" };

// A fake database that records each write. `migrated` says whether 0052 has
// run; `history` lists the rows that block an employee delete before it.
function fakeDb({
  migrated = false,
  history = [] as ("callouts" | "open_shift_claims" | "open_shifts")[],
  employeeDeleteError = null as { code?: string; message: string } | null,
}) {
  const writes: string[] = [];
  let schedulesLeft = true;
  const from = vi.fn((table: string) => {
    let op = "select";
    let head = false;
    const b: any = {};
    for (const m of ["eq", "order", "limit"]) b[m] = vi.fn(() => b);
    b.select = vi.fn((_cols?: string, opts?: { head?: boolean }) => {
      if (opts?.head) head = true;
      return b;
    });
    b.delete = vi.fn(() => { op = "delete"; return b; });
    const result = () => {
      if (table === "managers") return { data: { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID, is_owner: false }, error: null };
      if (op === "select" && table === "employees") return { data: { id: 7, user_id: null, name: "Dana", email: null }, error: null };
      if (op === "select" && head) return { data: null, count: history.includes(table as never) ? 1 : 0, error: null };
      if (op === "delete" && table === "schedules") {
        writes.push("delete schedules");
        schedulesLeft = false;
        return { data: null, error: null };
      }
      if (op === "delete" && table === "employees") {
        if (employeeDeleteError) return { data: null, error: employeeDeleteError };
        const blocked = !migrated && (schedulesLeft || history.length > 0);
        if (blocked) return { data: null, error: FK };
        writes.push("delete employee");
        return { data: [{ id: 7 }], error: null };
      }
      return { data: null, error: null };
    };
    b.maybeSingle = vi.fn(async () => result());
    b.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
    return b;
  });
  return {
    writes,
    client: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) }, from },
  };
}

function deleteReq() {
  return new Request("http://localhost/api/employees", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: 7 }),
  });
}

describe("DELETE /api/employees keeps a failed delete from losing shifts", () => {
  beforeEach(() => {
    vi.mocked(createAdminClient).mockReturnValue({} as never);
  });

  it("after 0052: one delete of the employee row, shifts cascade with it", async () => {
    const db = fakeDb({ migrated: true, history: ["callouts", "open_shift_claims", "open_shifts"] });
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const res = await DELETE(deleteReq());
    expect(res.status).toBe(200);
    expect(db.writes).toEqual(["delete employee"]);
  });

  it("before 0052, no other history: removes shifts, then the employee", async () => {
    const db = fakeDb({ migrated: false });
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const res = await DELETE(deleteReq());
    expect(res.status).toBe(200);
    expect(db.writes).toEqual(["delete schedules", "delete employee"]);
  });

  for (const table of ["callouts", "open_shift_claims", "open_shifts"] as const) {
    it(`before 0052, with ${table} history: 409 and the shifts are kept`, async () => {
      const db = fakeDb({ migrated: false, history: [table] });
      vi.mocked(createClient).mockResolvedValue(db.client as never);
      const res = await DELETE(deleteReq());
      expect(res.status).toBe(409);
      expect(db.writes).toEqual([]);
    });
  }

  it("any other database error: 500 and nothing deleted", async () => {
    const db = fakeDb({ migrated: true, employeeDeleteError: { message: "db error" } });
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const res = await DELETE(deleteReq());
    expect(res.status).toBe(500);
    expect(db.writes).toEqual([]);
  });
});
