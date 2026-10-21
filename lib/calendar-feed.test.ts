import { describe, it, expect } from "vitest";
import { buildEmployeeCalendar, feedPath, hashFeedToken, isFeedTokenShape, newFeedToken } from "./calendar-feed";
import { createFakeDb } from "@/app/api/__tests__/fake-db";

const ORG = "org-a";

describe("feed tokens", () => {
  it("makes unguessable, URL-safe tokens of a fixed shape", () => {
    const a = newFeedToken();
    const b = newFeedToken();
    expect(a).not.toBe(b);
    expect(isFeedTokenShape(a)).toBe(true);
    expect(feedPath(a)).toBe(`/api/calendar/${a}.ics`);
  });

  it("refuses anything else before a lookup", () => {
    expect(isFeedTokenShape("short")).toBe(false);
    expect(isFeedTokenShape(`${"a".repeat(42)}/`)).toBe(false);
    expect(isFeedTokenShape("a".repeat(44))).toBe(false);
  });

  it("stores a stable SHA-256 hex digest, never the token", () => {
    const t = newFeedToken();
    expect(hashFeedToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFeedToken(t)).toBe(hashFeedToken(t));
    expect(hashFeedToken(t)).not.toContain(t);
  });
});

describe("buildEmployeeCalendar", () => {
  const db = createFakeDb({
    schedules: [
      { id: 1, org_id: ORG, employee_id: 5, date: "2026-10-20", start_minutes: 540, end_minutes: 1020, note: "Truck day" },
      { id: 2, org_id: ORG, employee_id: 6, date: "2026-10-20", start_minutes: 540, end_minutes: 1020 },
      { id: 3, org_id: "org-b", employee_id: 5, date: "2026-10-21", start_minutes: 540, end_minutes: 1020 },
      { id: 4, org_id: ORG, employee_id: 5, date: "2027-06-01", start_minutes: 540, end_minutes: 1020 },
    ],
  });

  it("carries only the person's own shifts in their org and window, with notes and a refresh hint", async () => {
    const { ics, error } = await buildEmployeeCalendar(db.client, {
      orgId: ORG,
      employee: { id: 5, name: "Alice" },
      timezone: "America/New_York",
      now: new Date("2026-10-18T12:00:00Z"),
      refreshMinutes: 60,
    });
    expect(error).toBeNull();
    expect(ics).toContain(`UID:shiftview-1-${ORG}@shiftview.app`);
    expect(ics).not.toContain("shiftview-2-");
    expect(ics).not.toContain("shiftview-3-");
    expect(ics).not.toContain("shiftview-4-"); // past the 120-day window
    expect(ics).toContain("Truck day");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT60M");
  });

  it("omits the refresh hint for a one-time download", async () => {
    const { ics } = await buildEmployeeCalendar(db.client, {
      orgId: ORG,
      employee: { id: 5, name: "Alice" },
      timezone: "America/New_York",
      now: new Date("2026-10-18T12:00:00Z"),
    });
    expect(ics).not.toContain("REFRESH-INTERVAL");
  });
});
