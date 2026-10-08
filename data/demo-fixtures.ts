// Single source of truth for WHAT the demo organization contains. These
// fixtures are no longer served from API fallbacks — lib/demo-seed.ts turns
// them into real rows in the demo org (see docs/DEMO_ORG.md).
import type { Employee, AvailabilityRecord } from "./types";

export const DEMO_EMPLOYEES: Employee[] = [
  { id: 1,  name: "Jordan Martinez", email: "jordan@example.com",  user_id: "demo-manager"  },
  { id: 2,  name: "Casey Lewis",     email: "casey@example.com",   user_id: "demo-user-2"   },
  { id: 3,  name: "Alex Rivera",     email: "alex@example.com",    user_id: null             },
  { id: 4,  name: "Sam Kim",         email: "sam@example.com",     user_id: "demo-user-4"   },
  { id: 5,  name: "Morgan Brooks",   email: "morgan@example.com",  user_id: "demo-user-5"   },
  { id: 6,  name: "Taylor Nguyen",                                 user_id: null             },
  { id: 7,  name: "Riley Chen",      email: "riley@example.com",   user_id: null             },
  { id: 8,  name: "Dakota Patel",    email: "dakota@example.com",  user_id: null             },
  { id: 9,  name: "Jamie Flores",    email: "jamie@example.com",   user_id: null             },
  { id: 10, name: "Avery Johnson",   email: "avery@example.com",   user_id: null             },
  { id: 11, name: "Quinn O'Brien",   email: "quinn@example.com",   user_id: null             },
  { id: 12, name: "Harper Singh",                                  user_id: null             },
];

// The published week, per employee: day-of-week (0=Sun) → [startMinutes, endMinutes] | null.
// Built like a real schedule for this store: inside store hours, exactly on
// the coverage target every 15 minutes (266 h, the budget), and within each
// person's availability, weekly hours and days (data/demo-fixtures.test.ts
// checks all of it). Weekdays run two 9–5 openers, a 9–1 opener, a 12–6 mid,
// a 1–9 closer and two 5–9 closers; weekends three 10–6 shifts and a 10–2.
export const EMPLOYEE_PATTERNS: Record<number, Array<[number, number] | null>> = {
  1:  [null,        [540, 1020], [540, 1020], [540, 1020], [540, 1020], [540, 1020], null       ], // Mon–Fri 9am–5pm (manager)
  2:  [null,        [720, 1080], [720, 1080], null,        [720, 1080], [720, 1080], [600, 1080]], // Mon/Tue/Thu/Fri 12–6pm, Sat 10am–6pm
  3:  [null,        null,        [780, 1260], [780, 1260], [780, 1260], [780, 1260], null       ], // Tue–Fri 1–9pm (closer)
  4:  [null,        [540, 1020], [540, 1020], [540, 1020], null,        [540, 1020], null       ], // Mon/Tue/Wed/Fri 9am–5pm
  5:  [[600, 1080], null,        null,        [720, 1080], [540, 1020], null,        [600, 1080]], // Wed 12–6pm, Thu 9am–5pm, weekends 10am–6pm
  6:  [null,        null,        null,        [1020, 1260], [1020, 1260], [1020, 1260], null      ], // Wed–Fri 5–9pm
  7:  [[600, 1080], [1020, 1260], null,       null,        null,        null,        null       ], // Sun 10am–6pm, Mon 5–9pm
  8:  [null,        [1020, 1260], [1020, 1260], [1020, 1260], null,      null,        null       ], // Mon–Wed 5–9pm
  9:  [[600, 840],  null,        [540, 780],  null,        null,        [540, 780],  [600, 840] ], // Tue/Fri 9am–1pm, weekends 10am–2pm
  10: [null,        [540, 780],  null,        [540, 780],  [540, 780],  null,        null       ], // Mon/Wed/Thu 9am–1pm
  11: [null,        [780, 1260], [1020, 1260], null,       [1020, 1260], [1020, 1260], null      ], // Mon 1–9pm, Tue/Thu/Fri 5–9pm
  12: [[600, 1080], null,        null,        null,        null,        null,        [600, 1080]], // weekends 10am–6pm
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
    { id: 9008, dayOfWeek: 1, startMinutes: 780, endMinutes: 1260, note: "School mornings Mon" },
    { id: 9009, dayOfWeek: 2, startMinutes: 780, endMinutes: 1260, note: "School mornings Tue" },
  ],
  8: [
    { id: 9010, dayOfWeek: 4, startMinutes: null, endMinutes: null, note: "Band practice Thursdays" },
    { id: 9011, dayOfWeek: 5, startMinutes: null, endMinutes: null, note: "Unavailable Fridays" },
  ],
  9: [
    { id: 9012, dayOfWeek: 1, startMinutes: null, endMinutes: null, note: "Unavailable Mondays" },
  ],
  10: [
    { id: 9017, dayOfWeek: 1, startMinutes: 480, endMinutes: 1020, note: "School pickup at 5:30 PM" },
    { id: 9018, dayOfWeek: 2, startMinutes: 480, endMinutes: 1020, note: "School pickup at 5:30 PM" },
    { id: 9019, dayOfWeek: 3, startMinutes: 480, endMinutes: 1020, note: "School pickup at 5:30 PM" },
    { id: 9020, dayOfWeek: 4, startMinutes: 480, endMinutes: 1020, note: "School pickup at 5:30 PM" },
    { id: 9021, dayOfWeek: 5, startMinutes: 480, endMinutes: 1020, note: "School pickup at 5:30 PM" },
  ],
  11: [
    { id: 9013, dayOfWeek: 1, startMinutes: 780, endMinutes: 1320, note: "Afternoons only" },
    { id: 9014, dayOfWeek: 2, startMinutes: 780, endMinutes: 1320, note: "Afternoons only" },
  ],
  12: [
    { id: 9015, dayOfWeek: 1, startMinutes: null, endMinutes: null, note: "Weekends only" },
    { id: 9022, dayOfWeek: 2, startMinutes: null, endMinutes: null, note: "Weekends only" },
    { id: 9016, dayOfWeek: 3, startMinutes: null, endMinutes: null, note: "Weekends only" },
    { id: 9023, dayOfWeek: 4, startMinutes: null, endMinutes: null, note: "Weekends only" },
    { id: 9024, dayOfWeek: 5, startMinutes: null, endMinutes: null, note: "Weekends only" },
  ],
};

