import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PublishDialog from "./PublishDialog";

const base = { open: true, publishing: false, weekLabel: "Oct 17 – Oct 23, 2026", clashCount: 0, onCancel: vi.fn(), onConfirm: vi.fn() };

describe("PublishDialog", () => {
  it("counts new shifts for a fresh week", () => {
    render(<PublishDialog {...base} publishCount={3} />);
    expect(screen.getByText(/3 draft shifts for Oct 17 – Oct 23, 2026 will go live/)).toBeInTheDocument();
  });

  it("separates changes to live shifts from new ones", () => {
    render(<PublishDialog {...base} publishCount={3} changeCount={2} />);
    expect(screen.getByText(/1 new shift and 2 changes to live shifts .* Each person is told once what changed for them\./)).toBeInTheDocument();
  });

  it("speaks of changes alone when there's nothing new", () => {
    render(<PublishDialog {...base} publishCount={1} changeCount={1} />);
    expect(screen.getByText(/^1 change to live shifts/)).toBeInTheDocument();
  });

  it("still warns about drafts that won't publish", () => {
    render(<PublishDialog {...base} publishCount={1} clashCount={2} />);
    expect(screen.getByText(/2 drafts won't publish/)).toBeInTheDocument();
  });
});
