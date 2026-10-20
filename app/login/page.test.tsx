import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";
import type { TurnstileApi } from "@/lib/turnstile-client";

const captcha = vi.hoisted(() => ({ siteKey: undefined as string | undefined, render: vi.fn(), reset: vi.fn() }));
vi.mock("@/lib/turnstile-client", () => ({
  get TURNSTILE_SITE_KEY() { return captcha.siteKey; },
  loadTurnstile: async () => ({ render: captcha.render, reset: captcha.reset }),
  turnstileTheme: () => "dark",
}));
vi.mock("@/components/TryDemoButton", () => ({ default: () => null }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const mockSignInWithOtp = vi.fn().mockResolvedValue({ error: null });
const mockVerifyOtp = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: mockSignInWithOtp,
      verifyOtp: mockVerifyOtp,
    },
  }),
}));

describe("LoginPage — OTP input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captcha.siteKey = undefined;
    mockSignInWithOtp.mockResolvedValue({ error: null });
  });

  async function advanceToCodeStep() {
    render(<LoginPage />);
    const emailInput = screen.getByPlaceholderText("Email");
    await userEvent.type(emailInput, "user@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send code/i }));
    await screen.findByPlaceholderText("000000");
  }

  it("renders the OTP input with caret-transparent class to hide the cursor", async () => {
    await advanceToCodeStep();
    const otpInput = screen.getByPlaceholderText("000000");
    expect(otpInput.className).toContain("caret-transparent");
  });

  it("renders OTP input with inputMode numeric for native digit picker", async () => {
    await advanceToCodeStep();
    const otpInput = screen.getByPlaceholderText("000000");
    expect(otpInput).toHaveAttribute("inputMode", "numeric");
  });

  it("renders OTP input with pattern [0-9]* to reinforce numeric input on iOS", async () => {
    await advanceToCodeStep();
    const otpInput = screen.getByPlaceholderText("000000");
    expect(otpInput).toHaveAttribute("pattern", "[0-9]*");
  });

  it("renders OTP input with autoComplete one-time-code for SMS autofill", async () => {
    await advanceToCodeStep();
    const otpInput = screen.getByPlaceholderText("000000");
    expect(otpInput).toHaveAttribute("autoComplete", "one-time-code");
  });

  it("only accepts digit characters in the OTP field", async () => {
    await advanceToCodeStep();
    const otpInput = screen.getByPlaceholderText("000000");
    await userEvent.type(otpInput, "12ab34");
    expect((otpInput as HTMLInputElement).value).toBe("1234");
  });

  async function renderProtectedLogin() {
    captcha.siteKey = "test-site-key";
    let widget!: Parameters<TurnstileApi["render"]>[1];
    captcha.render.mockImplementation((_container, options) => { widget = options; return "widget-1"; });
    window.turnstile = { render: captcha.render, reset: captcha.reset };
    render(<LoginPage />);
    await waitFor(() => expect(captcha.render).toHaveBeenCalled());
    await userEvent.type(screen.getByPlaceholderText("Email"), "user@example.com");
    return widget;
  }

  it("requires a challenge even when submitting with Enter", async () => {
    await renderProtectedLogin();
    expect(screen.getByRole("button", { name: /send code/i })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Email"), "{Enter}");
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("complete the verification");
  });

  it("passes the token to Auth and verifies the emailed code without another challenge", async () => {
    const widget = await renderProtectedLogin();
    act(() => widget.callback("fresh-token"));
    await userEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: "user@example.com", options: { shouldCreateUser: false, captchaToken: "fresh-token" },
    });
    expect(captcha.reset).toHaveBeenCalledWith("widget-1");
    await userEvent.type(await screen.findByPlaceholderText("000000"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /^verify$/i }));
    expect(mockVerifyOtp).toHaveBeenCalledWith({ email: "user@example.com", token: "123456", type: "email" });
  });

  it("requires a fresh token after expiry and a failed OTP request", async () => {
    const widget = await renderProtectedLogin();
    act(() => widget.callback("expired-token"));
    act(() => widget["expired-callback"]?.());
    expect(screen.getByRole("button", { name: /send code/i })).toBeDisabled();
    act(() => widget.callback("fresh-token"));
    mockSignInWithOtp.mockResolvedValue({ error: { message: "Request rejected" } });
    await userEvent.click(screen.getByRole("button", { name: /send code/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Request rejected");
    expect(captcha.reset).toHaveBeenCalledWith("widget-1");
    expect(screen.getByRole("button", { name: /send code/i })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Email"), "{Enter}");
    expect(mockSignInWithOtp).toHaveBeenCalledTimes(1);
  });
});
