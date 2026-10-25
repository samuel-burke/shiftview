import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSlackAlert } from "@/lib/slack";

vi.mock("@/lib/slack", () => ({ sendSlackAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => fn(),
  NextResponse: class extends Response {},
}));

let ipCounter = 0;
function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/visit", {
    method: "POST",
    headers: { "x-forwarded-for": `10.0.0.${++ipCounter}`, ...headers },
    body: JSON.stringify(body),
  });
}

async function load() {
  return (await import("./route")).POST;
}

beforeEach(() => {
  vi.mocked(sendSlackAlert).mockClear();
  vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T000/B000/xxxx");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/visit", () => {
  it("alerts on a tagged visit with path and location", async () => {
    const POST = await load();
    const res = await POST(req({ ref: "resume", path: "/welcome" }, { "x-vercel-ip-city": "Austin", "x-vercel-ip-country": "US" }));
    expect(res.status).toBe(204);
    const { message } = vi.mocked(sendSlackAlert).mock.calls[0][0];
    expect(message).toContain("/welcome");
    expect(message).toContain("ref=resume");
    expect(message).toContain("Austin, US");
  });

  it("alerts on a referral from a listed site", async () => {
    const POST = await load();
    await POST(req({ referrer: "www.linkedin.com", path: "/" }));
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].message).toContain("from linkedin.com");
  });

  it("ignores untagged visits from other sites", async () => {
    const POST = await load();
    const res = await POST(req({ referrer: "google.com", ref: "<script>" }));
    expect(res.status).toBe(204);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it("does nothing when Slack isn't configured", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    const POST = await load();
    await POST(req({ ref: "resume" }));
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it("rate-limits one IP", async () => {
    const POST = await load();
    const headers = { "x-forwarded-for": "10.9.9.9" };
    for (let i = 0; i < 5; i++) await POST(req({ ref: "resume" }, headers));
    expect(sendSlackAlert).toHaveBeenCalledTimes(3);
  });
});
