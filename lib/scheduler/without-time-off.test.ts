import { describe, it, expect } from "vitest";
import { withoutTimeOff } from "./model";

describe("withoutTimeOff", () => {
  it("leaves a window alone when the time off is outside it", () => {
    expect(withoutTimeOff([540, 1260], [{ startMinutes: 300, endMinutes: 540 }])).toEqual([540, 1260]);
  });

  it("cuts the end off for leaving early, and the start for coming in late", () => {
    expect(withoutTimeOff([540, 1260], [{ startMinutes: 900, endMinutes: 1440 }])).toEqual([540, 900]);
    expect(withoutTimeOff([540, 1260], [{ startMinutes: 0, endMinutes: 720 }])).toEqual([720, 1260]);
  });

  it("keeps the longer side of a gap in the middle", () => {
    expect(withoutTimeOff([540, 1260], [{ startMinutes: 720, endMinutes: 780 }])).toEqual([780, 1260]);
    expect(withoutTimeOff([540, 1260], [{ startMinutes: 1080, endMinutes: 1140 }])).toEqual([540, 1080]);
  });

  it("returns null when nothing is left", () => {
    expect(withoutTimeOff([540, 1260], [{ startMinutes: 500, endMinutes: 1300 }])).toBeNull();
    expect(withoutTimeOff([540, 1260], [{ startMinutes: 540, endMinutes: 900 }, { startMinutes: 900, endMinutes: 1260 }])).toBeNull();
  });
});
