import { vi } from "vitest";

export const MOCK_USER = { id: "user-123", email: "manager@test.com" };

function makeQueryBuilder(result: { data: any; error: any }) {
  const b: any = {};
  for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "gte", "lte", "order"]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue(result);
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
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id } : null;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers")
        return makeQueryBuilder({ data: managerRow, error: null });
      if (table === "employees" && linkedEmployee !== undefined)
        return makeQueryBuilder({ data: linkedEmployee, error: null });
      if (tableOverrides[table] !== undefined)
        return makeQueryBuilder(tableOverrides[table]);
      return makeQueryBuilder({ data: queryData, error: queryError });
    }),
  };
}
