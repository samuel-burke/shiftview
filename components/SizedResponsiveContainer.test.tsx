import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { Bar, BarChart } from "recharts";
import SizedResponsiveContainer from "./SizedResponsiveContainer";

// jsdom has no layout, so give every element the box the chart's parent would have.
function mockBox(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  );
}

function renderChart() {
  return render(
    <SizedResponsiveContainer>
      <BarChart data={[{ v: 1 }]}>
        <Bar dataKey="v" />
      </BarChart>
    </SizedResponsiveContainer>
  );
}

const sizeWarning = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.some((args: unknown[]) => String(args[0]).includes("should be greater than 0"));

afterEach(() => vi.restoreAllMocks());

describe("SizedResponsiveContainer", () => {
  it("mounts the chart at the box's size without recharts' -1×-1 warning", () => {
    mockBox(300, 120);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderChart();
    expect(container.querySelector(".recharts-responsive-container")).not.toBeNull();
    expect(sizeWarning(warn)).toBe(false);
  });

  it("waits while the box has no size", () => {
    mockBox(0, 0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderChart();
    expect(container.querySelector(".recharts-responsive-container")).toBeNull();
    expect(sizeWarning(warn)).toBe(false);
  });
});
