// Pure tenure / work-anniversary helpers. Dates are plain YYYY-MM-DD, compared
// on a noon-UTC anchor (consistent with the rest of the domain). Recognizing
// anniversaries is a cheap retention win, but there was no hire date to compute
// them from.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parts(d: string): { y: number; m: number; day: number } {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return { y, m, day };
}

function noonUtc(d: string): number {
  return new Date(d.slice(0, 10) + "T12:00:00Z").getTime();
}

// Full years worked as of a date.
export function tenureYears(hireDate: string, asOf: string): number {
  const h = parts(hireDate);
  const a = parts(asOf);
  let years = a.y - h.y;
  if (a.m < h.m || (a.m === h.m && a.day < h.day)) years--;
  return years;
}

// The next anniversary date on or after `asOf` (YYYY-MM-DD).
export function nextAnniversary(hireDate: string, asOf: string): string {
  const h = parts(hireDate);
  let year = parts(asOf).y;
  const candidate = `${year}-${pad(h.m)}-${pad(h.day)}`;
  if (candidate < asOf.slice(0, 10)) year++;
  return `${year}-${pad(h.m)}-${pad(h.day)}`;
}

export function daysUntilAnniversary(hireDate: string, asOf: string): number {
  return Math.round((noonUtc(nextAnniversary(hireDate, asOf)) - noonUtc(asOf)) / 86_400_000);
}

export type UpcomingAnniversary = {
  employeeId: number;
  date: string;
  daysUntil: number;
  years: number;
};

// Anniversaries falling within `withinDays`, soonest first. Employees with no
// hire date are skipped, as is a brand-new hire's zeroth anniversary (years must
// be at least 1).
export function upcomingAnniversaries(
  employees: { employeeId: number; hireDate: string | null }[],
  asOf: string,
  withinDays: number
): UpcomingAnniversary[] {
  const out: UpcomingAnniversary[] = [];
  for (const e of employees) {
    if (!e.hireDate) continue;
    const date = nextAnniversary(e.hireDate, asOf);
    const years = Number(date.slice(0, 4)) - Number(e.hireDate.slice(0, 4));
    if (years < 1) continue;
    const daysUntil = daysUntilAnniversary(e.hireDate, asOf);
    if (daysUntil <= withinDays) out.push({ employeeId: e.employeeId, date, daysUntil, years });
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil || a.employeeId - b.employeeId);
  return out;
}
