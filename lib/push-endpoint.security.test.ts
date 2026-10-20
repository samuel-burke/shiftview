import { describe, expect, it } from "vitest";
import { parsePushEndpoint } from "./push-endpoint";

describe("push endpoint destinations", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
    "https://web.push.apple.com/token",
    "https://wns2-bl2p.notify.windows.com/w/?token=value",
    "https://fcm.googleapis.com:443/fcm/send/token",
  ])("accepts browser push service %s", (endpoint) => {
    expect(parsePushEndpoint(endpoint)?.origin).toMatch(/^https:/);
  });

  it.each([
    "https://attacker.example/push",
    "https://127.0.0.1/push",
    "https://2130706433/push",
    "https://[::1]/push",
    "https://169.254.169.254/latest/meta-data/",
    "http://fcm.googleapis.com/fcm/send/token",
    "https://fcm.googleapis.com:8443/fcm/send/token",
    "https://fcm.googleapis.com.evil.example/push",
    "https://evilpush.apple.com/push",
    "https://push.apple.com.evil.example/push",
    "https://evilnotify.windows.com/push",
    "https://push.services.mozilla.com.evil.example/push",
    "https://fcm.googleapis.com@attacker.example/push",
    "https://user:pass@fcm.googleapis.com/push",
    "https://fcm.googleapis.com/push#fragment",
    "https://fcm.googleapis.com./push",
    "//fcm.googleapis.com/push",
    "not a URL", "", null, 123, {},
  ])("rejects unsupported or ambiguous destination %s", (endpoint) => {
    expect(parsePushEndpoint(endpoint)).toBeNull();
  });
});
