// Pure cash-drawer (till) helpers: total a denomination count and compute the
// over/short variance against the expected amount. All money is whole cents.

export const DENOMINATIONS = {
  hundred: 10000,
  fifty: 5000,
  twenty: 2000,
  ten: 1000,
  five: 500,
  one: 100,
  quarter: 25,
  dime: 10,
  nickel: 5,
  penny: 1,
} as const;

export type Denomination = keyof typeof DENOMINATIONS;
export type DenominationCounts = Partial<Record<Denomination, number>>;

// Total a denomination count to cents. Unknown keys and missing denominations
// contribute nothing.
export function countTotal(counts: DenominationCounts): number {
  let total = 0;
  for (const key of Object.keys(DENOMINATIONS) as Denomination[]) {
    total += DENOMINATIONS[key] * (counts[key] ?? 0);
  }
  return total;
}

export type TillStatus = "balanced" | "over" | "short";

export function tillVariance(expectedCents: number, countedCents: number): { varianceCents: number; status: TillStatus } {
  const varianceCents = countedCents - expectedCents;
  const status: TillStatus = varianceCents === 0 ? "balanced" : varianceCents > 0 ? "over" : "short";
  return { varianceCents, status };
}

export const TILL_TYPES = ["open", "close"] as const;
export type TillType = (typeof TILL_TYPES)[number];

export type TillValidation =
  | { valid: true; value: { type: TillType; expectedCents: number; countedCents: number } }
  | { valid: false; error: string };

export function validateTillCount(input: {
  type?: unknown;
  expectedCents?: unknown;
  countedCents?: unknown;
}): TillValidation {
  if (!TILL_TYPES.includes(input.type as TillType))
    return { valid: false, error: "type must be 'open' or 'close'" };
  for (const [label, v] of [["expectedCents", input.expectedCents], ["countedCents", input.countedCents]] as const) {
    if (!Number.isInteger(v) || (v as number) < 0)
      return { valid: false, error: `${label} must be a non-negative integer (cents)` };
  }
  return {
    valid: true,
    value: { type: input.type as TillType, expectedCents: input.expectedCents as number, countedCents: input.countedCents as number },
  };
}
