import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CalendarSyncSection from "./CalendarSyncSection";

const URL_ = "https://app.test/api/calendar/abc.ics";

function mockFetch(active: boolean, post: { status: number; body: unknown } = { status: 201, body: { url: URL_ } }) {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") return new Response(JSON.stringify({ active }), { status: 200 });
    if (method === "POST") return new Response(JSON.stringify(post.body), { status: post.status });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("CalendarSyncSection", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("makes a link and shows it once, with a webcal button", async () => {
    const fetcher = mockFetch(false);
    render(<CalendarSyncSection />);
    const make = await screen.findByRole("button", { name: "Get calendar link" });
    await waitFor(() => expect(make).toBeEnabled());
    await userEvent.click(make);
    expect(await screen.findByLabelText("Your calendar link")).toHaveValue(URL_);
    expect(screen.getByRole("link", { name: "Open in calendar app" })).toHaveAttribute("href", "webcal://app.test/api/calendar/abc.ics");
    expect(fetcher).toHaveBeenCalledWith("/api/my-schedule/calendar/feed", { method: "POST" });
    expect(screen.getByRole("button", { name: "Make a new link" })).toBeInTheDocument();
  });

  it("says when a link is already on, and turns it off", async () => {
    const fetcher = mockFetch(true);
    render(<CalendarSyncSection />);
    expect(await screen.findByText(/Your calendar link is on/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turn off link" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Get calendar link" })).toBeInTheDocument());
    expect(fetcher).toHaveBeenCalledWith("/api/my-schedule/calendar/feed", { method: "DELETE" });
  });

  it("shows the server's refusal", async () => {
    mockFetch(false, { status: 403, body: { error: "Calendar subscriptions aren't available in the demo" } });
    render(<CalendarSyncSection />);
    const make = await screen.findByRole("button", { name: "Get calendar link" });
    await waitFor(() => expect(make).toBeEnabled());
    await userEvent.click(make);
    expect(await screen.findByRole("alert")).toHaveTextContent(/demo/);
  });
});
