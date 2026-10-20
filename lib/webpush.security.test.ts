import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import { lookup, type LookupAddress } from "node:dns";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { EventEmitter } from "node:events";
import webpush from "web-push";

vi.mock("node:dns", () => ({ lookup: vi.fn() }));

const keys = webpush.generateVAPIDKeys();
const device = createECDH("prime256v1");
device.generateKeys();
const sub = {
  endpoint: "https://fcm.googleapis.com/fcm/send/token",
  p256dh: device.getPublicKey().toString("base64url"),
  auth_key: randomBytes(16).toString("base64url"),
};
const payload = { title: "Test", body: "Push body" };
let sendPush: typeof import("./webpush").sendPush;

beforeAll(async () => {
  vi.stubEnv("VAPID_PUBLIC_KEY", keys.publicKey);
  vi.stubEnv("VAPID_PRIVATE_KEY", keys.privateKey);
  ({ sendPush } = await import("./webpush"));
});

beforeEach(() => {
  vi.mocked(lookup).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllEnvs());

async function deliveryLookup() {
  const send = vi.spyOn(webpush, "sendNotification").mockResolvedValue({
    statusCode: 201, body: "", headers: {},
  });
  expect(await sendPush(sub, payload)).toBe("ok");
  const agent = send.mock.calls[0][2]?.agent;
  expect(agent).toBeInstanceOf(https.Agent);
  return (agent as https.Agent).options.lookup as LookupFunction;
}

// dns.lookup is overloaded; these tests exercise its { all: true } signature.
function resolveTo(addresses: LookupAddress[], error: NodeJS.ErrnoException | null = null) {
  vi.mocked(lookup).mockImplementation((...args: unknown[]) => {
    const callback = args[2] as (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void;
    callback(error, addresses);
  });
}

describe("push delivery destination controls", () => {
  it.each(["https://attacker.example/push", "https://127.0.0.1/push", "https://fcm.googleapis.com:8443/push"])(
    "discards a prohibited stored subscription %s before calling the HTTP client", async (endpoint) => {
      const send = vi.spyOn(webpush, "sendNotification");
      expect(await sendPush({ ...sub, endpoint }, payload)).toBe("gone");
      expect(send).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    }
  );

  it.each([
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "192.168.0.1", "192.0.0.1", "192.0.2.1", "192.88.99.1",
    "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "fc00::1", "fe80::1",
    "ff02::1", "64:ff9b::7f00:1", "2001::1", "2001:db8::1", "2002:7f00:1::", "3fff::1",
  ])("blocks a provider hostname resolving to %s", async (address) => {
    const secureLookup = await deliveryLookup();
    resolveTo([{ address, family: address.includes(":") ? 6 : 4 }]);
    const callback = vi.fn();
    secureLookup("fcm.googleapis.com", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      message: "Push service resolved to a prohibited address",
    }), []);
  });

  it("returns only the validated public addresses to the socket without resolving again", async () => {
    const secureLookup = await deliveryLookup();
    const addresses = [{ address: "142.250.1.1", family: 4 }, { address: "2607:f8b0::1", family: 6 }];
    resolveTo(addresses);
    const callback = vi.fn();
    secureLookup("fcm.googleapis.com", { all: true }, callback);
    expect(lookup).toHaveBeenCalledExactlyOnceWith("fcm.googleapis.com", { all: true }, expect.any(Function));
    expect(callback).toHaveBeenCalledWith(null, addresses);

    secureLookup("fcm.googleapis.com", { family: 4 }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, "142.250.1.1", 4);
  });

  it("rejects mixed public/private DNS answers and checks each new lookup", async () => {
    const secureLookup = await deliveryLookup();
    const callback = vi.fn();
    resolveTo([{ address: "142.250.1.1", family: 4 }]);
    secureLookup("fcm.googleapis.com", { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: "142.250.1.1", family: 4 }]);
    resolveTo([{ address: "142.250.1.1", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    secureLookup("fcm.googleapis.com", { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(expect.any(Error), []);
  });

  it("fails closed on DNS failures or empty results", async () => {
    const secureLookup = await deliveryLookup();
    const callback = vi.fn();
    const error = new Error("DNS unavailable");
    resolveTo([], error);
    secureLookup("fcm.googleapis.com", {}, callback);
    expect(callback).toHaveBeenLastCalledWith(error, []);
    resolveTo([]);
    secureLookup("fcm.googleapis.com", {}, callback);
    expect(callback).toHaveBeenLastCalledWith(expect.any(Error), []);
  });

  it("enforces DNS restrictions through the installed web-push client and real HTTPS agent", async () => {
    resolveTo([{ address: "127.0.0.1", family: 4 }]);
    const request = vi.spyOn(https, "request");
    expect(await sendPush(sub, payload)).toBe("ok");
    expect(request).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith("[webpush] send error:", expect.objectContaining({
      message: "Push service resolved to a prohibited address",
    }));
  });

  it("does not follow redirects returned by a push provider", async () => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 302, headers: { location: "https://127.0.0.1/private" },
    });
    const request = vi.spyOn(https, "request").mockImplementation((_options: any, callback: any) => {
      const outgoing = Object.assign(new EventEmitter(), {
        write: vi.fn(),
        end: () => { callback(response); response.emit("end"); },
      });
      return outgoing as unknown as ReturnType<typeof https.request>;
    });
    expect(await sendPush(sub, payload)).toBe("ok");
    expect(request).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith("[webpush] send error:", expect.objectContaining({ statusCode: 302 }));
  });
});
