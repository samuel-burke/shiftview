import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmployeeNotes, { type EmployeeNote } from "./EmployeeNotes";

const notes: EmployeeNote[] = [
  { id: 1, body: "Coached on lateness", authorName: "Boss", createdAt: "2026-06-15T12:00:00Z" },
];

describe("EmployeeNotes", () => {
  it("renders notes with author", () => {
    render(<EmployeeNotes notes={notes} onAdd={vi.fn()} />);
    expect(within(screen.getByTestId("employee-note-1")).getByText("Coached on lateness")).toBeInTheDocument();
    expect(within(screen.getByTestId("employee-note-1")).getByText(/Boss/)).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    render(<EmployeeNotes notes={[]} onAdd={vi.fn()} />);
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it("saves a trimmed note", async () => {
    const onAdd = vi.fn();
    render(<EmployeeNotes notes={notes} onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText("New manager note"), "  Great shift ");
    await userEvent.click(screen.getByRole("button", { name: /save note/i }));
    expect(onAdd).toHaveBeenCalledWith("Great shift");
  });

  it("validates an empty note", async () => {
    const onAdd = vi.fn();
    render(<EmployeeNotes notes={notes} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: /save note/i }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("lets a manager delete a note", async () => {
    const onDelete = vi.fn();
    render(<EmployeeNotes notes={notes} onAdd={vi.fn()} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /delete note 1/i }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });
});
