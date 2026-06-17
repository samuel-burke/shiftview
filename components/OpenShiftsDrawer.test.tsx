import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OpenShiftsDrawer, { formatDate, type OpenShiftView } from "./OpenShiftsDrawer";

afterEach(() => vi.restoreAllMocks());

const openShift: OpenShiftView = {
  id: 1,
  date: "2026-07-01",
  startMinutes: 480,
  endMinutes: 960,
  note: "Backfilling a call-out",
  status: "open",
  claims: [],
};

describe("OpenShiftsDrawer — formatDate", () => {
  it("formats an ISO date into a readable label", () => {
    expect(formatDate("2026-07-01")).toMatch(/July/);
  });
});

describe("OpenShiftsDrawer — manager", () => {
  it("renders nothing when closed", () => {
    render(
      <OpenShiftsDrawer
        open={false}
        onClose={() => {}}
        role="manager"
        openShifts={[openShift]}
        onApproveClaim={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByTestId("open-shifts-drawer")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no open shifts", () => {
    render(
      <OpenShiftsDrawer
        open
        onClose={() => {}}
        role="manager"
        openShifts={[]}
        onApproveClaim={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/no open shifts posted/i)).toBeInTheDocument();
  });

  it("lets a manager cancel a shift with no claims", async () => {
    const onCancel = vi.fn();
    render(
      <OpenShiftsDrawer
        open
        onClose={() => {}}
        role="manager"
        openShifts={[openShift]}
        onApproveClaim={vi.fn()}
        onCancel={onCancel}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /cancel open shift/i }));
    expect(onCancel).toHaveBeenCalledWith(1);
  });

  it("lets a manager assign a pending claimant", async () => {
    const onApproveClaim = vi.fn();
    const withClaim: OpenShiftView = {
      ...openShift,
      claims: [{ id: 7, employeeId: 5, employeeName: "Alex P", status: "pending" }],
    };
    render(
      <OpenShiftsDrawer
        open
        onClose={() => {}}
        role="manager"
        openShifts={[withClaim]}
        onApproveClaim={onApproveClaim}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText("Alex P")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /assign alex p/i }));
    expect(onApproveClaim).toHaveBeenCalledWith(1, 7);
  });

  it("shows a filled shift with the assignee", () => {
    const filled: OpenShiftView = { ...openShift, status: "filled", filledByName: "Jordan K" };
    render(
      <OpenShiftsDrawer
        open
        onClose={() => {}}
        role="manager"
        openShifts={[filled]}
        onApproveClaim={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/picked up by jordan k/i)).toBeInTheDocument();
  });
});

describe("OpenShiftsDrawer — employee", () => {
  it("lets an employee claim a shift", async () => {
    const onClaim = vi.fn();
    render(
      <OpenShiftsDrawer
        open
        onClose={() => {}}
        role="employee"
        openShifts={[{ ...openShift, claims: undefined }]}
        onClaim={onClaim}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /claim the shift/i }));
    expect(onClaim).toHaveBeenCalledWith(1);
  });

  it("shows a pending state instead of a claim button once claimed", () => {
    render(
      <OpenShiftsDrawer
        open
        onClose={() => {}}
        role="employee"
        openShifts={[{ ...openShift, myClaimStatus: "pending" }]}
        onClaim={vi.fn()}
      />
    );
    expect(screen.getByText(/claim pending approval/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /claim the shift/i })).not.toBeInTheDocument();
  });
});
