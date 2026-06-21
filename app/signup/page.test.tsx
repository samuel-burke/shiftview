import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignupPage from "./page";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush, refresh: vi.fn() }) }));

const mockVerifyOtp = vi.fn().mockResolvedValue({ error: null });
const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
const mockSignOut = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => ({
    auth: {
      verifyOtp: mockVerifyOtp,
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  }),
}));

// Signup sends the OTP through the gated server route (/api/auth/signup-otp)
// so the Turnstile check runs before any email goes out; org creation hits
// /api/organizations. Route by URL so each test controls the org-create
// response independently of the always-ok send-code call.
function mockFetch(org: { ok: boolean; body?: object }) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/auth/signup-otp")) {
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    }
    return { ok: org.ok, json: async () => org.body ?? {} } as Response;
  });
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
    mockVerifyOtp.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockSignOut.mockResolvedValue({ error: null });
    // Default: every route succeeds; tests that need a failure re-mock.
    mockFetch({ ok: true, body: { ok: true } });
  });

  it("requires all fields before sending a code", async () => {
    render(<SignupPage />);
    await userEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/organization name/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends the OTP through the gated server route", async () => {
    await advanceToCodeStep();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/signup-otp",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "alice@example.com", turnstileToken: null }),
      })
    );
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
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/auth/signup-otp", expect.anything());
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
