import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CertificationsList, { type Certification } from "./CertificationsList";

const certs: Certification[] = [
  { id: 1, name: "Food Handler", expiresOn: "2026-07-01", status: "expiring" },
  { id: 2, name: "First Aid", expiresOn: "2025-01-01", status: "expired" },
  { id: 3, name: "Alcohol Service", expiresOn: null, status: "no_expiry" },
];

describe("CertificationsList", () => {
  it("lists each certification with its status badge", () => {
    render(<CertificationsList certifications={certs} />);
    expect(within(screen.getByTestId("certification-1")).getByText("Food Handler")).toBeInTheDocument();
    expect(within(screen.getByTestId("certification-1")).getByText("Expiring")).toBeInTheDocument();
    expect(within(screen.getByTestId("certification-2")).getByText("Expired")).toBeInTheDocument();
    expect(within(screen.getByTestId("certification-3")).getByText("No expiry")).toBeInTheDocument();
  });

  it("shows an empty state with no certifications", () => {
    render(<CertificationsList certifications={[]} />);
    expect(screen.getByText(/no certifications on file/i)).toBeInTheDocument();
  });

  it("hides remove controls for non-managers", () => {
    render(<CertificationsList certifications={certs} canManage={false} onDelete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("lets a manager delete a certification", async () => {
    const onDelete = vi.fn();
    render(<CertificationsList certifications={certs} canManage onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /delete first aid/i }));
    expect(onDelete).toHaveBeenCalledWith(2);
  });
});
