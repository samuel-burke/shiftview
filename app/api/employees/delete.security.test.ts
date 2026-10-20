import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { MOCK_ORG_ID, MOCK_USER } from "../__tests__/helpers";

// Regressions:
//  * Deleting an employee who had ever called out or claimed an open shift
//    failed (500) after their shifts had already been deleted, leaving them on
//    the roster with no schedule (fixed by 0052: one atomic delete).
//  * Deleting an employee erased their punches, punch corrections and time
//    off: time cards the FLSA requires us to keep (fixed by 0054: removing
//    someone archives them).
// The route now writes nothing itself: employee_remove archives or deletes in
// one transaction, and the database refuses to delete anyone with time records.

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200 }),
  },
}));

// A fake database that records every write the route makes.
function fakeDb(rpc: { data: unknown; error: { code?: string; message: string } | null }) {
  const writes: string[] = [];
  const from = vi.fn((table: string) => {
    const b: any = {};
    for (const m of ["select", "eq", "order", "limit", "is", "in"]) b[m] = vi.fn(() => b);
    for (const m of ["delete", "update", "insert", "upsert"])
      b[m] = vi.fn(() => { writes.push(`${m} ${table}`); return b; });
    const result = () => {
      if (table === "managers") return { data: { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID, is_owner: false }, error: null };
      if (table === "employees") return { data: { id: 7, user_id: null, name: "Dana", email: null }, error: null };
      return { data: null, error: null };
    };
    b.maybeSingle = vi.fn(async () => result());
    b.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
    return b;
  });
  return {
    writes,
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) },
      from,
      rpc: vi.fn().mockResolvedValue(rpc),
    },
  };
}

function deleteReq() {
  return new Request("http://localhost/api/employees", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: 7 }),
  });
}

describe("DELETE /api/employees keeps time records", () => {
  beforeEach(() => {
    vi.mocked(createAdminClient).mockReturnValue({} as never);
  });

  it("archives through employee_remove and deletes nothing itself", async () => {
    const db = fakeDb({ data: "archived", error: null });
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const res = await DELETE(deleteReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: true });
    expect(db.client.rpc).toHaveBeenCalledWith("employee_remove", { p_org: MOCK_ORG_ID, p_employee: 7 });
    expect(db.writes).toEqual([]);
  });

  it("a mistaken add with no history is deleted by the same one call", async () => {
    const db = fakeDb({ data: "deleted", error: null });
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const res = await DELETE(deleteReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: false });
    expect(db.writes).toEqual([]);
  });

  it("a punch arriving mid-delete (foreign key refusal): 409 and nothing changed", async () => {
    const db = fakeDb({ data: null, error: { code: "23503", message: "violates foreign key constraint" } });
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const res = await DELETE(deleteReq());
    expect(res.status).toBe(409);
    expect(db.writes).toEqual([]);
  });

  it("any other database error: 500 and nothing changed", async () => {
    const db = fakeDb({ data: null, error: { message: "db error" } });
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    const res = await DELETE(deleteReq());
    expect(res.status).toBe(500);
    expect(db.writes).toEqual([]);
  });
});
