// Helpers that make org scoping explicit and hard to forget.
//
// Conventions every API route must follow (RLS is the backstop, not the
// primary mechanism — the admin/service-role client bypasses RLS entirely):
//   * reads/updates/deletes: chain `.eq("org_id", orgId)` immediately after
//     .select()/.update()/.delete(), or start from orgTable().
//   * inserts/upserts: wrap rows in withOrg()/withOrgAll() so org_id can never
//     be omitted or spoofed by request data.
//   * orgId always comes from getOrgContext()/requireManager(), never from the
//     request body or query string.

import type { SupabaseClient } from "@supabase/supabase-js";

export function withOrg<T extends Record<string, unknown>>(
  orgId: string,
  row: T
): T & { org_id: string } {
  return { ...row, org_id: orgId };
}

export function withOrgAll<T extends Record<string, unknown>>(
  orgId: string,
  rows: T[]
): (T & { org_id: string })[] {
  return rows.map((row) => withOrg(orgId, row));
}

// Pre-scoped accessor for the common cases. Falls back to raw builders for
// anything exotic — but the org_id filter/stamp is applied up front so the
// tenant scope is decided before any other chaining happens.
export function orgTable(
  supabase: Pick<SupabaseClient, "from">,
  table: string,
  orgId: string
) {
  return {
    select: (columns = "*") =>
      supabase.from(table).select(columns).eq("org_id", orgId),
    insert: (rows: Record<string, unknown> | Record<string, unknown>[]) =>
      supabase
        .from(table)
        .insert(
          Array.isArray(rows) ? withOrgAll(orgId, rows) : withOrg(orgId, rows)
        ),
    upsert: (
      rows: Record<string, unknown> | Record<string, unknown>[],
      options?: { onConflict?: string }
    ) =>
      supabase
        .from(table)
        .upsert(
          Array.isArray(rows) ? withOrgAll(orgId, rows) : withOrg(orgId, rows),
          options
        ),
    update: (values: Record<string, unknown>) =>
      supabase.from(table).update(values).eq("org_id", orgId),
    delete: () => supabase.from(table).delete().eq("org_id", orgId),
  };
}
