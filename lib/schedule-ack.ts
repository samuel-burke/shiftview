// Pure helpers for schedule acknowledgements: an employee confirming they've
// seen their published shifts for a week. Managers use the confirmed/pending
// split to chase down anyone who hasn't looked — the cheapest no-show insurance.

export type ScheduledEmployee = { employeeId: number; employeeName: string };
export type AckRow = { employeeId: number; acknowledgedAt: string };

export type ConfirmedRow = ScheduledEmployee & { acknowledgedAt: string };

export type AckStatus = {
  confirmed: ConfirmedRow[];
  pending: ScheduledEmployee[];
  confirmedCount: number;
  pendingCount: number;
  // True only when at least one person is scheduled and all have acknowledged.
  allConfirmed: boolean;
};

export function isAcknowledged(employeeId: number, acks: AckRow[]): boolean {
  return acks.some((a) => a.employeeId === employeeId);
}

// Partition the employees scheduled for a week into those who have acknowledged
// and those who haven't. Scheduled employees are deduped (multiple shifts → one
// row) and both lists are name-sorted; acks for unscheduled employees are
// ignored.
export function splitAckStatus(
  scheduled: ScheduledEmployee[],
  acks: AckRow[]
): AckStatus {
  const ackAt = new Map(acks.map((a) => [a.employeeId, a.acknowledgedAt]));

  const seen = new Map<number, ScheduledEmployee>();
  for (const e of scheduled) {
    if (!seen.has(e.employeeId)) seen.set(e.employeeId, e);
  }
  const unique = [...seen.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const confirmed: ConfirmedRow[] = [];
  const pending: ScheduledEmployee[] = [];
  for (const e of unique) {
    const at = ackAt.get(e.employeeId);
    if (at != null) confirmed.push({ ...e, acknowledgedAt: at });
    else pending.push(e);
  }

  return {
    confirmed,
    pending,
    confirmedCount: confirmed.length,
    pendingCount: pending.length,
    allConfirmed: unique.length > 0 && pending.length === 0,
  };
}
