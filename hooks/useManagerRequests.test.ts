import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useManagerRequests } from "./useManagerRequests";

const TZ = "America/New_York";

const TIME_OFF = { requests: [{ id: 1, employeeId: 7, employeeName: "Alice Smith", date: "2026-10-08", status: "pending" }] };
const SWAPS = [
  { id: 2, status: "accepted", requester: { name: "Bob Jones" }, target: { name: "Dakota Park" }, schedule_a: { date: "2026-10-09", start_minutes: 540, end_minutes: 1020 } },
  { id: 3, status: "pending", requester: { name: "Carol White" }, target: { name: "Bob Jones" }, schedule_a: { date: "2026-10-10", start_minutes: 540, end_minutes: 1020 } },
];
const CORRECTIONS = { corrections: [{ id: 4, employeeId: 7, employeeName: "Alice Smith", punchType: "clock_out", punchedAt: "2026-10-05T21:00:00Z", note: "", status: "pending" }] };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;
    if (init?.method === "PUT") return url.includes("/api/swaps/") ? body({ error: "Swap already handled" }, false) : body({});
    if (url === "/api/time-off") return body(TIME_OFF);
    if (url === "/api/swaps") return body(SWAPS);
    if (url === "/api/punch-corrections") return body(CORRECTIONS);
    return body(null, false);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useManagerRequests", () => {
  it("loads nothing until the caller is a manager", () => {
    renderHook(() => useManagerRequests(false, TZ));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps only swaps the other employee already accepted", async () => {
    const { result } = renderHook(() => useManagerRequests(true, TZ));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.timeOff).toHaveLength(1);
    expect(result.current.swaps.map((s) => s.id)).toEqual([2]);
    expect(result.current.corrections).toHaveLength(1);
    expect(result.current.count).toBe(3);
  });

  it("drops a request once it's decided", async () => {
    const { result } = renderHook(() => useManagerRequests(true, TZ));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(() => result.current.decideTimeOff(1, "approved"));
    expect(fetchMock).toHaveBeenCalledWith("/api/time-off/1", expect.objectContaining({ method: "PUT", body: JSON.stringify({ status: "approved" }) }));
    expect(result.current.timeOff).toHaveLength(0);
    expect(result.current.count).toBe(2);
  });

  it("refetches at the store's midnight, when the day's requests expire", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    // 23:59 on Oct 7 in New York.
    vi.setSystemTime(new Date("2026-10-08T03:59:00Z"));
    try {
      renderHook(() => useManagerRequests(true, TZ));
      const timeOffLoads = () => fetchMock.mock.calls.filter(([url]) => url === "/api/time-off").length;
      await act(async () => {});
      expect(timeOffLoads()).toBe(1);

      await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
      expect(timeOffLoads()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces the server's message when a decision fails", async () => {
    const { result } = renderHook(() => useManagerRequests(true, TZ));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await expect(act(() => result.current.decideSwap(2, "approved"))).rejects.toThrow("Swap already handled");
  });
});
