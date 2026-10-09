// Pay rates are for managers. The API roles can't select employees.pay_rate
// (migration 0042); employee_pay_rates(org) returns an org's rates to its
// managers and nothing to anyone else (0041).

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export const PAY_RATES_RPC = "employee_pay_rates";

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
