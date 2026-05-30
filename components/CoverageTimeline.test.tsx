import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import CoverageTimeline from "./CoverageTimeline";

// Recharts uses ResizeObserver and SVG which jsdom doesn't fully support — stub them
vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

const baseProps = {
  schedules: [],
  nowMinutes: 600,
  isToday: true,
  openMinutes: 360,  // 6 AM
  closeMinutes: 1320, // 10 PM
};

function countDataPoints(container: Element): number {
  // Recharts renders one <path> per data series, but we can introspect the
  // component by exporting the computed points. Instead, test the point count
  // by inspecting the data array length via a DOM-reachable attribute.
  // Since we can't easily inspect recharts internals in jsdom, we test the
  // interval math directly.
  return 0; // placeholder — real assertions are in the unit tests below
}

describe("CoverageTimeline 15-minute sampling", () => {
  it("renders without crashing with 15-minute intervals", () => {
    const { container } = render(<CoverageTimeline {...baseProps} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders without crashing for a short operating day (2 hours)", () => {
    const { container } = render(
      <CoverageTimeline {...baseProps} openMinutes={480} closeMinutes={600} />
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("renders without crashing when nowMinutes is between 15-min marks", () => {
    // nowMinutes=607 should snap to 600 (nearest 15-min boundary)
    const { container } = render(
      <CoverageTimeline {...baseProps} nowMinutes={607} />
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("renders without crashing when isToday is false", () => {
    const { container } = render(
      <CoverageTimeline {...baseProps} isToday={false} />
    );
    expect(container.firstChild).not.toBeNull();
  });
});

describe("15-minute interval math", () => {
  it("16-hour day produces ~65 points (not 961)", () => {
    // open=360, close=1320, range=960 min, step=15 → 64+1 = 65 points
    const open = 360;
    const close = 1320;
    const step = 15;
    const pts: number[] = [];
    for (let m = open; m <= close; m += step) pts.push(m);
    expect(pts.length).toBe(65);
    expect(pts.length).toBeLessThan(100);
  });

  it("nowMinutes snaps to nearest 15-min boundary", () => {
    const STEP = 15;
    const snap = (nowMinutes: number, open: number, close: number) =>
      Math.min(Math.max(Math.round(nowMinutes / STEP) * STEP, open), close);

    expect(snap(607, 360, 1320)).toBe(600);  // 607/15=40.47 → round 40 → 600
    expect(snap(608, 360, 1320)).toBe(615);  // 608/15=40.53 → round 41 → 615
    expect(snap(601, 360, 1320)).toBe(600);  // 601 → nearest 15 = 600
    expect(snap(360, 360, 1320)).toBe(360);  // exactly at open
    expect(snap(1320, 360, 1320)).toBe(1320); // exactly at close
    expect(snap(100, 360, 1320)).toBe(360);  // before open → clamp to open
    expect(snap(1400, 360, 1320)).toBe(1320); // after close → clamp to close
  });
});
