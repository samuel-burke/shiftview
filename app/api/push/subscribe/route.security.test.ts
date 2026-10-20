import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase-server";
import { POST } from "./route";
import { MOCK_USER } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));

const upsert = vi.fn().mockResolvedValue({ error: null });
const from = vi.fn().mockReturnValue({ upsert });
const getUser = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: MOCK_USER } });
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser }, from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
});

function subscribe(endpoint: unknown) {
  return POST(new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint, keys: { p256dh: "key", auth: "auth" } }),
  }));
}

describe("POST /api/push/subscribe destination policy", () => {
  it("stores an authorized endpoint with the authenticated owner", async () => {
    const response = await subscribe("https://fcm.googleapis.com:443/fcm/send/token");
    expect(response.status).toBe(201);
    expect(from).toHaveBeenCalledWith("push_subscriptions");
    expect(upsert).toHaveBeenCalledWith({
      user_id: MOCK_USER.id,
      endpoint: "https://fcm.googleapis.com/fcm/send/token",
      p256dh: "key", auth_key: "auth",
    }, { onConflict: "user_id,endpoint" });
  });

  it.each([
    "https://attacker.example/push",
    "https://127.0.0.1/push",
    "https://fcm.googleapis.com:8080/push",
    "http://fcm.googleapis.com/push",
    { host: "fcm.googleapis.com" },
  ])("rejects %s before writing a subscription", async (endpoint) => {
    expect((await subscribe(endpoint)).status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await subscribe("https://fcm.googleapis.com/push")).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("continues to reject anonymous demo users", async () => {
    getUser.mockResolvedValue({ data: { user: { ...MOCK_USER, is_anonymous: true } } });
    expect((await subscribe("https://fcm.googleapis.com/push")).status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });
});