// Employment type, weekly limits and hourly pay for the Week page's
// Auto-schedule (Settings → Team → Scheduling) and labor cost. Limits left out
// use the org defaults for the type (full-time 32–40 h, part-time 0–29 h).
// Riley has no type, so Auto-schedule's readiness check has something to
// point out.
export const DEMO_EMPLOYMENT: Record<
  number,
  { type: "full_time" | "part_time" | null; minHours?: number; maxHours?: number; maxDays?: number; payRate: number }
> = {
  1:  { type: "full_time", payRate: 22.5 },
  2:  { type: "full_time", payRate: 19 },
  3:  { type: "full_time", payRate: 18.5 },
  4:  { type: "full_time", payRate: 18 },
  5:  { type: "full_time", minHours: 30, maxHours: 38, payRate: 18.75 },
  6:  { type: "part_time", maxHours: 24, payRate: 16.25 },
  7:  { type: null, payRate: 16 },
  8:  { type: "part_time", payRate: 15.75 },
  9:  { type: "part_time", minHours: 16, payRate: 16.5 },
  10: { type: "part_time", maxHours: 20, maxDays: 4, payRate: 15.5 },
  11: { type: "part_time", maxHours: 24, payRate: 15.75 },
  12: { type: "part_time", maxHours: 16, maxDays: 2, payRate: 15.25 },
};

// Shift preferences (what each person would like). Days are 0 = Sunday.
export const DEMO_PREFERENCES: Record<
  number,
  { shiftTypes: Array<"opener" | "mid" | "closer">; preferredDays?: number[]; avoidDays?: number[]; desiredHours?: number; note?: string }
> = {
  1:  { shiftTypes: ["opener"], preferredDays: [1, 2, 3, 4, 5] },
  2:  { shiftTypes: ["mid"], desiredHours: 40 },
  3:  { shiftTypes: ["closer"], avoidDays: [0] },
  4:  { shiftTypes: ["opener", "mid"] },
  5:  { shiftTypes: ["mid"], preferredDays: [4, 5, 6] },
  6:  { shiftTypes: ["closer"], desiredHours: 22 },
  7:  { shiftTypes: ["closer"], preferredDays: [0, 1], desiredHours: 12 },
  8:  { shiftTypes: ["closer"], avoidDays: [6] },
  9:  { shiftTypes: ["opener"], desiredHours: 24, note: "Happy to pick up extra mornings" },
  10: { shiftTypes: ["mid"], desiredHours: 18, note: "School pickup at 5:30 PM on weekdays" },
  11: { shiftTypes: ["closer"], preferredDays: [4, 5] },
  12: { shiftTypes: [], preferredDays: [0, 6], desiredHours: 16 },
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

// Demo coverage curves — weekday curve peaks at lunch, weekend is flatter.
export const DEMO_COVERAGE_PROFILES = [
  {
    id: 1,
    name: "Weekday",
    blocks: [
      { startMinutes: 540, endMinutes: 720, headcount: 3 },   // 9 AM–12 PM
      { startMinutes: 720, endMinutes: 1080, headcount: 4 },  // 12 PM–6 PM
      { startMinutes: 1080, endMinutes: 1260, headcount: 3 }, // 6 PM–9 PM
    ],
  },
  {
    id: 2,
    name: "Weekend",
    blocks: [
      { startMinutes: 600, endMinutes: 840, headcount: 4 },   // 10 AM–2 PM
      { startMinutes: 840, endMinutes: 1080, headcount: 3 },  // 2 PM–6 PM
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
