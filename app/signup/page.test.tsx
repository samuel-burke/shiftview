import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignupPage from "./page";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush, refresh: vi.fn() }) }));

const mockSignInWithOtp = vi.fn().mockResolvedValue({ error: null });
const mockVerifyOtp = vi.fn().mockResolvedValue({ error: null });
const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
const mockSignOut = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: mockSignInWithOtp,
      verifyOtp: mockVerifyOtp,
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  }),
}));

function mockFetch(response: { ok: boolean; body?: object }) {
  return vi.spyOn(global, "fetch").mockResolvedValue({
    ok: response.ok,
    json: async () => response.body ?? {},
  } as Response);
}

async function fillDetails() {
  render(<SignupPage />);
  await userEvent.type(screen.getByPlaceholderText("Organization name"), "Acme Coffee");
  await userEvent.type(screen.getByPlaceholderText("Your name"), "Alice Smith");
  await userEvent.type(screen.getByPlaceholderText("Email"), "alice@example.com");
}

async function advanceToCodeStep() {
  await fillDetails();
  await userEvent.click(screen.getByRole("button", { name: /send code/i }));
  await screen.findByPlaceholderText("000000");
}

describe("SignupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInWithOtp.mockResolvedValue({ error: null });
    mockVerifyOtp.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("requires all fields before sending a code", async () => {
    render(<SignupPage />);
    await userEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/organization name/i);
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("sends an OTP that may create a new auth user", async () => {
    await advanceToCodeStep();
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: "alice@example.com",
      options: expect.objectContaining({
        shouldCreateUser: true,
        emailRedirectTo: expect.stringContaining("/auth/callback"),
      }),
    });
  });

  it("verifies the code and creates the organization", async () => {
    const fetchSpy = mockFetch({ ok: true, body: { ok: true, organizationId: "org-1" } });
    await advanceToCodeStep();

    await userEvent.type(screen.getByPlaceholderText("000000"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /verify & create/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "alice@example.com",
      token: "123456",
      type: "email",
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/organizations", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Acme Coffee", ownerName: "Alice Smith" }),
    }));
  });

  it("shows the API error and offers a retry when org creation fails after verification", async () => {
    mockFetch({ ok: false, body: { error: "Internal server error" } });
    await advanceToCodeStep();

    await userEvent.type(screen.getByPlaceholderText("000000"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /verify & create/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Internal server error");
    // The OTP is already consumed; retry should only re-attempt org creation.
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();

    mockFetch({ ok: true, body: { ok: true } });
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
  });

  it("skips the OTP exchange for already signed-in users and creates the org directly", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "alice@example.com", is_anonymous: false } },
      error: null,
    });
    const fetchSpy = mockFetch({ ok: true, body: { ok: true, organizationId: "org-1" } });

    render(<SignupPage />);
    const createButton = await screen.findByRole("button", { name: /create organization/i });
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Email")).not.toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Organization name"), "Acme Coffee");
    await userEvent.type(screen.getByPlaceholderText("Your name"), "Alice Smith");
    await userEvent.click(createButton);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith("/api/organizations", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Acme Coffee", ownerName: "Alice Smith" }),
    }));
  });

  it("lets a signed-in user switch accounts, returning to the OTP flow", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "alice@example.com", is_anonymous: false } },
      error: null,
    });

    render(<SignupPage />);
    await userEvent.click(await screen.findByRole("button", { name: /use a different account/i }));

    expect(mockSignOut).toHaveBeenCalled();
    expect(await screen.findByPlaceholderText("Email")).toBeInTheDocument();
  });

  it("treats anonymous (demo) sessions like signed-out visitors", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "anon-1", email: undefined, is_anonymous: true } },
      error: null,
    });

    render(<SignupPage />);
    expect(await screen.findByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create organization/i })).not.toBeInTheDocument();
  });

  it("shows the error message when the OTP is invalid", async () => {
    mockVerifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    await advanceToCodeStep();

    await userEvent.type(screen.getByPlaceholderText("000000"), "000000");
    await userEvent.click(screen.getByRole("button", { name: /verify & create/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/expired or is invalid/i);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
