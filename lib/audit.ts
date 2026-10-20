import { createAdminClient } from "@/lib/supabase-admin";

// Never throws. Resolves false when the row wasn't written, so a caller that
// cares can say so in its own log.
export async function writeAuditLog(entry: {
  action: string;
  orgId: string;
  actorId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      action:        entry.action,
      org_id:        entry.orgId,
      actor_id:      entry.actorId ?? null,
      resource_type: entry.resourceType ?? null,
      resource_id:   entry.resourceId != null ? String(entry.resourceId) : null,
      before:        entry.before ?? null,
      after:         entry.after ?? null,
      metadata:      entry.metadata ?? null,
    });
    // supabase-js reports a failed insert in `error` rather than throwing.
    if (error) {
      console.error("[audit]", entry.action, error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[audit]", entry.action, e);
    return false;
  }
}
