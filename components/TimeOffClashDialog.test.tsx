import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TimeOffClashDialog from "./TimeOffClashDialog";

const SHIFTS = [
  { id: 1, date: "2026-10-20", startMinutes: 540, endMinutes: 1020 },
  { id: 2, date: "2026-10-21", startMinutes: 540, endMinutes: 1020 },
];

function setup(props: Partial<Parameters<typeof TimeOffClashDialog>[0]> = {}) {
  const handlers = { onRemove: vi.fn(), onKeep: vi.fn(), onCancel: vi.fn() };
  render(<TimeOffClashDialog open employeeName="Alice" shifts={SHIFTS} busy={false} {...handlers} {...props} />);
  return handlers;
}

describe("TimeOffClashDialog", () => {
  it("lists the clashing shifts and offers remove, keep, or cancel", async () => {
    const h = setup();
    expect(screen.getByText("Alice is scheduled then")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Approve and remove 2 shifts" }));
    expect(h.onRemove).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Approve and keep them" }));
    expect(h.onKeep).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it("speaks of one shift in the singular", () => {
    setup({ shifts: [SHIFTS[0]] });
    expect(screen.getByRole("button", { name: "Approve and remove the shift" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve and keep it" })).toBeInTheDocument();
  });

  it("disables every choice while saving", () => {
    setup({ busy: true });
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByTestId("time-off-clash-dialog")).not.toBeInTheDocument();
  });
});
