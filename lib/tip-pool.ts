// Pure tip-pool allocation: split a pooled tip amount (in whole cents) across
// participants in proportion to a weight (typically minutes worked). Uses the
// largest-remainder method so every cent is distributed and the parts sum
// exactly to the pool — important for money.

export type TipParticipant = { employeeId: number; weightMinutes: number };
export type TipShare = { employeeId: number; cents: number };

export function allocateTips(poolCents: number, participants: TipParticipant[]): TipShare[] {
  if (participants.length === 0) return [];

  const totalWeight = participants.reduce((s, p) => s + Math.max(0, p.weightMinutes), 0);
  if (totalWeight <= 0 || poolCents <= 0) {
    return participants.map((p) => ({ employeeId: p.employeeId, cents: 0 }));
  }

  // Floor each share, tracking the fractional remainder for tie-breaking.
  const raw = participants.map((p, index) => {
    const exact = (poolCents * Math.max(0, p.weightMinutes)) / totalWeight;
    const floor = Math.floor(exact);
    return { index, employeeId: p.employeeId, cents: floor, frac: exact - floor };
  });

  // Hand out the remaining cents to the largest fractional parts.
  let remaining = poolCents - raw.reduce((s, r) => s + r.cents, 0);
  const byFrac = [...raw].sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let i = 0; i < byFrac.length && remaining > 0; i++) {
    byFrac[i].cents += 1;
    remaining--;
  }

  return raw.map((r) => ({ employeeId: r.employeeId, cents: r.cents }));
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
