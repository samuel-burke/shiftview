import { describe, it, expect } from "vitest";
import { buildPrintRows } from "./week-print";

const DATES = ["2026-10-17", "2026-10-18"];

describe("buildPrintRows", () => {
  it("puts each shift, its note, and time off in the right cell", () => {
    const rows = buildPrintRows(
      [{ id: 1, name: "Zoe" }, { id: 2, name: "Ann" }, { id: 3, name: "Bea" }],
      [
        { employeeId: 1, date: "2026-10-17", startMinutes: 540, endMinutes: 1020, note: "Opening" },
        { employeeId: 1, date: "2026-10-18T00:00:00", startMinutes: 1320, endMinutes: 1800 },
      ],
      [
        { employeeId: 2, date: "2026-10-17", status: "approved" },
        { employeeId: 2, date: "2026-10-18", status: "pending" },
        { employeeId: 3, date: "2026-10-18", status: "approved", startMinutes: 900, endMinutes: 1080 },
      ],
      DATES
    );
    // Working people first, then alphabetical.
    expect(rows.map((r) => r.name)).toEqual(["Zoe", "Ann", "Bea"]);
    const [zoe, ann, bea] = rows;
    expect(zoe.hours).toBe(16);
    expect(zoe.cells[0].lines).toHaveLength(1);
    expect(zoe.cells[0].notes).toEqual(["Opening"]);
    expect(zoe.cells[1].lines[0]).toMatch(/10(:00)?\s?PM – 6(:00)?\s?AM/);
    expect(ann.cells.map((c) => c.off)).toEqual(["Off", null]); // pending isn't printed
    expect(bea.cells[1].off).toMatch(/^Off 3(:00)?\s?PM – 6(:00)?\s?PM$/);
    expect(bea.hours).toBe(0);
  });
});
