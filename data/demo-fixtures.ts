import type { Employee, Schedule, AvailabilityRecord } from "./types";

export const DEMO_EMPLOYEES: Employee[] = [
  { id: 1, name: "Jordan Martinez", email: "jordan@demo.com",  user_id: "demo-manager"  },
  { id: 2, name: "Casey Lewis",     email: "casey@demo.com",   user_id: "demo-user-2"   },
  { id: 3, name: "Alex Rivera",     email: "alex@demo.com",    user_id: null             },
  { id: 4, name: "Sam Kim",         email: "sam@demo.com",     user_id: "demo-user-4"   },
  { id: 5, name: "Morgan Brooks",   email: "morgan@demo.com",  user_id: "demo-user-5"   },
  { id: 6, name: "Taylor Nguyen",                              user_id: null             },
];

export const DEMO_MANAGER_USER_IDS = new Set(["demo-manager", "demo-user-2"]);

// Weekly shift pattern per employee: day-of-week (0=Sun) → [startMinutes, endMinutes] | null
const EMPLOYEE_PATTERNS: Record<number, Array<[number, number] | null>> = {
  1: [null,        [360, 840],  [360, 840],  [360, 840],  [360, 840],  [360, 840],  null       ], // Mon–Fri 6am–2pm (opener)
  2: [null,        [540, 1020], [540, 1020], null,         [540, 1020], [540, 1020], [540, 1020]], // Mon/Tue/Thu/Fri/Sat 9am–5pm
  3: [[720, 1200], null,        [720, 1200], [720, 1200],  [720, 1200], [720, 1200], [720, 1200]], // Sun/Tue–Sat 12pm–8pm (closer)
  4: [null,        [480, 960],  [480, 960],  [480, 960],   null,        [480, 960],  [480, 960] ], // Mon/Tue/Wed/Fri/Sat 8am–4pm
  5: [[600, 1080], null,        null,         [600, 1080], [600, 1080], [600, 1080], [600, 1080]], // Sun/Wed–Sat 10am–6pm
  6: [null,        null,        [660, 1140], [660, 1140],  [660, 1140], [660, 1140], [660, 1140]], // Tue–Sat 11am–7pm
};

export const DEMO_AVAILABILITY: Record<number, AvailabilityRecord[]> = {
  1: [
    { id: 9001, dayOfWeek: 0, startMinutes: null, endMinutes: null, note: "Unavailable Sundays" },
    { id: 9002, dayOfWeek: 6, startMinutes: null, endMinutes: null, note: "Weekend family time" },
  ],
  2: [
    { id: 9003, dayOfWeek: 3, startMinutes: null, endMinutes: null, note: "Night class Wednesdays" },
  ],
  3: [
    { id: 9004, dayOfWeek: 1, startMinutes: null, endMinutes: null, note: "Unavailable Mondays" },
    { id: 9005, dayOfWeek: 5, startMinutes: 720, endMinutes: 1260, note: "Prefer noon starts Fridays" },
  ],
  4: [
    { id: 9006, dayOfWeek: 4, startMinutes: null, endMinutes: null, note: "Doctor appts Thursdays" },
    { id: 9007, dayOfWeek: 0, startMinutes: null, endMinutes: null, note: "Unavailable Sundays" },
  ],
  5: [],
  6: [
    { id: 9008, dayOfWeek: 1, startMinutes: 600, endMinutes: 1080, note: "School mornings Mon" },
    { id: 9009, dayOfWeek: 2, startMinutes: 600, endMinutes: 1080, note: "School mornings Tue" },
  ],
};

export const DEMO_SETTINGS = {
  coverageAlertsEnabled: true,
  firstDayOfWeek: 1,
  timezone: "America/New_York",
  emailNotifications: false,
  manualPunchesEnabled: true,
  gpsRequired: false,
  geofenceEnabled: false,
  geofenceLat: null as number | null,
  geofenceLng: null as number | null,
  geofenceRadius: 100,
  geofenceAddress: null as string | null,
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

// Demo coverage curves — weekday curve peaks at lunch, weekend is flatter.
export const DEMO_COVERAGE_PROFILES = [
  {
    id: 1,
    name: "Weekday",
    blocks: [
      { startMinutes: 540, endMinutes: 720, headcount: 2 },   // 9 AM–12 PM
      { startMinutes: 720, endMinutes: 1080, headcount: 3 },  // 12 PM–6 PM
      { startMinutes: 1080, endMinutes: 1260, headcount: 2 }, // 6 PM–9 PM
    ],
  },
  {
    id: 2,
    name: "Weekend",
    blocks: [
      { startMinutes: 600, endMinutes: 1080, headcount: 3 },  // 10 AM–6 PM
    ],
  },
];

// dayOfWeek → profileId: weekends use the Weekend curve, weekdays the Weekday curve.
export const DEMO_COVERAGE_DEFAULTS: Record<number, number> = {
  0: 2, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2,
};

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
