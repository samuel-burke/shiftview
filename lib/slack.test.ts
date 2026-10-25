import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSlackAlert } from "./slack";

const fetchMock = vi.fn();
const WEBHOOK = "https://hooks.slack.com/services/T000/B000/xxxx";

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue(new Response("ok"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendSlackAlert", () => {
  it("does nothing when SLACK_WEBHOOK_URL is unset", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    await sendSlackAlert({ title: "t", message: "m" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a JSON message with the emoji, bold title and body", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", WEBHOOK);
    await sendSlackAlert({ title: "Café", message: "hello", emoji: "tada" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ text: ":tada: *Café*\nhello" });
  });

  it("escapes Slack control characters so text can't inject mentions or links", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", WEBHOOK);
    await sendSlackAlert({ title: "A & B", message: "<!channel> <https://evil.test|click>" });
    const { text } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(text).toBe("*A &amp; B*\n&lt;!channel&gt; &lt;https://evil.test|click&gt;");
  });

  it("refuses a URL that isn't a Slack webhook", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://attacker.test/hook");
    await sendSlackAlert({ title: "t", message: "m" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("logs instead of throwing when the request fails", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", WEBHOOK);
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(sendSlackAlert({ title: "t", message: "m" })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("logs a non-2xx response without the webhook URL", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", WEBHOOK);
    fetchMock.mockResolvedValue(new Response("invalid_payload", { status: 400 }));
    await sendSlackAlert({ title: "t", message: "m" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("400"));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(WEBHOOK);
  });
});
