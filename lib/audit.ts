import { createAdminClient } from "@/lib/supabase-admin";

export type AuditEntry = {
  action: string;
  orgId: string;
  actorId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

function toRow(entry: AuditEntry) {
  return {
    action:        entry.action,
    org_id:        entry.orgId,
    actor_id:      entry.actorId ?? null,
    resource_type: entry.resourceType ?? null,
    resource_id:   entry.resourceId != null ? String(entry.resourceId) : null,
    before:        entry.before ?? null,
    after:         entry.after ?? null,
    metadata:      entry.metadata ?? null,
  };
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("audit_logs").insert(toRow(entry));
  } catch (e) {
    console.error("[audit]", e);
  }
}

// Several entries in one insert, for jobs that change many rows at once.
export async function writeAuditLogs(entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const admin = createAdminClient();
    await admin.from("audit_logs").insert(entries.map(toRow));
  } catch (e) {
    console.error("[audit]", e);
  }
}
