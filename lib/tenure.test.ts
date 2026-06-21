import { describe, it, expect } from "vitest";
import {
  tenureYears,
  nextAnniversary,
  daysUntilAnniversary,
  upcomingAnniversaries,
} from "./tenure";

describe("tenureYears", () => {
  it("counts full years since hire", () => {
    expect(tenureYears("2020-06-17", "2026-06-17")).toBe(6);
  });
  it("rounds down before the anniversary", () => {
    expect(tenureYears("2024-06-20", "2026-06-17")).toBe(1);
  });
});

describe("nextAnniversary", () => {
  it("returns this year's anniversary when still upcoming", () => {
    expect(nextAnniversary("2024-06-20", "2026-06-17")).toBe("2026-06-20");
  });
  it("returns today when the anniversary is today", () => {
    expect(nextAnniversary("2020-06-17", "2026-06-17")).toBe("2026-06-17");
  });
  it("rolls to next year once this year's has passed", () => {
    expect(nextAnniversary("2023-06-10", "2026-06-17")).toBe("2027-06-10");
  });
});

describe("daysUntilAnniversary", () => {
  it("is 0 on the anniversary", () => {
    expect(daysUntilAnniversary("2020-06-17", "2026-06-17")).toBe(0);
  });
  it("counts days to an upcoming anniversary", () => {
    expect(daysUntilAnniversary("2024-06-20", "2026-06-17")).toBe(3);
  });
});

describe("upcomingAnniversaries", () => {
  const employees = [
    { employeeId: 1, hireDate: "2024-06-20" }, // 3 days, 2 years
    { employeeId: 2, hireDate: "2020-06-17" }, // today, 6 years
    { employeeId: 3, hireDate: "2023-06-10" }, // ~358 days out
    { employeeId: 4, hireDate: null },         // skipped
  ];

  it("lists anniversaries within the window, soonest first, with year counts", () => {
    const list = upcomingAnniversaries(employees, "2026-06-17", 30);
    expect(list.map((a) => a.employeeId)).toEqual([2, 1]);
    expect(list[0]).toMatchObject({ employeeId: 2, daysUntil: 0, years: 6 });
    expect(list[1]).toMatchObject({ employeeId: 1, daysUntil: 3, years: 2 });
  });

  it("excludes anniversaries beyond the window and employees with no hire date", () => {
    const list = upcomingAnniversaries(employees, "2026-06-17", 5);
    expect(list.map((a) => a.employeeId)).toEqual([2, 1]);
  });

  it("ignores a brand-new hire's zeroth anniversary (years must be >= 1)", () => {
    const list = upcomingAnniversaries([{ employeeId: 9, hireDate: "2026-06-20" }], "2026-06-17", 30);
    expect(list).toEqual([]);
  });
});
