import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTimezone } from "@/lib/dates";

// The org's configured IANA timezone (app_settings.timezone), falling back to
// the default when unset or invalid.
export async function getOrgTimezone(supabase: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId)
    .eq("key", "timezone");
  const rows = Array.isArray(data) ? (data as { key?: string; value?: string }[]) : [];
  return resolveTimezone(rows.find((r) => r.key === "timezone")?.value);
}
