// Pay rates are for managers. The API roles can't select employees.pay_rate
// (migration 0042); employee_pay_rates(org) returns an org's current rates to
// its managers and nothing to anyone else (0041, reading the history since
// 0061).
//
// Rate history (0061): employee_pay_rates rows are effective-dated. The rule,
// shared with the database's pay_rate_on():
//   * the rate for an hour of work is the one in effect on the store-local
//     date that hour was worked. A shift that crosses midnight into a new
//     rate's effective date is paid the old rate before midnight and the new
//     one after it;
//   * a position rate (position_id set) in effect that day wins for hours in
//     that position, whatever the base rate is doing;
//   * otherwise the base rate (position_id null) in effect that day;
//   * a base row with a null rate means "no rate from this date"; no row at
//     all also means no rate. Hours with no rate are reported as such, never
//     costed at $0.

import { fetchAllRows } from "@/lib/fetch-all-rows";

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
type TableClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export const PAY_RATES_RPC = "employee_pay_rates";
export const PAYROLL_IDS_RPC = "employee_payroll_ids";
export const PAY_RATE_HISTORY_TABLE = "employee_pay_rates";
// The effective date the migration gives each rate that existed before it.
export const RATE_BEGINNING = "1900-01-01";

export function payRatesQuery(supabase: RpcClient, orgId: string) {
  return supabase.rpc(PAY_RATES_RPC, { p_org: orgId });
}

// Employee id → hourly rate (null when none is set).
export function toPayRateMap(data: unknown): Map<number, number | null> {
  const rates = new Map<number, number | null>();
  if (!Array.isArray(data)) return rates;
  for (const r of data as { employee_id: unknown; pay_rate: unknown }[]) {
    rates.set(Number(r.employee_id), r.pay_rate == null ? null : Number(r.pay_rate));
  }
  return rates;
}

// On error, rates is empty and error is set.
export async function loadPayRates(
  supabase: RpcClient,
  orgId: string
): Promise<{ rates: Map<number, number | null>; error: unknown }> {
  const { data, error } = await payRatesQuery(supabase, orgId);
  return { rates: toPayRateMap(error ? null : data), error: error ?? null };
}

// Employee id → payroll ID (managers only, through employee_payroll_ids).
export async function loadPayrollIds(
  supabase: RpcClient,
  orgId: string
): Promise<{ ids: Map<number, string | null>; error: unknown }> {
  const { data, error } = await supabase.rpc(PAYROLL_IDS_RPC, { p_org: orgId });
  const ids = new Map<number, string | null>();
  if (!error && Array.isArray(data)) {
    for (const r of data as { employee_id: unknown; payroll_id: unknown }[]) {
      ids.set(Number(r.employee_id), typeof r.payroll_id === "string" && r.payroll_id ? r.payroll_id : null);
    }
  }
  return { ids, error: error ?? null };
}

export type PayRateRow = {
  id?: number;
  employeeId: number;
  positionId: number | null;
  effectiveFrom: string; // YYYY-MM-DD, store-local
  hourlyRate: number | null;
};

export const PAY_RATE_COLUMNS = "id, employee_id, position_id, effective_from, hourly_rate";

export function toPayRateRows(data: unknown): PayRateRow[] {
  if (!Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id == null ? undefined : Number(r.id),
    employeeId: Number(r.employee_id),
    positionId: r.position_id == null ? null : Number(r.position_id),
    effectiveFrom: String(r.effective_from).slice(0, 10),
    hourlyRate: r.hourly_rate == null ? null : Number(r.hourly_rate),
  }));
}

// Every rate row of the org (RLS: managers only), paged past the API's row cap.
export async function loadPayRateHistory(
  supabase: TableClient,
  orgId: string
): Promise<{ rows: PayRateRow[]; error: unknown }> {
  const { data, error, truncated } = await fetchAllRows((first, last) =>
    supabase
      .from(PAY_RATE_HISTORY_TABLE)
      .select(PAY_RATE_COLUMNS)
      .eq("org_id", orgId)
      .order("employee_id")
      .order("effective_from")
      .order("id")
      .range(first, last)
  );
  if (error) return { rows: [], error };
  if (truncated) return { rows: [], error: new Error("Too many pay-rate rows") };
  return { rows: toPayRateRows(data), error: null };
}

