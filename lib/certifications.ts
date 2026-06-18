// Pure helpers for employee certifications/credentials (food handler, alcohol
// service, first aid, …) and their expiry. Dates are plain YYYY-MM-DD strings,
// compared on a noon-UTC anchor to avoid DST/timezone edge cases (same approach
// as the rest of the domain).

export type CertStatus = "valid" | "expiring" | "expired" | "no_expiry";

// Default window (days) before expiry at which a cert is flagged "expiring".
export const DEFAULT_WARN_DAYS = 30;

export function daysUntil(expiresOn: string, today: string): number {
  const a = new Date(expiresOn.slice(0, 10) + "T12:00:00Z").getTime();
  const b = new Date(today.slice(0, 10) + "T12:00:00Z").getTime();
  return Math.round((a - b) / 86_400_000);
}

export function certificationStatus(
  expiresOn: string | null,
  today: string,
  warnDays: number = DEFAULT_WARN_DAYS
): CertStatus {
  if (!expiresOn) return "no_expiry";
  const d = daysUntil(expiresOn, today);
  if (d < 0) return "expired";
  if (d <= warnDays) return "expiring";
  return "valid";
}

export type CertSummary = {
  total: number;
  valid: number;
  expiring: number;
  expired: number;
  noExpiry: number;
  // Expiring + expired — the count a manager needs to act on.
  actionNeeded: number;
};

export function summarizeCertifications(
  certs: { expiresOn: string | null }[],
  today: string,
  warnDays: number = DEFAULT_WARN_DAYS
): CertSummary {
  const summary: CertSummary = {
    total: certs.length,
    valid: 0,
    expiring: 0,
    expired: 0,
    noExpiry: 0,
    actionNeeded: 0,
  };
  for (const c of certs) {
    switch (certificationStatus(c.expiresOn, today, warnDays)) {
      case "valid": summary.valid++; break;
      case "expiring": summary.expiring++; break;
      case "expired": summary.expired++; break;
      case "no_expiry": summary.noExpiry++; break;
    }
  }
  summary.actionNeeded = summary.expiring + summary.expired;
  return summary;
}
