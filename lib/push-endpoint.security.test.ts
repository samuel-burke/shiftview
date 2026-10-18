import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isAllowedPushEndpoint } from "./push-endpoint";

// Regression: POST /api/push/subscribe stored any endpoint, and every
// notification to that user made the server POST to it: a server-side request
// forgery any signed-up account could aim at internal or third-party hosts.

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:APA91b",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB",
    "https://web.push.apple.com/QGuQyavXutnMH",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
  ])("accepts the browser push service %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost/api/cron/reminders",
    "https://fcm.googleapis.com.attacker.test/x",
    "https://attacker.test/?fcm.googleapis.com",
    "https://evilpush.apple.com.example/x",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://user:pass@fcm.googleapis.com/fcm/send/abc",
    "https://ntfy.sh/some-topic",
    "not a url",
    "",
    `https://fcm.googleapis.com/${"a".repeat(3000)}`,
  ])("refuses %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it("refuses non-strings", () => {
    expect(isAllowedPushEndpoint(undefined)).toBe(false);
    expect(isAllowedPushEndpoint({ toString: () => "https://fcm.googleapis.com/x" })).toBe(false);
  });
});

const sendNotification = vi.fn().mockResolvedValue({});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));

describe("sendPush", () => {
  beforeEach(() => {
    vi.resetModules();
    sendNotification.mockClear();
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
  });
  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it("never contacts a stored endpoint outside the push services, and reports it gone", async () => {
    const { sendPush } = await import("./webpush");
    const result = await sendPush(
      { endpoint: "http://10.0.0.5:8080/internal", p256dh: "k", auth_key: "a" },
      { title: "t", body: "b" }
    );
    expect(result).toBe("gone");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("still delivers to a real push service", async () => {
    const { sendPush } = await import("./webpush");
    const result = await sendPush(
      { endpoint: "https://web.push.apple.com/QGuQ", p256dh: "k", auth_key: "a" },
      { title: "t", body: "b" }
    );
    expect(result).toBe("ok");
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});
