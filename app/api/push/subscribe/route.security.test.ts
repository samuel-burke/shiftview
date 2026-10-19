import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";

// Regression: the subscribe route stored any endpoint URL, which the server
// then POSTs to on every notification (SSRF). Only browser push services are
// accepted now.

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200 }),
  },
}));

function client() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  return {
    upsert,
    supabase: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1", is_anonymous: false } } }) },
      from: vi.fn(() => ({ upsert })),
    },
  };
}

function req(endpoint: string) {
  return new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint, keys: { p256dh: "k", auth: "a" } }),
  });
}

describe("POST /api/push/subscribe", () => {
  it("refuses an endpoint that isn't a browser push service", async () => {
    const c = client();
    vi.mocked(createClient).mockResolvedValue(c.supabase as never);
    const res = await POST(req("https://169.254.169.254/latest/meta-data/"));
    expect(res.status).toBe(400);
    expect(c.upsert).not.toHaveBeenCalled();
  });

  it("saves a real push subscription", async () => {
    const c = client();
    vi.mocked(createClient).mockResolvedValue(c.supabase as never);
    const res = await POST(req("https://fcm.googleapis.com/fcm/send/abc"));
    expect(res.status).toBe(201);
    expect(c.upsert).toHaveBeenCalledTimes(1);
  });
});
