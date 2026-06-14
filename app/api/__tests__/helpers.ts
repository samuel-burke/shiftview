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
  // The org's owner (managers.is_owner), when one exists. Queries that filter
  // on is_owner resolve to this row instead of the caller's membership row.
  ownerUserId = null as string | null,
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
    isManager && user
      ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: ownerUserId === user.id }
      : null;
  const ownerRow = ownerUserId
    ? { user_id: ownerUserId, org_id: MOCK_ORG_ID, is_owner: true }
    : null;
  // Org-aware code resolves the caller's org from the employees row; default
  // org_id in so existing tests don't have to specify it.
  const employeeRow =
    linkedEmployee != null ? { org_id: MOCK_ORG_ID, ...linkedEmployee } : linkedEmployee;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") {
        // eq-aware: an .eq("is_owner", true) filter switches the result to
        // the owner row, mirroring the real per-query semantics.
        let isOwnerFilter = false;
        const rowFor = () => (isOwnerFilter ? ownerRow : managerRow);
        const b = makeQueryBuilder({ data: managerRow, error: null });
        b.eq = vi.fn().mockImplementation((column: string, value: unknown) => {
          if (column === "is_owner" && value === true) isOwnerFilter = true;
          return b;
        });
        b.maybeSingle = vi.fn().mockImplementation(async () => ({ data: rowFor(), error: null }));
        b.single = vi.fn().mockImplementation(async () => ({ data: rowFor(), error: null }));
        b.then = (resolve: any, reject: any) => {
          const row = rowFor();
          return Promise.resolve({ data: row ? [row] : [], error: null }).then(resolve, reject);
        };
        return b;
      }
      if (table === "employees" && linkedEmployee !== undefined)
        return makeQueryBuilder({ data: employeeRow, error: null });
      if (tableOverrides[table] !== undefined)
        return makeQueryBuilder(tableOverrides[table]);
      return makeQueryBuilder({ data: queryData, error: queryError });
    }),
    rpc: vi.fn().mockResolvedValue({ data: rpcData, error: rpcError }),
  };
}
