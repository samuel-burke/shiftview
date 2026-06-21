import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SkillTags, { type Skill } from "./SkillTags";

const skills: Skill[] = [
  { id: 1, name: "Keyholder" },
  { id: 2, name: "Barista" },
];

describe("SkillTags", () => {
  it("renders skill chips", () => {
    render(<SkillTags skills={skills} />);
    expect(within(screen.getByTestId("skill-1")).getByText("Keyholder")).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    render(<SkillTags skills={[]} />);
    expect(screen.getByText(/no skills listed/i)).toBeInTheDocument();
  });

  it("hides add/remove for non-managers", () => {
    render(<SkillTags skills={skills} canManage={false} onDelete={vi.fn()} />);
    expect(screen.queryByLabelText("New skill")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("lets a manager add a trimmed skill", async () => {
    const onAdd = vi.fn();
    render(<SkillTags skills={skills} canManage onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText("New skill"), "  Forklift ");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith("Forklift");
  });

  it("validates an empty skill", async () => {
    const onAdd = vi.fn();
    render(<SkillTags skills={skills} canManage onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("lets a manager remove a skill", async () => {
    const onDelete = vi.fn();
    render(<SkillTags skills={skills} canManage onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /remove barista/i }));
    expect(onDelete).toHaveBeenCalledWith(2);
  });
});
