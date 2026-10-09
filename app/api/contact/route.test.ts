import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstileToken: vi.fn().mockResolvedValue(true) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const VALID = {
  name: "Dana Owner",
  email: "dana@example.com",
  topic: "question",
  message: "Do you support multiple store locations?",
};

function req(body: unknown, ip = "203.0.113.7") {
  return new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// The route keeps its rate limiter in module memory, so each test gets a
// fresh module instance.
async function load() {
  vi.resetModules();
  const route = await import("./route");
  const { sendEmail } = await import("@/lib/email");
  const { verifyTurnstileToken } = await import("@/lib/turnstile");
  return { POST: route.POST, sendEmail: vi.mocked(sendEmail), verify: vi.mocked(verifyTurnstileToken) };
}

describe("POST /api/contact", () => {
  beforeEach(() => {
    vi.stubEnv("CONTACT_TO_EMAIL", "owner@shiftview.test");
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("emails the message to CONTACT_TO_EMAIL with reply-to set to the sender", async () => {
    const { POST, sendEmail } = await load();
    const res = await POST(req(VALID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.to).toBe("owner@shiftview.test");
    expect(arg.replyTo).toBe("dana@example.com");
    expect(arg.subject).toBe("[ShiftView] Question from Dana Owner");
    expect(arg.html).toContain("Do you support multiple store locations?");
  });

  it("escapes HTML in the submitted fields", async () => {
    const { POST, sendEmail } = await load();
    await POST(req({ ...VALID, name: "<b>x</b>", message: "<script>alert(1)</script> hello" }));
    const { html } = sendEmail.mock.calls[0][0];
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("strips newlines from the name before it reaches the subject line", async () => {
    const { POST, sendEmail } = await load();
    await POST(req({ ...VALID, name: "Dana\r\nBcc: spam@example.com" }));
    expect(sendEmail.mock.calls[0][0].subject).not.toMatch(/[\r\n]/);
  });

  it("returns 503 and sends nothing when the destination isn't configured", async () => {
    vi.stubEnv("CONTACT_TO_EMAIL", "");
    const { POST, sendEmail } = await load();
    const res = await POST(req(VALID));
    expect(res.status).toBe(503);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns 503 when Resend isn't configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const { POST } = await load();
    expect((await POST(req(VALID))).status).toBe(503);
  });

  it("silently accepts but drops honeypot submissions", async () => {
    const { POST, sendEmail } = await load();
    const res = await POST(req({ ...VALID, website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["missing name", { name: "" }],
    ["overlong name", { name: "x".repeat(101) }],
    ["invalid email", { email: "not-an-email" }],
    ["unknown topic", { topic: "sales" }],
    ["short message", { message: "hi" }],
    ["overlong message", { message: "x".repeat(5001) }],
  ])("rejects %s with 400", async (_label, patch) => {
    const { POST, sendEmail } = await load();
    const res = await POST(req({ ...VALID, ...patch }));
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body with 400", async () => {
    const { POST } = await load();
    expect((await POST(req("not json"))).status).toBe(400);
  });

  it("rate limits after 5 messages per IP per hour", async () => {
    const { POST } = await load();
    for (let i = 0; i < 5; i++) expect((await POST(req(VALID))).status).toBe(200);
    expect((await POST(req(VALID))).status).toBe(429);
    expect((await POST(req(VALID, "198.51.100.1"))).status).toBe(200);
  });

  it("requires a valid Turnstile token when the secret key is set", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const { POST, verify, sendEmail } = await load();
    verify.mockResolvedValueOnce(false);
    const res = await POST(req({ ...VALID, turnstileToken: "bad" }));
    expect(res.status).toBe(403);
    expect(verify).toHaveBeenCalledWith("bad", "203.0.113.7");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns 502 when the email provider fails", async () => {
    const { POST, sendEmail } = await load();
    sendEmail.mockRejectedValueOnce(new Error("Resend error 500"));
    expect((await POST(req(VALID))).status).toBe(502);
  });
});
