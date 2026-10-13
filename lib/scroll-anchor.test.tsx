import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useState } from "react";
import { useScrollAnchor } from "./scroll-anchor";

// Where each anchor sits on screen, by key; tests move them between renders.
let tops: Record<string, number> = {};

function rectFor(el: Element): DOMRect {
  const key = (el as HTMLElement).dataset.scrollAnchor;
  const top = key !== undefined ? tops[key] ?? -1000 : 0;
  return { top, bottom: top + 50, height: 50, left: 0, right: 100, width: 100, x: 0, y: top, toJSON() {} } as DOMRect;
}

function List() {
  const keep = useScrollAnchor();
  const [rows, setRows] = useState(["b", "c"]);
  return (
    <div>
      <button onClick={() => { keep(); setRows(["a", ...rows]); }}>insert</button>
      {rows.map((r) => <div key={r} data-scroll-anchor={r}>{r}</div>)}
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  tops = {};
});

describe("useScrollAnchor", () => {
  it("scrolls by however far the first visible anchor moved", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) { return rectFor(this); });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 300 });
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const { getByText } = render(<List />);
    tops = { b: 20, c: 70 };
    act(() => {
      getByText("insert").click();
      // The insert lands above "b" and pushes it down by a row.
      tops = { a: 20, b: 70, c: 120 };
    });
    expect(scrollBy).toHaveBeenCalledWith(0, 50);
  });

  it("leaves the page alone at the very top", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) { return rectFor(this); });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const { getByText } = render(<List />);
    tops = { b: 20, c: 70 };
    act(() => { getByText("insert").click(); tops = { a: 20, b: 70, c: 120 }; });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
