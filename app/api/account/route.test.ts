import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { writeAuditLog } from "@/lib/audit";
import { makeQueryBuilder } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
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
const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockWriteAuditLog = vi.mocked(writeAuditLog);

const MOCK_USER = { id: "user-123", email: "person@test.com" };
const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

function makeServerClient(user: any = MOCK_USER) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

// Admin client where each table resolves to its own configurable result; the
// builders are recorded so tests can assert on the calls made against them.
function makeAdminClient({
  ownedOrgs = [] as { org_id: string }[],
  managerOrgs = [] as { org_id: string }[],
  employeeOrgs = [] as { org_id: string }[],
  managersDeleteError = null as any,
  deleteUserError = null as any,
} = {}) {
  const builders: Record<string, any> = {};

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === "managers") {
      // First call pattern filters on is_owner; subsequent calls are the
      // membership read and the delete. Distinguish via .eq tracking.
      let isOwnerFilter = false;
      let isDelete = false;
      const b = makeQueryBuilder({ data: managerOrgs, error: null });
      const origDelete = b.delete;
      b.delete = vi.fn().mockImplementation((...args: any[]) => {
        isDelete = true;
        return origDelete(...args);
      });
      b.eq = vi.fn().mockImplementation((column: string, value: unknown) => {
        if (column === "is_owner" && value === true) isOwnerFilter = true;
        return b;
      });
      b.then = (resolve: any, reject: any) => {
        const result = isDelete
          ? { data: null, error: managersDeleteError }
          : { data: isOwnerFilter ? ownedOrgs : managerOrgs, error: null };
        return Promise.resolve(result).then(resolve, reject);
      };
      builders.managers = builders.managers ?? [];
      builders.managers.push(b);
      return b;
    }
    const b = makeQueryBuilder({
      data: table === "employees" ? employeeOrgs : null,
      error: null,
    });
    builders[table] = builders[table] ?? [];
    builders[table].push(b);
    return b;
  });

  return {
    from,
    builders,
    auth: {
      admin: {
        deleteUser: vi.fn().mockResolvedValue({ data: null, error: deleteUserError }),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateClient.mockResolvedValue(makeServerClient() as any);
  mockCreateAdminClient.mockReturnValue(makeAdminClient() as any);
  mockWriteAuditLog.mockResolvedValue(undefined);
});

describe("DELETE /api/account — auth", () => {
  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeServerClient(null) as any);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("returns 409 when the user owns an organization", async () => {
    const admin = makeAdminClient({ ownedOrgs: [{ org_id: ORG_A }] });
    mockCreateAdminClient.mockReturnValue(admin as any);

    const res = await DELETE();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("own an organization") });
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("returns 409 when the owner trigger blocks the manager-row delete (race)", async () => {
    const admin = makeAdminClient({
      managersDeleteError: { message: "the organization owner cannot be removed" },
    });
    mockCreateAdminClient.mockReturnValue(admin as any);

    const res = await DELETE();

    expect(res.status).toBe(409);
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/account — deletion", () => {
  it("unlinks employee rows, removes roles and personal data, and deletes the auth user", async () => {
    const admin = makeAdminClient({
      managerOrgs: [{ org_id: ORG_A }],
      employeeOrgs: [{ org_id: ORG_A }, { org_id: ORG_B }],
    });
    mockCreateAdminClient.mockReturnValue(admin as any);

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });

    // Employee rows are unlinked, never deleted: org records must survive.
    const employeesBuilders = admin.builders.employees ?? [];
    const updateBuilder = employeesBuilders.find((b: any) => b.update.mock.calls.length > 0);
    expect(updateBuilder.update).toHaveBeenCalledWith({ user_id: null });
    expect(updateBuilder.eq).toHaveBeenCalledWith("user_id", MOCK_USER.id);
    for (const b of employeesBuilders) expect(b.delete).not.toHaveBeenCalled();

    const managersDelete = (admin.builders.managers ?? []).find(
      (b: any) => b.delete.mock.calls.length > 0
    );
    expect(managersDelete).toBeDefined();

    expect(admin.builders.push_subscriptions?.[0].delete).toHaveBeenCalled();
    expect(admin.builders.user_notification_preferences?.[0].delete).toHaveBeenCalled();
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(MOCK_USER.id);
  });

  it("writes an account.delete audit log for every org the user belonged to", async () => {
    const admin = makeAdminClient({
      managerOrgs: [{ org_id: ORG_A }],
      employeeOrgs: [{ org_id: ORG_A }, { org_id: ORG_B }],
    });
    mockCreateAdminClient.mockReturnValue(admin as any);

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(2);
    const orgIds = mockWriteAuditLog.mock.calls.map((c) => c[0].orgId).sort();
    expect(orgIds).toEqual([ORG_A, ORG_B]);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account.delete", actorId: MOCK_USER.id })
    );
  });

  it("returns 500 when the auth user deletion fails", async () => {
    const admin = makeAdminClient({ deleteUserError: { message: "boom" } });
    mockCreateAdminClient.mockReturnValue(admin as any);

    const res = await DELETE();

    expect(res.status).toBe(500);
  });
});
