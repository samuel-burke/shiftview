import { describe, it, expect } from "vitest";
import { defaultWeekStart, parseWeekParams, weekHref } from "./week-params";
import { clashingDrafts, projectedShifts, weekCells } from "./week-cells";

const TODAY = "2026-10-07"; // a Wednesday
const params = (q: string) => new URLSearchParams(q);

describe("parseWeekParams", () => {
  it("opens Live on this week by default", () => {
    expect(parseWeekParams(params(""), TODAY, 0)).toEqual({ mode: "live", weekStart: "2026-10-04" });
  });

  it("opens Draft on next week when no week is given", () => {
    expect(parseWeekParams(params("mode=draft"), TODAY, 0)).toEqual({ mode: "draft", weekStart: "2026-10-11" });
    expect(defaultWeekStart("draft", TODAY, 1)).toBe("2026-10-12"); // weeks starting Monday
  });

  it("snaps a given week to its start and keeps it in either mode", () => {
    expect(parseWeekParams(params("week=2026-10-14"), TODAY, 0)).toEqual({ mode: "live", weekStart: "2026-10-11" });
    expect(parseWeekParams(params("mode=draft&week=2026-10-04"), TODAY, 0)).toEqual({ mode: "draft", weekStart: "2026-10-04" });
  });

  it("ignores a bad week or mode", () => {
    expect(parseWeekParams(params("mode=weird&week=2026-02-30"), TODAY, 0)).toEqual({ mode: "live", weekStart: "2026-10-04" });
  });
});

describe("weekHref", () => {
  it("writes the mode only for Draft, and always the week", () => {
    expect(weekHref("live", "2026-10-04")).toBe("/week?week=2026-10-04");
    expect(weekHref("draft", "2026-10-11")).toBe("/week?mode=draft&week=2026-10-11");
  });
});

describe("week cells", () => {
  const live = [
    { id: 1, employeeId: 1, date: "2026-10-05", startMinutes: 540, endMinutes: 1020, source: "live" as const },
  ];
  const drafts = [
    { id: 9, employeeId: 1, date: "2026-10-05", startMinutes: 600, endMinutes: 900, source: "draft" as const }, // clashes
    { id: 10, employeeId: 2, date: "2026-10-05", startMinutes: 540, endMinutes: 1020, source: "draft" as const },
  ];

  it("lets the live shift win a cell in Draft mode and ignores drafts in Live mode", () => {
    const draftMode = weekCells([...live, ...drafts], "draft");
    expect(draftMode.get("1|2026-10-05")).toEqual({ live: live[0], draft: drafts[0], shown: live[0] });
    expect(draftMode.get("2|2026-10-05")?.shown).toBe(drafts[1]);
    const liveMode = weekCells([...live, ...drafts], "live");
    expect(liveMode.get("2|2026-10-05")).toBeUndefined();
  });

  it("projects the week after publishing and finds the drafts that won't publish", () => {
    expect(projectedShifts(live, drafts)).toEqual([live[0], drafts[1]]);
    expect(clashingDrafts(live, drafts)).toEqual([drafts[0]]);
  });
});
