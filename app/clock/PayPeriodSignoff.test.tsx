import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PayPeriodSignoff from "./PayPeriodSignoff";

const period = (over: Record<string, unknown> = {}) => ({
  id: 7, start: "2026-10-05", end: "2026-10-11", status: "approved", approvedAt: null, lockedAt: null, signoffs: [], ...over,
});

function mockApi(get: unknown, post?: { status: number; body: unknown }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/pay-periods/signoff") && init?.method === "POST")
      return new Response(JSON.stringify(post?.body ?? {}), { status: post?.status ?? 200 });
    return new Response(JSON.stringify(get), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const enabled = (p: unknown) => ({ frequency: "weekly", anchor: null, enabled: true, today: "2026-10-14", periods: p ? [p] : [] });

describe("PayPeriodSignoff", () => {
  it("shows nothing when the store doesn't use pay periods", async () => {
    const fetchMock = mockApi({ frequency: "none", anchor: null, enabled: false, today: "2026-10-14", periods: [] });
    const { container } = render(<PayPeriodSignoff timezone="America/New_York" refreshKey="" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/pay-periods?signable=1"));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const { container } = render(<PayPeriodSignoff timezone="America/New_York" refreshKey="" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("asks the employee to confirm the latest period, and signs it", async () => {
    const fetchMock = mockApi(enabled(period()), {
      status: 200,
      body: { ok: true, signoff: { employeeId: 5, status: "signed", note: null, signedAt: "2026-10-14T19:05:00Z" } },
    });
    render(<PayPeriodSignoff timezone="America/New_York" refreshKey="" />);
    expect(await screen.findByText("Mon, Oct 5 – Sun, Oct 11")).toBeInTheDocument();
    expect(screen.getByTestId("pay-period-status")).toHaveTextContent("Approved");
    fireEvent.click(screen.getByRole("button", { name: "I confirm these hours are correct" }));
    // Signed with the time in the store's timezone (3:05 PM EDT).
    expect(await screen.findByTestId("pay-period-my-signoff")).toHaveTextContent("You confirmed these hours on Oct 14 at 3:05 PM.");
    const post = fetchMock.mock.calls.find(([u]) => u === "/api/pay-periods/signoff")!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ date: "2026-10-05", status: "signed" });
    expect(screen.queryByRole("button", { name: "I confirm these hours are correct" })).toBeNull();
  });

  it("disputes with a note, which is required", async () => {
    const fetchMock = mockApi(enabled(period()), {
      status: 200,
      body: { ok: true, signoff: { employeeId: 5, status: "disputed", note: "Missing Thursday", signedAt: "2026-10-14T19:05:00Z" } },
    });
    render(<PayPeriodSignoff timezone="America/New_York" refreshKey="" />);
    fireEvent.click(await screen.findByRole("button", { name: "Something's wrong" }));
    const send = screen.getByRole("button", { name: "Send to my manager" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("What's wrong with your hours?"), { target: { value: "Missing Thursday" } });
    fireEvent.click(send);
    expect(await screen.findByTestId("pay-period-my-signoff")).toHaveTextContent(/disputed these hours .*Missing Thursday/);
    const post = fetchMock.mock.calls.find(([u]) => u === "/api/pay-periods/signoff")!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ date: "2026-10-05", status: "disputed", note: "Missing Thursday" });
    // They can still confirm later.
    expect(screen.getByRole("button", { name: "I confirm these hours are correct" })).toBeInTheDocument();
  });

  it("shows an existing sign-off", async () => {
    mockApi(enabled(period({
      status: "locked",
      signoffs: [{ employeeId: 5, status: "signed", note: null, signedAt: "2026-10-12T01:30:00Z" }],
    })));
    render(<PayPeriodSignoff timezone="America/New_York" refreshKey="" />);
    expect(await screen.findByTestId("pay-period-my-signoff")).toHaveTextContent("You confirmed these hours on Oct 11 at 9:30 PM.");
    expect(screen.getByTestId("pay-period-status")).toHaveTextContent("Locked");
  });

  it("shows the server's reason when signing fails", async () => {
    mockApi(enabled(period()), { status: 400, body: { error: "You can sign off on the last day of the pay period (2026-10-11)" } });
    render(<PayPeriodSignoff timezone="America/New_York" refreshKey="" />);
    fireEvent.click(await screen.findByRole("button", { name: "I confirm these hours are correct" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/last day/);
  });

  it("reloads when the employee's punches change", async () => {
    const fetchMock = mockApi(enabled(period()));
    const { rerender } = render(<PayPeriodSignoff timezone="America/New_York" refreshKey="a" />);
    await screen.findByText("Mon, Oct 5 – Sun, Oct 11");
    rerender(<PayPeriodSignoff timezone="America/New_York" refreshKey="b" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
