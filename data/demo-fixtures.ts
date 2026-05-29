import type { Employee, Schedule } from "./types";

export const DEMO_EMPLOYEES: Employee[] = [
  { id: 1, name: "Alice Smith" },
  { id: 2, name: "Bob Jones" },
  { id: 3, name: "Carol White" },
];

// Weekly shift pattern per employee: day-of-week (0=Sun) → [startMinutes, endMinutes] | null
const EMPLOYEE_PATTERNS: Record<number, Array<[number, number] | null>> = {
  1: [null, [360, 840],  [360, 840],  [360, 840],  [360, 840],  [360, 840],  null],  // Mon–Fri 6am–2pm
  2: [null, [540, 1020], [540, 1020], null,         [540, 1020], [540, 1020], [540, 1020]], // Mon/Tue/Thu/Fri/Sat 9am–5pm
  3: [[720, 1200], null, [720, 1200], [720, 1200],  [720, 1200], [720, 1200], [720, 1200]], // Sun/Tue–Sat 12pm–8pm
};

export function getDemoSchedulesForDate(date: string): Schedule[] {
  const dow = new Date(date + "T12:00:00Z").getUTCDay();
  const results: Schedule[] = [];
  let id = 9000;
  for (const emp of DEMO_EMPLOYEES) {
    const shift = EMPLOYEE_PATTERNS[emp.id][dow];
    if (shift) {
      results.push({ id: id++, employeeId: emp.id, date, startMinutes: shift[0], endMinutes: shift[1] });
    }
  }
  return results;
}

// Mon–Fri 9 AM–9 PM (540–1260), Sat–Sun 10 AM–6 PM (600–1080)
export const DEMO_STORE_HOURS: Record<number, { open: number; close: number }> = {
  0: { open: 600, close: 1080 },
  1: { open: 540, close: 1260 },
  2: { open: 540, close: 1260 },
  3: { open: 540, close: 1260 },
  4: { open: 540, close: 1260 },
  5: { open: 540, close: 1260 },
  6: { open: 600, close: 1080 },
};

export const DEMO_SETTINGS = {
  optimalCoverage: 3,
  minCoverage: 2,
  firstDayOfWeek: 1,
};

export function getDemoSchedulesForEmployee(employeeId: number, from: string, to: string): Schedule[] {
  const results: Schedule[] = [];
  let id = 9000;
  const cur = new Date(from + "T12:00:00Z");
  const end = new Date(to + "T12:00:00Z");
  while (cur <= end) {
    const dow = cur.getUTCDay();
    const date = cur.toISOString().slice(0, 10);
    const shift = EMPLOYEE_PATTERNS[employeeId]?.[dow];
    if (shift) {
      results.push({ id: id++, employeeId, date, startMinutes: shift[0], endMinutes: shift[1] });
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return results;
}
