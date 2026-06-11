import { vi } from "vitest";

export const MOCK_USER = { id: "user-123", email: "manager@test.com" };

// Matches DEFAULT_ORG_ID in lib/org-context.ts so org assertions in tests can
// use a stable value.
export const MOCK_ORG_ID = "00000000-0000-0000-0000-000000000001";

export function makeQueryBuilder(result: { data: any; error: any }) {
  const b: any = {};
  for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "gte", "lte", "order"]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.single = vi.fn().mockResolvedValue(result);
  b.limit = vi.fn().mockReturnValue(b);
  b.range = vi.fn().mockReturnValue(b);
  b.like = vi.fn().mockReturnValue(b);
  b.in = vi.fn().mockReturnValue(b);
  b.or = vi.fn().mockReturnValue(b);
  // Makes the builder thenable so `await builder.chain()` works
  b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return b;
}

export function makeSupabaseClient({
  user = null as any,
  isManager = false,
  // When explicitly set (even to null), used for `from("employees")` lookups.
  // When omitted (undefined), `from("employees")` falls through to queryData/queryError.
  linkedEmployee = undefined as Record<string, unknown> | null | undefined,
  queryData = null as any,
  queryError = null as any,
  tableOverrides = {} as Record<string, { data: any; error: any }>,
  rpcData = null as any,
  rpcError = null as any,
} = {}) {
  const managerRow =
    isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID } : null;
  // Org-aware code resolves the caller's org from the employees row; default
  // org_id in so existing tests don't have to specify it.
  const employeeRow =
    linkedEmployee != null ? { org_id: MOCK_ORG_ID, ...linkedEmployee } : linkedEmployee;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers")
        return makeQueryBuilder({ data: managerRow, error: null });
      if (table === "employees" && linkedEmployee !== undefined)
        return makeQueryBuilder({ data: employeeRow, error: null });
      if (tableOverrides[table] !== undefined)
        return makeQueryBuilder(tableOverrides[table]);
      return makeQueryBuilder({ data: queryData, error: queryError });
    }),
    rpc: vi.fn().mockResolvedValue({ data: rpcData, error: rpcError }),
  };
}
