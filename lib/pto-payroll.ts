// Paid leave next to worked hours, for payroll and the time card.
//
// computePayroll (lib/payroll.ts) is left as it is: paid leave is not time
// worked, so it never counts toward overtime. This adds each day's PTO and
// sick hours beside its worked hours, adding the days (and weeks, and
// employees) that only have paid leave.

import { dayOfWeekForKey, weekStartForKey } from "@/lib/dates";
import { WORKWEEK_START_DAY, type EmployeePayroll, type PayrollDay, type PayrollWeek } from "@/lib/payroll";
import { paidLeaveByEmployeeDay, round2, type PaidLeaveDay } from "@/lib/pto";

export type PayrollDayWithLeave = PayrollDay & { ptoHours: number; sickHours: number };
export type PayrollWeekWithLeave = Omit<PayrollWeek, "days"> & {
  days: PayrollDayWithLeave[];
  ptoHours: number;
  sickHours: number;
};
export type EmployeePayrollWithLeave = Omit<EmployeePayroll, "weeks"> & {
  weeks: PayrollWeekWithLeave[];
  totalPtoHours: number;
  totalSickHours: number;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function emptyDay(date: string): PayrollDay {
  return {
    date,
    dayName: DAY_NAMES[dayOfWeekForKey(date)],
    workedHours: 0,
    regularHours: 0,
    overtimeHours: 0,
    breakHours: 0,
    hasIncomplete: false,
  };
}

function emptyWeek(weekStart: string): PayrollWeek {
  return {
    weekStart,
    priorHours: 0,
    regularHours: 0,
    overtimeHours: 0,
    breakHours: 0,
    totalWorkedHours: 0,
    hasIncomplete: false,
    days: [],
  };
}

// `leave` must already be limited to the report's range. `names` names
// employees who have paid leave but no punches.
export function withPaidLeave(
  payroll: EmployeePayroll[],
  leave: PaidLeaveDay[],
  names: Record<number, string> = {},
): EmployeePayrollWithLeave[] {
  const byEmp = paidLeaveByEmployeeDay(leave);
  const employees = new Map<number, EmployeePayroll>(payroll.map((e) => [e.employeeId, e]));
  for (const id of byEmp.keys()) {
    if (!employees.has(id)) {
      employees.set(id, {
        employeeId: id,
        employeeName: names[id] ?? `Employee ${id}`,
        weeks: [],
        totalRegularHours: 0,
        totalOvertimeHours: 0,
        totalBreakHours: 0,
        totalWorkedHours: 0,
      });
    }
  }

  return [...employees.values()]
    .map((emp) => {
      const leaveDays = byEmp.get(emp.employeeId) ?? new Map();
      const weeks = new Map<string, PayrollWeek>(emp.weeks.map((w) => [w.weekStart, { ...w, days: [...w.days] }]));
      for (const date of leaveDays.keys()) {
        const ws = weekStartForKey(date, WORKWEEK_START_DAY);
        const week = weeks.get(ws) ?? emptyWeek(ws);
        if (!week.days.some((d) => d.date === date)) week.days.push(emptyDay(date));
        weeks.set(ws, week);
      }

      let totalPto = 0;
      let totalSick = 0;
      const outWeeks: PayrollWeekWithLeave[] = [...weeks.values()]
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
        .map((w) => {
          let pto = 0;
          let sick = 0;
          const days = [...w.days]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((d) => {
              const t = leaveDays.get(d.date) ?? { ptoHours: 0, sickHours: 0 };
              pto += t.ptoHours;
              sick += t.sickHours;
              return { ...d, ptoHours: t.ptoHours, sickHours: t.sickHours };
            });
          totalPto += pto;
          totalSick += sick;
          return { ...w, days, ptoHours: round2(pto), sickHours: round2(sick) };
        });
      return { ...emp, weeks: outWeeks, totalPtoHours: round2(totalPto), totalSickHours: round2(totalSick) };
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}
