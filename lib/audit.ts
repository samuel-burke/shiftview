import { createAdminClient } from "@/lib/supabase-admin";

export async function writeAuditLog(entry: {
  action: string;
  actorId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("audit_logs").insert({
      action:        entry.action,
      actor_id:      entry.actorId ?? null,
      resource_type: entry.resourceType ?? null,
      resource_id:   entry.resourceId != null ? String(entry.resourceId) : null,
      before:        entry.before ?? null,
      after:         entry.after ?? null,
      metadata:      entry.metadata ?? null,
    });
  } catch (e) {
    console.error("[audit]", e);
  }
}