export type RateInEffect = {
  rate: number | null;
  // The rate came from a position rate, not the base rate.
  positionRate: boolean;
};

export type RateLookup = (employeeId: number, day: string, positionId?: number | null) => RateInEffect;

// The lookup over a set of rate rows (see the rule at the top of this file).
export function makeRateLookup(rows: PayRateRow[]): RateLookup {
  const byEmployee = new Map<number, PayRateRow[]>();
  for (const r of rows) {
    if (!byEmployee.has(r.employeeId)) byEmployee.set(r.employeeId, []);
    byEmployee.get(r.employeeId)!.push(r);
  }
  // Newest first, so the first row on or before a day is the one in effect.
  for (const list of byEmployee.values()) list.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  return (employeeId, day, positionId = null) => {
    const list = byEmployee.get(employeeId) ?? [];
    if (positionId != null) {
      const pos = list.find((r) => r.positionId === positionId && r.effectiveFrom <= day);
      if (pos && pos.hourlyRate != null) return { rate: pos.hourlyRate, positionRate: true };
    }
    const base = list.find((r) => r.positionId == null && r.effectiveFrom <= day);
    return { rate: base?.hourlyRate ?? null, positionRate: false };
  };
}

// A lookup that gives each employee one rate on every day: what the reports
// used before rate history (and what they fall back to if it can't be read
// because migration 0061 hasn't run).
export function constantRateLookup(rates: Map<number, number | null>): RateLookup {
  return (employeeId) => ({ rate: rates.get(employeeId) ?? null, positionRate: false });
}

// "No such table" from Postgres or PostgREST's schema cache: the database
// predates migration 0061.
const UNDEFINED_TABLE = ["42P01", "PGRST205"];

// The history when it exists; the current single rates when the database
// predates 0061 (so a deploy that lands first keeps working).
export async function loadRateLookup(
  supabase: TableClient & RpcClient,
  orgId: string
): Promise<{ lookup: RateLookup; error: unknown }> {
  const history = await loadPayRateHistory(supabase, orgId);
  if (!history.error) {
    // Employees without any history row (none, after 0061's backfill) keep
    // the rate employee_pay_rates(org) reports.
    return { lookup: makeRateLookup(history.rows), error: null };
  }
  const code = (history.error as { code?: string } | null)?.code;
  if (!code || !UNDEFINED_TABLE.includes(code)) return { lookup: () => ({ rate: null, positionRate: false }), error: history.error };
  const { rates, error } = await loadPayRates(supabase, orgId);
  return { lookup: constantRateLookup(rates), error };
}

// Money in whole cents, from hours in hundredths, a rate and a multiplier.
// Integer arithmetic, so 0.1 + 0.2 never shows up on a pay stub; half a cent
// rounds up.
const MULTIPLIERS: Record<string, [number, number]> = { "1": [1, 1], "1.5": [3, 2], "2": [2, 1] };
export function payCents(hundredthsOfHours: number, rate: number, multiplier: 1 | 1.5 | 2 = 1): number {
  const [num, den] = MULTIPLIERS[String(multiplier)];
  const rateCents = Math.round(rate * 100);
  return Math.round((hundredthsOfHours * rateCents * num) / (100 * den));
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

// Splits a whole number of units (cents, hundredths of an hour) across parts
// in proportion to `weights`, so the parts add up to exactly `total`: each
// gets its floor, and the leftovers go to the largest remainders (earliest
// first on ties).
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map((x) => Math.floor(x + 1e-9));
  let left = total - out.reduce((s, x) => s + x, 0);
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x + 1e-9) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}
