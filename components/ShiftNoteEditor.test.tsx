import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShiftNoteEditor from "./ShiftNoteEditor";

describe("ShiftNoteEditor", () => {
  it("shows a read-only note when not editable", () => {
    render(<ShiftNoteEditor note="Lock up" canEdit={false} />);
    expect(screen.getByTestId("shift-note-readonly")).toHaveTextContent("Lock up");
    expect(screen.queryByTestId("shift-note-editor")).not.toBeInTheDocument();
  });

  it("renders nothing read-only when there is no note", () => {
    const { container } = render(<ShiftNoteEditor note={null} canEdit={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("saves a trimmed note", async () => {
    const onSave = vi.fn();
    render(<ShiftNoteEditor note={null} canEdit onSave={onSave} />);
    await userEvent.type(screen.getByLabelText("Shift note"), "  Training ");
    await userEvent.click(screen.getByRole("button", { name: /save note/i }));
    expect(onSave).toHaveBeenCalledWith("Training");
  });

  it("saves null when cleared to empty", async () => {
    const onSave = vi.fn();
    render(<ShiftNoteEditor note="Old" canEdit onSave={onSave} />);
    await userEvent.clear(screen.getByLabelText("Shift note"));
    await userEvent.click(screen.getByRole("button", { name: /save note/i }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("prefills the existing note", () => {
    render(<ShiftNoteEditor note="Existing" canEdit onSave={vi.fn()} />);
    expect(screen.getByLabelText("Shift note")).toHaveValue("Existing");
  });
});
