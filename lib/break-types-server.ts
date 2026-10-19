import { BREAK_TYPE_COLUMNS, toBreakType, type BreakType, type BreakTypeRow } from "@/lib/break-rules";

type QueryClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

// Every break type of the org, archived ones included (old punches name them).
export async function loadBreakTypes(supabase: QueryClient, orgId: string): Promise<{ types: BreakType[]; error: unknown }> {
  const { data, error } = await supabase
    .from("break_types")
    .select(BREAK_TYPE_COLUMNS)
    .eq("org_id", orgId)
    .order("sort_order")
    .order("id");
  if (error) return { types: [], error };
  return { types: ((data ?? []) as BreakTypeRow[]).map(toBreakType), error: null };
}
