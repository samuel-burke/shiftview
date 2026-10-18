// What pricing punched hours needs besides the punches: the rate history, the
// position of each shift the punches were clocked in for, position names and
// payroll IDs. Manager-only reads (RLS and the manager-checked functions of
// migrations 0041 and 0061); callers check the manager first.

import { fetchAllRows } from "@/lib/fetch-all-rows";
import { loadPayrollIds, loadRateLookup, type RateLookup } from "@/lib/pay-rates";

type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type PayContext = {
  rates: RateLookup;
  positionBySchedule: Map<number, number | null>;
  positionNames: Map<number, string>;
  payrollIds: Map<number, string | null>;
};

// Schedule ids per .in() request: keeps the URL short.
const ID_CHUNK = 200;

export async function loadPayContext(
  supabase: Client,
  orgId: string,
  scheduleIds: Iterable<number | null | undefined>,
): Promise<{ ctx: PayContext | null; error: unknown }> {
  const ids = [...new Set([...scheduleIds].filter((x): x is number => typeof x === "number"))].sort((a, b) => a - b);

  const [rates, payrollIds, positions] = await Promise.all([
    loadRateLookup(supabase, orgId),
    loadPayrollIds(supabase, orgId),
    fetchAllRows((first, last) =>
      supabase.from("positions").select("id, name").eq("org_id", orgId).order("id").range(first, last)
    ),
  ]);
  if (rates.error) return { ctx: null, error: rates.error };
  // Payroll IDs come with 0061; before it (no such function), exports go
  // out without them.
  const pidCode = (payrollIds.error as { code?: string } | null)?.code;
  if (payrollIds.error && pidCode !== "42883" && pidCode !== "PGRST202") return { ctx: null, error: payrollIds.error };
  const payrollIdMap = payrollIds.error ? new Map<number, string | null>() : payrollIds.ids;
  if (positions.error) return { ctx: null, error: positions.error };

  const positionBySchedule = new Map<number, number | null>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data, error } = await fetchAllRows((first, last) =>
      supabase.from("schedules").select("id, position_id").eq("org_id", orgId).in("id", chunk).order("id").range(first, last)
    );
    if (error) return { ctx: null, error };
    for (const s of data as { id: number; position_id: number | null }[]) {
      positionBySchedule.set(Number(s.id), s.position_id == null ? null : Number(s.position_id));
    }
  }

  const positionNames = new Map<number, string>();
  for (const p of positions.data as { id: number; name: string }[]) positionNames.set(Number(p.id), p.name);

  return { ctx: { rates: rates.lookup, positionBySchedule, positionNames, payrollIds: payrollIdMap }, error: null };
}
