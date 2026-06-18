import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AcknowledgeScheduleButton, ScheduleAckStatus } from "./ScheduleAck";
import { splitAckStatus } from "../lib/schedule-ack";

describe("AcknowledgeScheduleButton", () => {
  it("shows a confirm button when not yet acknowledged and fires the handler", async () => {
    const onAcknowledge = vi.fn();
    render(<AcknowledgeScheduleButton acknowledged={false} onAcknowledge={onAcknowledge} />);
    await userEvent.click(screen.getByTestId("schedule-ack-button"));
    expect(onAcknowledge).toHaveBeenCalledOnce();
  });

  it("shows a confirmed state once acknowledged", () => {
    render(<AcknowledgeScheduleButton acknowledged onAcknowledge={vi.fn()} />);
    expect(screen.getByTestId("schedule-ack-confirmed")).toHaveTextContent(/confirmed/i);
    expect(screen.queryByTestId("schedule-ack-button")).not.toBeInTheDocument();
  });
});

describe("ScheduleAckStatus", () => {
  const status = splitAckStatus(
    [
      { employeeId: 1, employeeName: "Alex P" },
      { employeeId: 2, employeeName: "Jordan K" },
    ],
    [{ employeeId: 1, acknowledgedAt: "t" }]
  );

  it("summarizes the confirmed count", () => {
    render(<ScheduleAckStatus status={status} />);
    expect(screen.getByText("1/2 confirmed")).toBeInTheDocument();
  });

  it("lists pending and confirmed employees separately", () => {
    render(<ScheduleAckStatus status={status} />);
    expect(within(screen.getByTestId("schedule-ack-pending")).getByText("Jordan K")).toBeInTheDocument();
    expect(within(screen.getByTestId("schedule-ack-confirmed-list")).getByText("Alex P")).toBeInTheDocument();
  });

  it("shows an empty state when no one is scheduled", () => {
    render(<ScheduleAckStatus status={splitAckStatus([], [])} />);
    expect(screen.getByText(/no one scheduled/i)).toBeInTheDocument();
  });

  it("hides the pending section when everyone has confirmed", () => {
    const all = splitAckStatus(
      [{ employeeId: 1, employeeName: "Alex P" }],
      [{ employeeId: 1, acknowledgedAt: "t" }]
    );
    render(<ScheduleAckStatus status={all} />);
    expect(screen.queryByTestId("schedule-ack-pending")).not.toBeInTheDocument();
    expect(screen.getByText("1/1 confirmed")).toBeInTheDocument();
  });
});
