import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import KioskClient from "./kioskClient";
import { KIOSK_CONFIRM_MS, KIOSK_IDLE_MS } from "@/lib/kiosk";

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };

let calls: { url: string; body: any }[] = [];

function mockFetch(handler: Handler) {
  calls = [];
  vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = input.toString();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });
    const r = handler(url, init);
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  });
}

const ok: Handler = (url) => {
  if (url.includes("/api/kiosk/status")) return { status: 200, body: { kioskName: "Front counter", orgName: "Alder Street" } };
  if (url.includes("/api/kiosk/identify"))
    return { status: 200, body: { employeeName: "Erin One", state: "clocked_out", actions: ["clock_in"], since: null } };
  if (url.includes("/api/kiosk/punch"))
    return { status: 201, body: { employeeName: "Erin One", punchType: "clock_in", punchedAt: new Date().toISOString(), state: "on_shift" } };
  return { status: 404, body: {} };
};

async function flush() {
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
}

async function typePin(pin: string) {
  for (const d of pin) await act(async () => { fireEvent.click(screen.getByRole("button", { name: d })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enter" })); });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("KioskClient", () => {
  it("shows the store and kiosk names once the device checks out", async () => {
    mockFetch(ok);
    render(<KioskClient />);
    await flush();
    expect(screen.getByText("Alder Street")).toBeInTheDocument();
    expect(screen.getByText("Front counter")).toBeInTheDocument();
  });

  it("a device that isn't a kiosk says so and disables the keypad", async () => {
    mockFetch((url) => url.includes("status")
      ? { status: 401, body: { error: "This device isn't set up as a kiosk — ask a manager", code: "no_kiosk" } }
      : { status: 500, body: {} });
    render(<KioskClient />);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(/isn't set up as a kiosk/);
    expect(screen.getByRole("button", { name: "1" })).toBeDisabled();
  });

  it("PIN → name and state → punch → confirmation → cleared", async () => {
    mockFetch(ok);
    render(<KioskClient />);
    await flush();
    await typePin("4821");
    expect(calls.find((c) => c.url.includes("identify"))!.body).toEqual({ pin: "4821" });
    expect(screen.getByTestId("kiosk-name")).toHaveTextContent("Erin One");
    expect(screen.getByTestId("kiosk-state")).toHaveTextContent("Clocked out");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clock in" })); });
    await flush();
    expect(calls.find((c) => c.url.includes("punch"))!.body).toEqual({ pin: "4821", punchType: "clock_in" });
    expect(screen.getByText("Clock in ✓")).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(KIOSK_CONFIRM_MS); });
    expect(screen.queryByText("Erin One", { exact: false })).toBeNull();
    expect(screen.getByText("Enter your PIN")).toBeInTheDocument();
  });

  it("forgets the employee after 30 seconds without a tap", async () => {
    mockFetch(ok);
    render(<KioskClient />);
    await flush();
    await typePin("4821");
    expect(screen.getByTestId("kiosk-name")).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(KIOSK_IDLE_MS - 1000); });
    expect(screen.getByTestId("kiosk-name")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByTestId("kiosk-name")).toBeNull();
    expect(screen.getByText("Enter your PIN")).toBeInTheDocument();

    // And the old PIN isn't reused: a punch now needs a new PIN.
    expect(screen.queryByRole("button", { name: "Clock in" })).toBeNull();
  });

  it("clears a half-typed PIN after 30 seconds idle", async () => {
    mockFetch(ok);
    render(<KioskClient />);
    await flush();
    for (const d of "48") await act(async () => { fireEvent.click(screen.getByRole("button", { name: d })); });
    expect(screen.getByLabelText("2 digits entered")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(KIOSK_IDLE_MS); });
    expect(screen.getByLabelText("0 digits entered")).toBeInTheDocument();
  });

  it("a tap restarts the idle timer", async () => {
    mockFetch(ok);
    render(<KioskClient />);
    await flush();
    await typePin("4821");
    await act(async () => { vi.advanceTimersByTime(KIOSK_IDLE_MS - 1000); });
    await act(async () => { fireEvent.pointerDown(screen.getByTestId("kiosk")); });
    await act(async () => { vi.advanceTimersByTime(KIOSK_IDLE_MS - 1000); });
    expect(screen.getByTestId("kiosk-name")).toBeInTheDocument();
  });

  it("a wrong PIN shows the generic message and no name", async () => {
    mockFetch((url, init) => url.includes("identify")
      ? { status: 401, body: { error: "PIN not recognized", code: "wrong_pin", attemptsLeft: 4 } }
      : ok(url, init));
    render(<KioskClient />);
    await flush();
    await typePin("1357");
    expect(screen.getByText("PIN not recognized")).toBeInTheDocument();
    expect(screen.queryByTestId("kiosk-name")).toBeNull();
    expect(screen.getByLabelText("0 digits entered")).toBeInTheDocument();
  });

  it("a refused punch goes back to the keypad, so the next person starts clean", async () => {
    mockFetch((url, init) => url.includes("punch")
      ? { status: 409, body: { error: "Can't clock in now: you're on shift" } }
      : ok(url, init));
    render(<KioskClient />);
    await flush();
    await typePin("4821");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clock in" })); });
    await flush();
    expect(screen.getByText("Can't clock in now: you're on shift")).toBeInTheDocument();
    expect(screen.queryByTestId("kiosk-name")).toBeNull();
  });

  it("Cancel forgets the employee at once", async () => {
    mockFetch(ok);
    render(<KioskClient />);
    await flush();
    await typePin("4821");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Not you? Cancel" })); });
    expect(screen.queryByTestId("kiosk-name")).toBeNull();
  });

  it("never asks for a list of employees", async () => {
    mockFetch(ok);
    render(<KioskClient />);
    await flush();
    await typePin("4821");
    expect(calls.every((c) => c.url.startsWith("/api/kiosk/"))).toBe(true);
  });
});
