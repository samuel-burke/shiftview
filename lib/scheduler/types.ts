// Public types of the auto-scheduler (lib/scheduler). The engine is pure: the
// API route loads everything below from the database, calls generateSchedule(),
// and writes the resulting shifts as drafts.

import type { ShiftType } from "@/data/types";
import type { CoverageBlock } from "@/lib/coverage";
import type { AvailabilityRule } from "@/lib/availability-rules";
import type { EmploymentType, SchedulingRules } from "@/lib/scheduling-rules";

export type SchedulerEmployee = {
  id: number;
  name: string;
  // Null = not set; scheduled as part-time.
  employmentType: EmploymentType | null;
  // Personal weekly limits; null = the org default for the type.
  minWeeklyHours: number | null;
  maxWeeklyHours: number | null;
  maxDaysPerWeek: number | null;
  payRate: number | null;
  // Day of week (0 = Sunday) → availability. A missing day = available all day.
  availability: Partial<Record<number, AvailabilityRule>>;
  // Approved time off and call-outs: never scheduled on these dates.
  unavailableDates: string[];
  // Pending time-off requests.
  pendingTimeOffDates: string[];
  preferences: {
    shiftTypes: ShiftType[];
    preferredDays: number[];
    avoidDays: number[];
    desiredWeeklyHours: number | null;
  };
};

// A shift the generator must keep as it is: a published shift, or a draft it
// is filling around. Include the week before and after the planned week too, so
// rest and consecutive-day rules see them.
export type ExistingShift = {
  employeeId: number;
  date: string;
  startMinutes: number;
  endMinutes: number;
};

// One-off changes for the week being planned, set in the Auto-schedule sheet.
export type Adjustment =
  // More (or fewer) people than the coverage curve asks for, e.g. a delivery.
  | { kind: "coverage"; date: string; startMinutes: number; endMinutes: number; delta: number }
  // Keep an employee off one day.
  | { kind: "employee_off"; employeeId: number; date: string }
  // Weekly hours for one employee this week. A maximum past 40 h allows that
  // person overtime whatever the overtime rule says.
  | { kind: "employee_hours"; employeeId: number; minHours: number | null; maxHours: number | null };

export type SchedulerInput = {
  weekDates: string[]; // the 7 dates being planned
  timezone: string;
  // Target coverage per date (the resolved coverage profile).
  curves: Record<string, CoverageBlock[]>;
  // Store hours by day of week.
  storeHours: Record<number, { open: number; close: number }>;
  employees: SchedulerEmployee[];
  existing: ExistingShift[];
  rules: SchedulingRules;
  adjustments: Adjustment[];
  seed: number;
  // Local-search steps; defaults by roster size.
  iterations?: number;
  // Wall-clock limit for local search, in ms; defaults to 3000.
  timeLimitMs?: number;
};

export type ProposedShift = {
  employeeId: number;
  date: string;
  startMinutes: number;
  endMinutes: number;
};

// Why nobody covered (part of) a gap.
export type GapReasonCode =
  | "time_off"           // approved time off, a call-out, or kept off this week
  | "unavailable"        // outside their availability
  | "has_shift_that_day" // already working another part of that day
  | "max_hours"          // at their weekly hours limit
  | "max_days"           // at their days-per-week limit
  | "consecutive_days"   // would work too many days in a row
  | "rest"               // too close to another shift
  | "no_fit"             // no allowed shift length fits their window
  | "pending_time_off"   // could work, but has a pending time-off request
  | "short_gap"          // shorter than the shortest shift; covering it overstaffs
  | "tradeoff";          // could work; the cost outweighed the gain

export type GapReason = { code: GapReasonCode; employeeIds: number[] };

export type ScheduleGap = {
  date: string;
  startMinutes: number;
  endMinutes: number;
  shortfall: number; // most people short at once
  reasons: GapReason[]; // most common first
};

// A one-tap fix the Auto-schedule summary can offer: raise someone's hours for
// the week (as an employee_hours adjustment) and generate again.
export type Suggestion = {
  kind: "raise_hours";
  employeeId: number;
  maxHours: number;
  overtime: boolean;
  gapMinutes: number; // gap time they could cover
};

export type EmployeeResult = {
  employeeId: number;
  employmentType: EmploymentType;
  typeSet: boolean;
  // Paid minutes this week, including existing shifts.
  minutes: number;
  generatedMinutes: number;
  generatedShifts: number;
  minMinutes: number;
  maxMinutes: number;
  overtimeMinutes: number;
  belowMinimum: boolean;
  preferencesHonored: number;
  preferencesConsidered: number;
  // Dates scheduled despite a pending time-off request.
  pendingTimeOffDates: string[];
};

export type ScheduleMetrics = {
  // % of 15-minute target slots met, with and without the generated shifts.
  coverageScore: number | null;
  coverageScoreBefore: number | null;
  budgetHours: number;      // staff-hours under the target curve
  scheduledHours: number;   // every shift in the week, existing included
  generatedHours: number;
  generatedShifts: number;
  shortfallHours: number;   // staff-hours below target
  overstaffHours: number;   // staff-hours above target
  overtimeHours: number;
  laborCost: number;        // dollars, for employees with a pay rate
  employeesMissingRate: number;
  // % of generated shifts that respect the employee's stated preferences.
  preferenceScore: number | null;
};

export type SchedulerWarning =
  | { code: "no_coverage_target"; dates: string[] }
  | { code: "employment_type_missing"; employeeIds: number[] }
  | { code: "over_budget"; hours: number }
  | { code: "pending_time_off_scheduled"; employeeIds: number[] }
  | { code: "time_limit" };

export type ScheduleResult = {
  shifts: ProposedShift[];
  metrics: ScheduleMetrics;
  gaps: ScheduleGap[];
  suggestions: Suggestion[];
  employees: EmployeeResult[];
  warnings: SchedulerWarning[];
};
