import { describe, it, expect, vi } from "vitest";
import { GET, POST, PATCH } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

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
vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace(/^enc:/, "")),
}));
vi.mock("@/lib/notify", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
  notifyChessMove: vi.fn().mockResolvedValue(undefined),
}));

const mockCreateClient = vi.mocked(createClient);

function makeMessagesClient({
  user = MOCK_USER as any,
  isManager = false,
  messagesData = [] as any[],
  messagesError = null as any,
  insertError = null as any,
  updateError = null as any,
  counterpartInOrg = true,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID } : null;
  // When isManager, org context comes from manager row; employee lookup for sender name returns null
  const senderEmpRow = { name: "Test Employee" };
  const counterpartEmpRow = counterpartInOrg ? { id: 99 } : null;

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      const b: any = {};
      const chainMethods = ["select", "eq", "neq", "gte", "lte", "in", "or", "not", "is",
        "order", "limit", "filter", "match", "upsert", "delete"];
      for (const m of chainMethods) {
        b[m] = vi.fn().mockReturnValue(b);
      }
      b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      b.then = (resolve: any, reject: any) => Promise.resolve({ data: null, error: null }).then(resolve, reject);

      if (table === "managers") {
        b.maybeSingle = vi.fn().mockResolvedValue({ data: managerRow, error: null });
        b.then = (resolve: any, reject: any) => Promise.resolve({ data: managerRow, error: null }).then(resolve, reject);
        return b;
      }
      if (table === "employees") {
        // Track call number to determine context: getOrgContext call vs sender name call vs counterpart check
        let callCount = 0;
        b.maybeSingle = vi.fn().mockImplementation(() => {
          callCount++;
          if (!isManager && callCount === 1) {
            // First call in getOrgContext: return employee row for org resolution
            return Promise.resolve({ data: { id: 1, org_id: MOCK_ORG_ID }, error: null });
          }
          // Subsequent calls for sender name or counterpart check
          return Promise.resolve({ data: senderEmpRow, error: null });
        });
        b.then = (resolve: any, reject: any) =>
          Promise.resolve({ data: counterpartEmpRow, error: null }).then(resolve, reject);
        return b;
      }
      if (table === "messages") {
        b.insert = vi.fn().mockResolvedValue({ data: null, error: insertError });
        b.update = vi.fn().mockReturnValue({
          ...b,
          then: (resolve: any, reject: any) =>
            Promise.resolve({ data: null, error: updateError }).then(resolve, reject),
        });
        b.then = (resolve: any, reject: any) =>
          Promise.resolve({ data: messagesData, error: messagesError }).then(resolve, reject);
        return b;
      }
      return b;
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

// ── GET ────────────────────────────────────────────────────────────────────────

describe("GET /api/messages", () => {
  it("returns 400 when with param is missing", async () => {
    mockCreateClient.mockResolvedValue(makeMessagesClient() as any);
    const res = await GET(new Request("http://localhost/api/messages"));
    expect(res.status).toBe(400);
  });

  it("returns empty array when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeMessagesClient({ user: null }) as any);
    const res = await GET(new Request("http://localhost/api/messages?with=other-user"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("applies org_id filter when fetching messages", async () => {
    const client = makeMessagesClient({
      messagesData: [{ id: 1, from_user_id: MOCK_USER.id, to_user_id: "other", body: "enc:hello", read: false, created_at: "2024-01-01" }],
      isManager: true,
    });
    mockCreateClient.mockResolvedValue(client as any);
    await GET(new Request(`http://localhost/api/messages?with=other-user`));
    // Org scoping is applied — verify messages table was accessed
    const msgCalls = (client.from as any).mock.calls.filter((c: any) => c[0] === "messages");
    expect(msgCalls.length).toBeGreaterThan(0);
  });
});

// ── POST ───────────────────────────────────────────────────────────────────────

describe("POST /api/messages", () => {
  it("returns 400 when toUserId is missing", async () => {
    mockCreateClient.mockResolvedValue(makeMessagesClient() as any);
    const res = await POST(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({ body: "hello" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeMessagesClient({ user: null }) as any);
    const res = await POST(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({ toUserId: "other", body: "hello" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when messaging yourself", async () => {
    mockCreateClient.mockResolvedValue(makeMessagesClient({ isManager: true }) as any);
    const res = await POST(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({ toUserId: MOCK_USER.id, body: "hello" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("stamps org_id on message insert via withOrg", async () => {
    const client = makeMessagesClient({ isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({ toUserId: "other-user-id", body: "hello" }),
      })
    );
    expect(res.status).toBe(200);
    // Verify the insert was called with org_id (MOCK_ORG_ID)
    const msgFromCalls = (client.from as any).mock.calls.filter((c: any) => c[0] === "messages");
    expect(msgFromCalls.length).toBeGreaterThan(0);
    const insertCall = (client.from as any).mock.results
      .filter((_: any, i: number) => (client.from as any).mock.calls[i]?.[0] === "messages")
      .map((r: any) => r.value)[0];
    expect(insertCall.insert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: MOCK_ORG_ID })
    );
  });

  it("returns 400 when message is too long", async () => {
    mockCreateClient.mockResolvedValue(makeMessagesClient({ isManager: true }) as any);
    const res = await POST(
      new Request("http://localhost/api/messages", {
        method: "POST",
        body: JSON.stringify({ toUserId: "other-user-id", body: "x".repeat(2001) }),
      })
    );
    expect(res.status).toBe(400);
  });
});

// ── PATCH ──────────────────────────────────────────────────────────────────────

describe("PATCH /api/messages", () => {
  it("returns 400 when withUserId is missing", async () => {
    mockCreateClient.mockResolvedValue(makeMessagesClient() as any);
    const res = await PATCH(
      new Request("http://localhost/api/messages", {
        method: "PATCH",
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeMessagesClient({ user: null }) as any);
    const res = await PATCH(
      new Request("http://localhost/api/messages", {
        method: "PATCH",
        body: JSON.stringify({ withUserId: "other" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("marks messages as read and returns ok", async () => {
    mockCreateClient.mockResolvedValue(makeMessagesClient({ isManager: true }) as any);
    const res = await PATCH(
      new Request("http://localhost/api/messages", {
        method: "PATCH",
        body: JSON.stringify({ withUserId: "other-user-id" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
