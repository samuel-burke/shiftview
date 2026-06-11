import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminPageClient from "./adminPageClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

const CURRENT_USER_ID = "user-manager";

const MOCK_EMPLOYEES = [
  { id: 1, name: "Alice Smith", email: "alice@example.com", user_id: CURRENT_USER_ID },
  { id: 2, name: "Bob Jones",   email: "bob@example.com",   user_id: "user-bob" },
  { id: 3, name: "Carol White", email: "carol@example.com", user_id: null },
];

const MOCK_MANAGER_IDS = { managerUserIds: [CURRENT_USER_ID, "user-bob"] };

function mockFetch(overrides: Record<string, object> = {}) {
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = input.toString();
    if (url.includes("/api/employees"))
      return { ok: true, json: async () => overrides.employees ?? MOCK_EMPLOYEES } as Response;
    if (url.includes("/api/managers"))
      return { ok: true, json: async () => overrides.managers ?? MOCK_MANAGER_IDS } as Response;
    return { ok: false, json: async () => ({}) } as Response;
  });
}

describe("AdminPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function renderAndWait(props = { currentUserId: CURRENT_USER_ID }) {
    mockFetch();
    render(<AdminPageClient {...props} />);
    await screen.findByText("Alice Smith");
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  it("shows the Admin heading", async () => {
    await renderAndWait();
    expect(screen.getAllByText("Admin")[0]).toBeInTheDocument();
  });

  it("shows the Roles section heading", async () => {
    await renderAndWait();
    expect(screen.getByText("Roles", { exact: true })).toBeInTheDocument();
  });

  it("renders all employees", async () => {
    await renderAndWait();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expect(screen.getByText("Carol White")).toBeInTheDocument();
  });

  it("shows Manager badge for employees with a manager user_id", async () => {
    await renderAndWait();
    const managerBadges = screen.getAllByText("Manager");
    expect(managerBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Employee badge for non-manager employees", async () => {
    await renderAndWait();
    const employeeBadges = screen.getAllByText("Employee");
    expect(employeeBadges.length).toBeGreaterThanOrEqual(1);
  });

  // ── Self row ───────────────────────────────────────────────────────────────

  it("shows 'You' on the current user's row instead of a toggle button", async () => {
    await renderAndWait();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("does not show a Demote button for the current user", async () => {
    await renderAndWait();
    const demoteButtons = screen.queryAllByRole("button", { name: /demote alice/i });
    expect(demoteButtons).toHaveLength(0);
  });

  // ── No account row ─────────────────────────────────────────────────────────

  it("shows 'No account' for employees without a linked user_id", async () => {
    await renderAndWait();
    expect(screen.getByText("No account")).toBeInTheDocument();
  });

  it("does not show a toggle button for employees with no user_id", async () => {
    await renderAndWait();
    expect(screen.queryByRole("button", { name: /promote carol/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /demote carol/i })).not.toBeInTheDocument();
  });

  // ── Promote / Demote buttons ───────────────────────────────────────────────

  it("shows Demote button for other managers", async () => {
    await renderAndWait();
    expect(screen.getByRole("button", { name: /demote bob/i })).toBeInTheDocument();
  });

  it("optimistically toggles Manager → Employee when Demote is clicked", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = input.toString();
      if (url.includes("/api/employees"))
        return { ok: true, json: async () => MOCK_EMPLOYEES } as Response;
      if (url.includes("/api/managers") && (!init || init.method !== "PUT"))
        return { ok: true, json: async () => MOCK_MANAGER_IDS } as Response;
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    });

    render(<AdminPageClient currentUserId={CURRENT_USER_ID} />);
    await screen.findByText("Bob Jones");

    await userEvent.click(screen.getByRole("button", { name: /demote bob/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /promote bob/i })).toBeInTheDocument();
    });
  });

  it("reverts the toggle and shows an error message when the API returns an error", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = input.toString();
      if (url.includes("/api/employees"))
        return { ok: true, json: async () => MOCK_EMPLOYEES } as Response;
      if (url.includes("/api/managers") && (!init || init.method !== "PUT"))
        return { ok: true, json: async () => MOCK_MANAGER_IDS } as Response;
      return { ok: false, json: async () => ({ error: "Manager access required" }) } as Response;
    });

    render(<AdminPageClient currentUserId={CURRENT_USER_ID} />);
    await screen.findByText("Bob Jones");

    await userEvent.click(screen.getByRole("button", { name: /demote bob/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /demote bob/i })).toBeInTheDocument();
    });
    expect(screen.getByText("Manager access required")).toBeInTheDocument();
  });

  it("shows empty state when there are no employees", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("/api/employees"))
        return { ok: true, json: async () => [] } as Response;
      if (url.includes("/api/managers"))
        return { ok: true, json: async () => ({ managerUserIds: [] }) } as Response;
      return { ok: false, json: async () => ({}) } as Response;
    });
    render(<AdminPageClient currentUserId={CURRENT_USER_ID} />);
    await waitFor(() => {
      expect(screen.getByText("No employees")).toBeInTheDocument();
    });
  });
});
