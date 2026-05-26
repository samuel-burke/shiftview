import { vi } from "vitest";

export const MOCK_USER = { id: "user-123", email: "manager@test.com" };

function makeQueryBuilder(result: { data: any; error: any }) {
  const b: any = {};
  for (const m of ["select", "insert", "update", "delete", "eq", "order"]) {
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
  queryData = null as any,
  queryError = null as any,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id } : null;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) =>
      makeQueryBuilder(
        table === "managers"
          ? { data: managerRow, error: null }
          : { data: queryData, error: queryError }
      )
    ),
  };
}
