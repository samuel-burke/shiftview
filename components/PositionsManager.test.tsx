import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PositionsManager, { type Position } from "./PositionsManager";

const positions: Position[] = [
  { id: 1, name: "Cashier", color: "#f00" },
  { id: 2, name: "Cook" },
];

describe("PositionsManager", () => {
  it("lists existing positions", () => {
    render(<PositionsManager positions={positions} onCreate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId("position-row-1")).toHaveTextContent("Cashier");
    expect(screen.getByTestId("position-row-2")).toHaveTextContent("Cook");
  });

  it("shows an empty state with no positions", () => {
    render(<PositionsManager positions={[]} onCreate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/no positions yet/i)).toBeInTheDocument();
  });

  it("creates a trimmed position name", async () => {
    const onCreate = vi.fn();
    render(<PositionsManager positions={positions} onCreate={onCreate} onDelete={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Position name"), "  Floor ");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onCreate).toHaveBeenCalledWith("Floor");
  });

  it("shows a validation error and does not create on an empty name", async () => {
    const onCreate = vi.fn();
    render(<PositionsManager positions={positions} onCreate={onCreate} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("deletes a position", async () => {
    const onDelete = vi.fn();
    render(<PositionsManager positions={positions} onCreate={vi.fn()} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /delete cook/i }));
    expect(onDelete).toHaveBeenCalledWith(2);
  });
});
