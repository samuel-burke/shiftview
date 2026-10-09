import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserMenu from "./UserMenu";
import type { MeData } from "@/lib/AppDataContext";

const switchOrganization = vi.fn<(orgId: string) => Promise<string | null>>();
let me: MeData;

vi.mock("@/lib/AppDataContext", () => ({
  useAppData: () => ({ me, switchOrganization }),
}));

const ALDER = { id: "org-a", name: "Alder Street", isManager: true };
const BIRCH = { id: "org-b", name: "Birch Lane", isManager: false };

function meIn(organizations: MeData["organizations"], orgId = organizations[0]?.id ?? null): MeData {
  return { isManager: true, employeeId: 1, employeeName: "Sam", isDemo: false, orgId, organizations };
}

async function openMenu() {
  render(<UserMenu name="Sam Burke" onSignOut={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "User menu" }));
}

beforeEach(() => {
  switchOrganization.mockReset();
});

describe("UserMenu organization switcher", () => {
  it("is hidden for someone in a single organization", async () => {
    me = meIn([ALDER]);
    await openMenu();
    expect(screen.queryByRole("group", { name: "Organization" })).toBeNull();
  });

  it("lists every organization and marks the current one", async () => {
    me = meIn([ALDER, BIRCH], BIRCH.id);
    await openMenu();
    expect(screen.getByRole("menuitemradio", { name: "Birch Lane" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Alder Street" })).toHaveAttribute("aria-checked", "false");
  });

  it("switches when another organization is picked", async () => {
    me = meIn([ALDER, BIRCH], ALDER.id);
    switchOrganization.mockReturnValue(new Promise(() => {})); // the app reloads on success
    await openMenu();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Birch Lane" }));
    expect(switchOrganization).toHaveBeenCalledWith(BIRCH.id);
    expect(screen.getByText("Switching…")).toBeInTheDocument();
  });

  it("does nothing for the current organization", async () => {
    me = meIn([ALDER, BIRCH], ALDER.id);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Alder Street" }));
    expect(switchOrganization).not.toHaveBeenCalled();
  });

  it("shows why a switch failed", async () => {
    me = meIn([ALDER, BIRCH], ALDER.id);
    switchOrganization.mockResolvedValue("You aren't a member of that organization");
    await openMenu();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Birch Lane" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You aren't a member of that organization");
  });
});
