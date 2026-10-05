import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStoreTodayKey } from "./useStoreTodayKey";

afterEach(() => {
  vi.useRealTimers();
});

describe("useStoreTodayKey", () => {
  it("returns today in the store's timezone, not the device's", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T01:00:00Z")); // Oct 5 evening in New York
    const { result: ny } = renderHook(() => useStoreTodayKey("America/New_York"));
    const { result: tokyo } = renderHook(() => useStoreTodayKey("Asia/Tokyo"));
    expect(ny.current).toBe("2026-10-05");
    expect(tokyo.current).toBe("2026-10-06");
  });

  it("rolls over at the store's midnight while the page stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T03:59:00Z")); // 23:59 EDT
    const { result } = renderHook(() => useStoreTodayKey("America/New_York"));
    expect(result.current).toBe("2026-10-05");
    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    expect(result.current).toBe("2026-10-06");
  });

  it("rolls over correctly on a 25-hour fall-back day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T04:58:00Z")); // 23:58 EST on Nov 1
    const { result } = renderHook(() => useStoreTodayKey("America/New_York"));
    expect(result.current).toBe("2026-11-01");
    act(() => { vi.advanceTimersByTime(3 * 60_000); });
    expect(result.current).toBe("2026-11-02");
  });

  it("re-checks when the tab becomes visible again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    const { result } = renderHook(() => useStoreTodayKey("America/New_York"));
    expect(result.current).toBe("2026-10-05");
    // The device slept through midnight; no timer fired.
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(result.current).toBe("2026-10-06");
  });
});
