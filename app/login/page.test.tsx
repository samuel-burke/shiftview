import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";

// Mock next/navigation
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// Mock supabase-browser
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
    // Wait for OTP step
    await screen.findByPlaceholderText("000000");
  }

  it("renders the OTP input with caret-transparent class to hide the cursor", async () => {
    await advanceToCodeStep();
    const otpInput = screen.getByPlaceholderText("000000");
    expect(otpInput.className).toContain("caret-transparent");
  });

  it("renders the OTP input with inputMode numeric", async () => {
    await advanceToCodeStep();
    const otpInput = screen.getByPlaceholderText("000000");
    expect(otpInput).toHaveAttribute("inputMode", "numeric");
  });

  it("only accepts digit characters in the OTP field", async () => {
    await advanceToCodeStep();
    const otpInput = screen.getByPlaceholderText("000000");
    await userEvent.type(otpInput, "12ab34");
    expect((otpInput as HTMLInputElement).value).toBe("1234");
  });
});
