import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import KeyboardShortcuts from "./KeyboardShortcuts";
import type { NavItem } from "./AppShell";

function Harness({ active }: { active: NavItem }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <input aria-label="Search" />
      <KeyboardShortcuts active={active} open={open} onOpenChange={setOpen} />
    </>
  );
}

describe("KeyboardShortcuts", () => {
  it("opens on ? with this page's shortcuts and closes on Escape", () => {
    render(<Harness active="week" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "?" });
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveTextContent("Team week");
    expect(dialog).toHaveTextContent("Back to this week");
    expect(dialog).toHaveTextContent("Everywhere");
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows only the shared shortcuts on pages without their own", () => {
    render(<Harness active="team" />);
    fireEvent.keyDown(document, { key: "?" });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Everywhere");
    expect(dialog).not.toHaveTextContent("Team week");
    expect(dialog).not.toHaveTextContent("Requests");
  });

  it("ignores ? typed into a field", () => {
    render(<Harness active="requests" />);
    const input = screen.getByRole("textbox", { name: "Search" });
    input.focus();
    fireEvent.keyDown(input, { key: "?" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when the backdrop or close button is used", () => {
    const onOpenChange = vi.fn();
    render(<KeyboardShortcuts active="requests" open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
