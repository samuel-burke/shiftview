import type { SupabaseClient } from "@supabase/supabase-js";
import { CoverageBlock } from "./coverage";

/**
 * Resolves the target coverage curve for a date server-side:
 * date override first, then day-of-week default, else no curve.
 */
export async function getCurveForDate(supabase: SupabaseClient, orgId: string, date: string): Promise<CoverageBlock[]> {
  const dow = new Date(date + "T12:00:00").getDay();

  const { data: override } = await supabase
    .from("coverage_date_overrides")
    .select("profile_id")
    .eq("org_id", orgId)
    .eq("date", date)
    .maybeSingle();

  let profileId: number | null = override?.profile_id ?? null;

  if (profileId === null) {
    const { data: dayDefault } = await supabase
      .from("coverage_day_defaults")
      .select("profile_id")
      .eq("org_id", orgId)
      .eq("day_of_week", dow)
      .maybeSingle();
    profileId = dayDefault?.profile_id ?? null;
  }

  if (profileId === null) return [];

  const { data: blocks } = await supabase
    .from("coverage_profile_blocks")
    .select("start_minutes, end_minutes, headcount")
    .eq("profile_id", profileId)
    .order("start_minutes");

  return (blocks ?? []).map((b) => ({
    startMinutes: b.start_minutes,
    endMinutes:   b.end_minutes,
    headcount:    b.headcount,
  }));
}
