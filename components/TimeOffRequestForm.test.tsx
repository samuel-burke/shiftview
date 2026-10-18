import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TimeOffRequestForm from "./TimeOffRequestForm";

const DATE = "2026-10-20";

function setup(submitting = false) {
  const onSubmit = vi.fn();
  render(<TimeOffRequestForm date={DATE} submitting={submitting} onSubmit={onSubmit} />);
  return onSubmit;
}

describe("TimeOffRequestForm", () => {
  it("requests the whole day by default", async () => {
    const onSubmit = setup();
    await userEvent.click(screen.getByRole("button", { name: "Request Day Off" }));
    expect(onSubmit).toHaveBeenCalledWith({ date: DATE });
  });

  it("requests several days through an end date", async () => {
    const onSubmit = setup();
    await userEvent.click(screen.getByRole("radio", { name: "Several days" }));
    fireEvent.change(screen.getByLabelText("Last day off"), { target: { value: "2026-10-24" } });
    await userEvent.click(screen.getByRole("button", { name: /Request Oct 20 – Oct 24 Off/ }));
    expect(onSubmit).toHaveBeenCalledWith({ date: DATE, endDate: "2026-10-24" });
  });

  it("won't send an end date on or before the first day, or past the limit", async () => {
    const onSubmit = setup();
    await userEvent.click(screen.getByRole("radio", { name: "Several days" }));
    fireEvent.change(screen.getByLabelText("Last day off"), { target: { value: DATE } });
    await userEvent.click(screen.getByRole("button", { name: /^Request .* Off$/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/after the first day/);
    fireEvent.change(screen.getByLabelText("Last day off"), { target: { value: "2026-12-31" } });
    await userEvent.click(screen.getByRole("button", { name: /^Request .* Off$/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/at most 31 days/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("requests part of the day in minutes", async () => {
    const onSubmit = setup();
    await userEvent.click(screen.getByRole("radio", { name: "Part of day" }));
    fireEvent.change(screen.getByLabelText("Off from"), { target: { value: "15:00" } });
    fireEvent.change(screen.getByLabelText("Off until"), { target: { value: "18:30" } });
    await userEvent.click(screen.getByRole("button", { name: "Request Time Off" }));
    expect(onSubmit).toHaveBeenCalledWith({ date: DATE, startMinutes: 900, endMinutes: 1110 });
  });

  it("won't send a part day that ends before it starts", async () => {
    const onSubmit = setup();
    await userEvent.click(screen.getByRole("radio", { name: "Part of day" }));
    fireEvent.change(screen.getByLabelText("Off from"), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText("Off until"), { target: { value: "09:00" } });
    await userEvent.click(screen.getByRole("button", { name: "Request Time Off" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/same day/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables the button while submitting", () => {
    setup(true);
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
  });
});
