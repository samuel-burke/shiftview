import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShiftPreferencesPicker from "./ShiftPreferencesPicker";

describe("ShiftPreferencesPicker", () => {
  it("reflects the current selection via aria-pressed", () => {
    render(<ShiftPreferencesPicker value={["opener", "closer"]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Opener" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Mid" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the no-preference hint when nothing is selected", () => {
    render(<ShiftPreferencesPicker value={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/no preference/i)).toBeInTheDocument();
  });

  it("adds a type in canonical order on toggle", async () => {
    const onChange = vi.fn();
    render(<ShiftPreferencesPicker value={["closer"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Opener" }));
    expect(onChange).toHaveBeenCalledWith(["opener", "closer"]);
  });

  it("removes a selected type on toggle", async () => {
    const onChange = vi.fn();
    render(<ShiftPreferencesPicker value={["opener", "closer"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Opener" }));
    expect(onChange).toHaveBeenCalledWith(["closer"]);
  });

  it("does not fire when read-only", async () => {
    const onChange = vi.fn();
    render(<ShiftPreferencesPicker value={["opener"]} canEdit={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Mid" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
