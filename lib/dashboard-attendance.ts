import type { AttendanceStatus, Schedule } from "../data/types";
import { shiftWindowOn } from "@/lib/shift-times";

export type AttendanceGroups = {
  // Every shift shown under the dashboard's attendance groups, by start time.
  scheduled: Schedule[];
  hereNow: Schedule[];
  onBreak: Schedule[];
  // Scheduled but not here: not clocked in yet, or already clocked out.
  remaining: Schedule[];
};

const isPresent = (st: AttendanceStatus | undefined) => st === "clocked_in" || st === "on_break";

// Split the day's shifts (plus walk-ins) into the dashboard's attendance
// groups. Someone who called out for `dateKey` is listed in "Called Out"
// instead — unless they're on the clock anyway, in which case they still count
// as here (the Here Now total counts them from punches), so they must show in
// Here Now / On Break too. When `attendanceMap` is empty (punches not loaded)
// every shift falls into `remaining`.
export function groupShiftsByAttendance(
  scheduled: Schedule[],
  walkIns: Schedule[],
  attendanceMap: Record<number, AttendanceStatus>,
  calloutIds: ReadonlySet<number>,
  dateKey: string,
): AttendanceGroups {
  const sorted = [...scheduled]
    .sort((a, b) => shiftWindowOn(a, dateKey).start - shiftWindowOn(b, dateKey).start)
    .filter((s) =>
      !(s.date.slice(0, 10) === dateKey && calloutIds.has(s.employeeId)) || isPresent(attendanceMap[s.employeeId]),
    );
  const withStatus = (list: Schedule[], st: AttendanceStatus) => list.filter((s) => attendanceMap[s.employeeId] === st);
  return {
    scheduled: sorted,
    hereNow: [...withStatus(sorted, "clocked_in"), ...withStatus(walkIns, "clocked_in")],
    onBreak: [...withStatus(sorted, "on_break"), ...withStatus(walkIns, "on_break")],
    remaining: [
      ...sorted.filter((s) => {
        const st = attendanceMap[s.employeeId];
        return !st || st === "not_clocked_in" || st === "clocked_out";
      }),
      ...withStatus(walkIns, "clocked_out"),
    ],
  };
}
