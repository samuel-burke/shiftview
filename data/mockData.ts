export type ShiftType = "opener" | "mid" | "closer";

export type Employee = {
  id: number;
  name: string;
  avatar: string;
};

export type Schedule = {
  id: number;
  employeeId: number;
  date: string;
  startMinutes: number; // -1 = off/not scheduled
  endMinutes: number;
  startLabel: string;
  endLabel: string;
};

export const employees: Employee[] = [
  { id: 1,  name: "Marcus T.",  avatar: "MT" },
  { id: 2,  name: "Janelle R.", avatar: "JR" },
  { id: 3,  name: "Deon W.",    avatar: "DW" },
  { id: 4,  name: "Priya M.",   avatar: "PM" },
  { id: 5,  name: "Carlos S.",  avatar: "CS" },
  { id: 6,  name: "Kevin L.",   avatar: "KL" },
  { id: 7,  name: "Ray V.",     avatar: "RV" },
  { id: 8,  name: "Aaliyah F.", avatar: "AF" },
  { id: 9,  name: "Simone H.",  avatar: "SS" },
  { id: 10, name: "Brett O.",   avatar: "BO" },
  { id: 11, name: "Jordan L.",  avatar: "JL" },
];

// Simulated now = 1:00 PM = 780 min
// Openers  6:00 AM – 2:30 PM  (360–870)   → here at 1pm ✓
// Mids    10:00 AM – 6:30 PM  (600–1110)  → here at 1pm ✓
// Closers  2:00 PM – 10:30 PM (840–1290)  → not yet in  ✗
const openerShift = {
  startMinutes: 360,
  endMinutes: 870,
  startLabel: "6:00 AM",
  endLabel: "2:30 PM",
};

const midShift = {
  startMinutes: 600,
  endMinutes: 1110,
  startLabel: "10:00 AM",
  endLabel: "6:30 PM",
};

const closerShift = {
  startMinutes: 840,
  endMinutes: 1290,
  startLabel: "2:00 PM",
  endLabel: "10:30 PM",
};

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateSchedules(): Schedule[] {
  const schedules: Schedule[] = [];

  const startDate = new Date("2026-05-15");
  const endDate = new Date("2026-06-15");

  let id = 1;

  for (
    let date = new Date(startDate);
    date <= endDate;
    date.setDate(date.getDate() + 1)
  ) {
    const formattedDate = date.toISOString().split("T")[0];

    // Randomize employee order each day
    const availableEmployees = shuffle(employees);

    // Random staffing counts
    const openerCount = getRandomInt(2, 3);
    const midCount = getRandomInt(2, 4);
    const closerCount = getRandomInt(1, 3);

    // Assign shifts
    const openers = availableEmployees.splice(0, openerCount);
    const mids = availableEmployees.splice(0, midCount);
    const closers = availableEmployees.splice(0, closerCount);

    openers.forEach((employeeId) => {
      schedules.push({
        id: id++,
        employeeId: employeeId.id,
        date: formattedDate,
        ...openerShift,
      });
    });

    mids.forEach((employeeId) => {
      schedules.push({
        id: id++,
        employeeId: employeeId.id,
        date: formattedDate,
        ...midShift,
      });
    });

    closers.forEach((employeeId) => {
      schedules.push({
        id: id++,
        employeeId: employeeId.id,
        date: formattedDate,
        ...closerShift,
      });
    });

    // Optional: randomly mark 0–2 employees as off
    const offCount = getRandomInt(0, 2);

    availableEmployees
      .slice(0, offCount)
      .forEach((employeeId) => {
        schedules.push({
          id: id++,
          employeeId: employeeId.id,
          date: formattedDate,
          startMinutes: -1,
          endMinutes: -1,
          startLabel: "",
          endLabel: "",
        });
      });
  }

  return schedules;
}
export const schedules = generateSchedules();


// Derived — computed from start time, not stored
export function getShiftType(startMinutes: number): ShiftType | null {
  if (startMinutes < 0) return null;
  if (startMinutes < 540) return "opener"; // before 9am
  if (startMinutes < 720) return "mid";    // 9am–noon
  return "closer";                          // noon+
}

// Is this person currently here given simulated now?
export function isHere(s: Schedule, nowMinutes: number): boolean {
  return s.startMinutes >= 0 && nowMinutes >= s.startMinutes && nowMinutes < s.endMinutes;
}

export const SHIFT_COLORS: Record<ShiftType, string> = {
  opener: "#f59e0b",
  mid:    "#6366f1",
  closer: "#8b5cf6",
};

export const OPTIMAL_COVERAGE = 3;
export const MINIMUM_COVERAGE = 1;
