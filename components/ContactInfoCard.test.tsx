import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContactInfoCard, { type ContactInfo } from "./ContactInfoCard";

const contact: ContactInfo = {
  phone: "555-111-2222",
  emergencyContactName: "Pat Doe",
  emergencyContactPhone: "555-333-4444",
};

describe("ContactInfoCard", () => {
  it("displays phone and emergency contact", () => {
    render(<ContactInfoCard contact={contact} />);
    expect(screen.getByText("555-111-2222")).toBeInTheDocument();
    expect(screen.getByText(/Pat Doe · 555-333-4444/)).toBeInTheDocument();
  });

  it("shows dashes for missing values", () => {
    render(<ContactInfoCard contact={{ phone: null, emergencyContactName: null, emergencyContactPhone: null }} />);
    expect(screen.getAllByText("—").length).toBe(2);
  });

  it("hides the edit control when not editable", () => {
    render(<ContactInfoCard contact={contact} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("saves edited, normalized contact info", async () => {
    const onSave = vi.fn();
    render(<ContactInfoCard contact={contact} canEdit onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const phone = screen.getByLabelText("Phone");
    await userEvent.clear(phone);
    await userEvent.type(phone, "  555-999-8888 ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "555-999-8888", emergencyContactName: "Pat Doe" })
    );
  });

  it("shows a validation error for a bad phone and does not save", async () => {
    const onSave = vi.fn();
    render(<ContactInfoCard contact={contact} canEdit onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const phone = screen.getByLabelText("Phone");
    await userEvent.clear(phone);
    await userEvent.type(phone, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
