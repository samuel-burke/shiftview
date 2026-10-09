import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InviteSheet from "./InviteSheet";

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

async function invite() {
  const onSuccess = vi.fn();
  render(<InviteSheet open onClose={() => {}} onSuccess={onSuccess} />);
  await userEvent.type(screen.getByLabelText("Full Name"), "Alice Smith");
  await userEvent.type(screen.getByLabelText("Email"), "alice@example.com");
  await userEvent.click(screen.getByRole("button", { name: /send invite/i }));
  return onSuccess;
}

afterEach(() => vi.unstubAllGlobals());

describe("InviteSheet", () => {
  it("confirms an emailed invite", async () => {
    respond(201, { ok: true, employeeId: 5 });
    const onSuccess = await invite();
    expect(await screen.findByText("Invite sent!")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalled();
  });

  it("says when the person already had an account and was added directly", async () => {
    respond(201, { ok: true, employeeId: 5, existingAccount: true });
    await invite();
    expect(await screen.findByText("Added to your team")).toBeInTheDocument();
    expect(screen.getByText(/already has a ShiftView account/)).toBeInTheDocument();
  });

  it("shows the server's reason when the invite is refused", async () => {
    respond(409, { error: "Someone with that email is already on your team" });
    const onSuccess = await invite();
    expect(await screen.findByText("Someone with that email is already on your team")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
