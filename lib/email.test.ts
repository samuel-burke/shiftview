import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("sendEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing when RESEND_API_KEY not set", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const { sendEmail } = await import("./email");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendEmail({ to: "test@example.com", subject: "Hello", html: "<p>Hi</p>" });
    expect(global.fetch).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("calls fetch with correct URL, headers, body when key is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key-123");
    const { sendEmail } = await import("./email");
    (global.fetch as any).mockResolvedValue({ ok: true });
    await sendEmail({ to: "emp@example.com", subject: "Your shift", html: "<p>Hi</p>" });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key-123",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          from: "ShiftView <noreply@shiftview.app>",
          to: "emp@example.com",
          subject: "Your shift",
          html: "<p>Hi</p>",
        }),
      })
    );
  });

  it("throws when response is not ok", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key-123");
    const { sendEmail } = await import("./email");
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Unprocessable Entity",
    });
    await expect(
      sendEmail({ to: "emp@example.com", subject: "Shift", html: "<p>Hi</p>" })
    ).rejects.toThrow("Resend error 422: Unprocessable Entity");
  });
});
