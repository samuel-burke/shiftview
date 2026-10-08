import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AddToHomeScreenBanner from "./AddToHomeScreenBanner";

const appData = { me: { isManager: true, employeeId: 1, employeeName: "Jordan Martinez", isDemo: false }, sharedLoading: false };
vi.mock("@/lib/AppDataContext", () => ({ useAppData: () => appData }));

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WEEK = 7 * 24 * 60 * 60 * 1000;

function onIphone(ua = IPHONE) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

function mountAndWait() {
  const view = render(<AddToHomeScreenBanner />);
  act(() => { vi.advanceTimersByTime(2500); });
  return view;
}

describe("AddToHomeScreenBanner", () => {
  const defaultUa = window.navigator.userAgent;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T18:00:00Z"));
    localStorage.clear();
    appData.me.isDemo = false;
    appData.sharedLoading = false;
    onIphone();
  });
  afterEach(() => {
    vi.useRealTimers();
    onIphone(defaultUa);
  });

  it("shows on an iPhone in the signed-in app", () => {
    mountAndWait();
    expect(screen.getByRole("status", { name: "Add to Home Screen tip" })).toBeInTheDocument();
  });

  it("stays away on other devices", () => {
    onIphone(defaultUa);
    mountAndWait();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays away in the demo", () => {
    appData.me.isDemo = true;
    mountAndWait();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows at most once a week", () => {
    const first = mountAndWait();
    expect(screen.getByRole("status")).toBeInTheDocument();
    first.unmount();

    // The next page, or tomorrow: not again.
    vi.setSystemTime(new Date("2026-10-08T18:00:00Z"));
    const second = mountAndWait();
    expect(screen.queryByRole("status")).toBeNull();
    second.unmount();

    vi.setSystemTime(Date.parse("2026-10-07T18:00:02.500Z") + WEEK);
    mountAndWait();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("never shows again once dismissed", () => {
    const first = mountAndWait();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    first.unmount();

    vi.setSystemTime(Date.now() + 5 * WEEK);
    mountAndWait();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
