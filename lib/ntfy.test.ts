import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendNtfy } from "./ntfy";

const fetchMock = vi.fn();

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

describe("sendNtfy", () => {
  it("does nothing when NTFY_TOPIC_URL is unset", async () => {
    vi.stubEnv("NTFY_TOPIC_URL", "");
    await sendNtfy({ title: "t", message: "m" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the message to the topic with title, tags and token", async () => {
    vi.stubEnv("NTFY_TOPIC_URL", "https://ntfy.sh/topic");
    vi.stubEnv("NTFY_TOKEN", "tk_abc");
    await sendNtfy({ title: "Café", message: "hello", tags: ["tada"] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ntfy.sh/topic");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("hello");
    expect(init.headers.Authorization).toBe("Bearer tk_abc");
    expect(init.headers.Tags).toBe("tada");
    expect(init.headers.Title).toBe(`=?UTF-8?B?${Buffer.from("Café").toString("base64")}?=`);
  });

  it("omits the Authorization header without NTFY_TOKEN", async () => {
    vi.stubEnv("NTFY_TOPIC_URL", "https://ntfy.sh/topic");
    vi.stubEnv("NTFY_TOKEN", "");
    await sendNtfy({ title: "t", message: "m" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("logs instead of throwing when the request fails", async () => {
    vi.stubEnv("NTFY_TOPIC_URL", "https://ntfy.sh/topic");
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(sendNtfy({ title: "t", message: "m" })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("logs a non-2xx response", async () => {
    vi.stubEnv("NTFY_TOPIC_URL", "https://ntfy.sh/topic");
    fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }));
    await sendNtfy({ title: "t", message: "m" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("403"));
  });
});
