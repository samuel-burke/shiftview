import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PunchHistoryToggle from "./PunchHistoryToggle";

afterEach(() => vi.unstubAllGlobals());

describe("PunchHistoryToggle", () => {
  it("loads the punch's history when opened and shows who, when, why and the time it replaced", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      history: [{
        id: 1, action: "update", changedAt: "2026-11-01T16:00:00Z", changedBy: "Ann", reason: "Badge reader down",
        before: { punchType: "clock_in", punchedAt: "2026-11-01T14:30:00Z", note: null },
        after:  { punchType: "clock_in", punchedAt: "2026-11-01T14:00:00Z", note: "Badge reader down" },
      }],
    })));
    vi.stubGlobal("fetch", fetchMock);
    render(<PunchHistoryToggle punchId={7} timezone="America/New_York" />);
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Manual/ }));
    expect(fetchMock).toHaveBeenCalledWith("/api/punches/7/history");
    expect(await screen.findByText(/Ann edited this punch \(was 9:30 AM\)/)).toBeInTheDocument();
    expect(screen.getByText(/Badge reader down/)).toBeInTheDocument();
  });
});
