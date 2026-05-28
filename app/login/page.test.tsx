import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";

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
  });

  async function advanceToCodeStep() {
    render(<LoginPage />);
    const emailInput = screen.getByPlaceholderText("Email");
    await userEvent.type(emailInput, "user@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send code/i }));
    await screen.findByPlaceholderText("000000");
  }

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
});
