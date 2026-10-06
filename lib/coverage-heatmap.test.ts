import { describe, it, expect } from "vitest";
import { coverageHeatmap } from "./coverage-heatmap";

const MON = "2026-10-12";
const TUE = "2026-10-13";

describe("coverageHeatmap", () => {
  it("spans the hours anyone is needed or scheduled", () => {
    const { hours } = coverageHeatmap(
      [{ date: TUE, startMinutes: 1200, endMinutes: 1290 }], // 8–9:30 PM
      [MON, TUE],
      { [MON]: [{ startMinutes: 540, endMinutes: 660, headcount: 1 }] } // 9–11 AM
    );
    expect(hours).toEqual([540, 600, 660, 720, 780, 840, 900, 960, 1020, 1080, 1140, 1200, 1260]);
  });

  it("classifies each hour by its worst 15 minutes", () => {
    const { rows } = coverageHeatmap(
      [
        { date: MON, startMinutes: 540, endMinutes: 600 },  // 1 person 9–10
        { date: MON, startMinutes: 600, endMinutes: 720 },  // 1 person 10–12
        { date: MON, startMinutes: 690, endMinutes: 720 },  // a 2nd person 11:30–12
      ],
      [MON],
      { [MON]: [{ startMinutes: 540, endMinutes: 660, headcount: 1 }, { startMinutes: 660, endMinutes: 720, headcount: 2 }] }
    );
    const [nine, ten, eleven] = rows[0].cells;
    expect(nine).toEqual({ startMinutes: 540, kind: "met", diff: 0, scheduled: 1, target: 1 });
    expect(ten).toEqual({ startMinutes: 600, kind: "met", diff: 0, scheduled: 1, target: 1 });
    // 11:00–11:30 has 1 of 2: short wins over the met quarter-hours.
    expect(eleven).toEqual({ startMinutes: 660, kind: "short", diff: -1, scheduled: 1, target: 2 });
  });

  it("marks hours with more people than needed as over, and unneeded hours as empty", () => {
    const { rows } = coverageHeatmap(
      [{ date: MON, startMinutes: 540, endMinutes: 720 }, { date: MON, startMinutes: 540, endMinutes: 600 }],
      [MON, TUE],
      { [MON]: [{ startMinutes: 540, endMinutes: 660, headcount: 1 }] }
    );
    expect(rows[0].cells.map((c) => c.kind)).toEqual(["over", "met", "over"]);
    expect(rows[0].cells[0].diff).toBe(1);
    expect(rows[1].cells.every((c) => c.kind === "empty")).toBe(true);
  });

  it("counts the after-midnight part of last night's shift", () => {
    const { rows, hours } = coverageHeatmap(
      [{ date: MON, startMinutes: 1320, endMinutes: 1560 }], // 10 PM–2 AM
      [MON, TUE],
      { [TUE]: [{ startMinutes: 0, endMinutes: 120, headcount: 1 }] }
    );
    expect(hours[0]).toBe(0);
    expect(rows[1].cells[0]).toMatchObject({ kind: "met", scheduled: 1, target: 1 });
  });

  it("returns no columns for an empty week", () => {
    expect(coverageHeatmap([], [MON], {})).toEqual({ hours: [], rows: [{ date: MON, cells: [] }] });
  });
});
