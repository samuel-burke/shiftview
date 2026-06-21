import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShiftLogFeed, { type ShiftLogEntry } from "./ShiftLogFeed";

const entries: ShiftLogEntry[] = [
  { id: 1, employeeId: 5, authorName: "Alex P", body: "Freezer warm", createdAt: "2026-06-17T14:00:00Z" },
  { id: 2, employeeId: 9, authorName: "Jordan K", body: "Out of cups", createdAt: "2026-06-17T15:00:00Z" },
];

describe("ShiftLogFeed", () => {
  it("renders entries with authors", () => {
    render(<ShiftLogFeed entries={entries} onPost={vi.fn()} />);
    expect(within(screen.getByTestId("shift-log-entry-1")).getByText("Alex P")).toBeInTheDocument();
    expect(within(screen.getByTestId("shift-log-entry-1")).getByText("Freezer warm")).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    render(<ShiftLogFeed entries={[]} onPost={vi.fn()} />);
    expect(screen.getByText(/no entries yet today/i)).toBeInTheDocument();
  });

  it("posts a trimmed entry", async () => {
    const onPost = vi.fn();
    render(<ShiftLogFeed entries={entries} onPost={onPost} />);
    await userEvent.type(screen.getByLabelText("Shift log entry"), "  Restock napkins ");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(onPost).toHaveBeenCalledWith("Restock napkins");
  });

  it("validates an empty entry", async () => {
    const onPost = vi.fn();
    render(<ShiftLogFeed entries={entries} onPost={onPost} />);
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(onPost).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("lets the author delete their own entry but not others", () => {
    render(
      <ShiftLogFeed entries={entries} currentEmployeeId={5} onPost={vi.fn()} onDelete={vi.fn()} />
    );
    expect(within(screen.getByTestId("shift-log-entry-1")).getByRole("button", { name: /delete entry/i })).toBeInTheDocument();
    expect(within(screen.getByTestId("shift-log-entry-2")).queryByRole("button", { name: /delete entry/i })).not.toBeInTheDocument();
  });

  it("lets a manager delete any entry", async () => {
    const onDelete = vi.fn();
    render(
      <ShiftLogFeed entries={entries} currentEmployeeId={null} isManager onPost={vi.fn()} onDelete={onDelete} />
    );
    await userEvent.click(
      within(screen.getByTestId("shift-log-entry-2")).getByRole("button", { name: /delete entry/i })
    );
    expect(onDelete).toHaveBeenCalledWith(2);
  });
});
