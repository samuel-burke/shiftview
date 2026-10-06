import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBreakpoint, sizeClassFor } from "./useBreakpoint";

const originalMatchMedia = window.matchMedia;

function mockWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: width >= min,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("sizeClassFor", () => {
  it("maps widths to size classes at the breakpoint boundaries", () => {
    expect(sizeClassFor(390)).toBe("compact");
    expect(sizeClassFor(599)).toBe("compact");
    expect(sizeClassFor(600)).toBe("tablet");
    expect(sizeClassFor(820)).toBe("tablet");
    expect(sizeClassFor(1023)).toBe("tablet");
    expect(sizeClassFor(1024)).toBe("desk");
    expect(sizeClassFor(1180)).toBe("desk");
    expect(sizeClassFor(1440)).toBe("wide");
    expect(sizeClassFor(2560)).toBe("wide");
  });
});

describe("useBreakpoint", () => {
  it.each([
    [390, "compact"],
    [820, "tablet"],
    [1180, "desk"],
    [1600, "wide"],
  ] as const)("returns %s → %s", (width, expected) => {
    mockWidth(width);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe(expected);
  });
});
