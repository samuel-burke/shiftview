// Pure sales-per-labor-hour (SPLH) math — the canonical retail/hospitality
// productivity metric: how much revenue each scheduled labor hour produced.
// Money in whole cents, labor in minutes.

// Cents of sales per labor hour, or null when there are no labor hours.
export function salesPerLaborHour(salesCents: number, laborMinutes: number): number | null {
  if (laborMinutes <= 0) return null;
  return Math.round((salesCents * 60) / laborMinutes);
}

export type SalesAmountResult = { valid: true; value: number } | { valid: false; error: string };

export function validateSalesAmount(amountCents: unknown): SalesAmountResult {
  if (!Number.isInteger(amountCents) || (amountCents as number) < 0)
    return { valid: false, error: "amountCents must be a non-negative integer" };
  return { valid: true, value: amountCents as number };
}

export function formatCentsPerHour(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}/hr`;
}
