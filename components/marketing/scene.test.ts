import { describe, it, expect } from "vitest";
import { buildScene, coverageAt, hereAt, punchTime, statusAt, statusBarTime, workedAt } from "./scene";
import { minutesFromScheduled, zonedTimeToUtc } from "@/lib/dates";
import { targetAt } from "@/lib/coverage";

// A Monday through Sunday: the hero plays the same moment on any day.
const WEEK = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];

describe("marketing scene", () => {
  it.each(WEEK)("on %s, the late clock-in takes coverage from low to met", (date) => {
    const scene = buildScene(date);
    const { shift, at } = scene.late;
    const before = at - 4;

    expect(statusAt(scene, shift.employeeId, before)).toBe("not_clocked_in");
    expect(coverageAt(scene, before)).toBe("low");
    expect(hereAt(scene, before)).toBe(targetAt(scene.curve, Math.floor(before / 60)) - 1);

    expect(statusAt(scene, shift.employeeId, at)).toBe("clocked_in");
    expect(coverageAt(scene, at)).toBe("optimal");
    // The app alerts managers past 5 minutes late (app/api/punches/route.ts).
    const late = minutesFromScheduled(zonedTimeToUtc(date, 0, "UTC").getTime() + at * 1000, date, shift.startMinutes, "UTC");
    expect(late).toBe(10);
  });

  it.each(WEEK)("on %s, nobody else is on break or missing at that moment", (date) => {
    const scene = buildScene(date);
    for (const s of scene.shifts) {
      if (s === scene.late.shift) continue;
      const status = statusAt(scene, s.employeeId, scene.late.at);
      const working = scene.late.at >= s.startMinutes * 60 && scene.late.at < s.endMinutes * 60;
      if (working) expect(status).toBe("clocked_in");
    }
  });

  it("counts time worked net of breaks", () => {
    const scene = buildScene(WEEK[3]);
    const opener = scene.shifts[0];
    const clockOut = scene.punches.find((p) => p.employeeId === opener.employeeId && p.type === "clock_out")!.at;
    const worked = workedAt(scene, opener.employeeId, clockOut);
    const shift = (opener.endMinutes - opener.startMinutes) * 60;
    expect(worked).toBeGreaterThan(shift - 30 * 60 - 10 * 60);
    expect(worked).toBeLessThan(shift - 30 * 60 + 10 * 60);
  });

  it("formats times like the app", () => {
    expect(statusBarTime(13 * 3600 + 10 * 60 + 5)).toBe("1:10");
    expect(punchTime(13 * 3600 + 10 * 60 + 5)).toBe("01:10:05 PM");
    expect(punchTime(9 * 3600 + 2 * 60)).toBe("09:02:00 AM");
  });
});
