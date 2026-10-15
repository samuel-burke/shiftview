import { describe, it, expect } from "vitest";
import { groupShiftsByAttendance } from "./dashboard-attendance";
import type { AttendanceStatus, Schedule } from "../data/types";

const DAY = "2026-10-15";
const shift = (employeeId: number, startMinutes: number, date = DAY): Schedule =>
  ({ id: employeeId, employeeId, date, startMinutes, endMinutes: startMinutes + 480 });
const walkIn = (employeeId: number): Schedule =>
  ({ id: -employeeId, employeeId, date: DAY, startMinutes: -1, endMinutes: -1 });
const ids = (list: Schedule[]) => list.map((s) => s.employeeId);

describe("groupShiftsByAttendance", () => {
  it("groups shifts by attendance, in start-time order", () => {
    const status: Record<number, AttendanceStatus> = { 1: "clocked_in", 2: "on_break", 3: "not_clocked_in", 4: "clocked_out", 9: "clocked_in" };
    const g = groupShiftsByAttendance([shift(2, 600), shift(1, 540), shift(3, 700), shift(4, 360)], [walkIn(9)], status, new Set(), DAY);
    expect(ids(g.scheduled)).toEqual([4, 1, 2, 3]);
    expect(ids(g.hereNow)).toEqual([1, 9]);
    expect(ids(g.onBreak)).toEqual([2]);
    expect(ids(g.remaining)).toEqual([4, 3]);
  });

  it("keeps a called-out employee who clocked in anyway in Here Now / On Break", () => {
    const status: Record<number, AttendanceStatus> = { 1: "clocked_in", 2: "on_break" };
    const g = groupShiftsByAttendance([shift(1, 540), shift(2, 600)], [], status, new Set([1, 2]), DAY);
    expect(ids(g.hereNow)).toEqual([1]);
    expect(ids(g.onBreak)).toEqual([2]);
    expect(ids(g.remaining)).toEqual([]);
  });

  it("leaves called-out employees who aren't on the clock out of every group", () => {
    const status: Record<number, AttendanceStatus> = { 1: "not_clocked_in", 2: "clocked_out" };
    const g = groupShiftsByAttendance([shift(1, 540), shift(2, 600), shift(3, 700)], [], status, new Set([1, 2, 3]), DAY);
    expect(ids(g.scheduled)).toEqual([]);
    expect(ids(g.remaining)).toEqual([]);
  });

  it("only applies a call-out to that day's shift, not last night's overnight one", () => {
    const g = groupShiftsByAttendance([shift(1, 1320, "2026-10-14")], [], {}, new Set([1]), DAY);
    expect(ids(g.scheduled)).toEqual([1]);
    expect(ids(g.remaining)).toEqual([1]);
  });
});
