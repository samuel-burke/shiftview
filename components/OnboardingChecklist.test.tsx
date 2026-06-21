import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OnboardingChecklist, { type OnboardingItem } from "./OnboardingChecklist";

const items: OnboardingItem[] = [
  { id: 1, label: "Sign W-4", done: true },
  { id: 2, label: "Uniform issued", done: false },
];

describe("OnboardingChecklist", () => {
  it("shows progress", () => {
    render(<OnboardingChecklist items={items} />);
    expect(screen.getByTestId("onboarding-progress")).toHaveTextContent("1/2 · 50%");
  });

  it("renders items with checkboxes", () => {
    render(<OnboardingChecklist items={items} />);
    expect(within(screen.getByTestId("onboarding-item-1")).getByRole("checkbox")).toBeChecked();
    expect(within(screen.getByTestId("onboarding-item-2")).getByRole("checkbox")).not.toBeChecked();
  });

  it("disables checkboxes and hides add/remove for non-managers", () => {
    render(<OnboardingChecklist items={items} canManage={false} />);
    expect(within(screen.getByTestId("onboarding-item-1")).getByRole("checkbox")).toBeDisabled();
    expect(screen.queryByLabelText("New onboarding task")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("lets a manager toggle an item", async () => {
    const onToggle = vi.fn();
    render(<OnboardingChecklist items={items} canManage onToggle={onToggle} />);
    await userEvent.click(within(screen.getByTestId("onboarding-item-2")).getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith(2, true);
  });

  it("lets a manager add a trimmed task", async () => {
    const onAdd = vi.fn();
    render(<OnboardingChecklist items={items} canManage onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText("New onboarding task"), "  POS training ");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith("POS training");
  });

  it("validates an empty task", async () => {
    const onAdd = vi.fn();
    render(<OnboardingChecklist items={items} canManage onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("lets a manager remove an item", async () => {
    const onDelete = vi.fn();
    render(<OnboardingChecklist items={items} canManage onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /delete uniform issued/i }));
    expect(onDelete).toHaveBeenCalledWith(2);
  });
});
