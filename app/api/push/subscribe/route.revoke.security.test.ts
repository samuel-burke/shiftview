import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeQueryBuilder } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));

const endpoint = "https://push.example/current-browser";
let query: ReturnType<typeof makeQueryBuilder>;
let client: ReturnType<typeof makeClient>;

function makeClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "current-user" } } }) },
    from: vi.fn().mockImplementation(() => query),
  };
}

function request(method: string, body: object = { endpoint }) {
  return new Request("http://localhost/api/push/subscribe", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  query = makeQueryBuilder({ data: null, error: null });
  client = makeClient();
  vi.mocked(createClient).mockResolvedValue(client as any);
});

describe("push endpoint authorization", () => {
  it("revokes only the signed-in user's current browser, preserving other users and devices", async () => {
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith("push_subscriptions");
    expect(query.delete).toHaveBeenCalledOnce();
    expect(query.eq.mock.calls).toEqual([["user_id", "current-user"], ["endpoint", endpoint]]);
  });

  it("reports database revocation failure instead of acknowledging success", async () => {
    query = makeQueryBuilder({ data: null, error: { message: "database unavailable" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await DELETE(request("DELETE"))).status).toBe(500);
    } finally {
      log.mockRestore();
    }
  });

  it.each([DELETE, POST])("requires authentication for subscription mutations", async (handler) => {
    client.auth.getUser.mockResolvedValueOnce({ data: { user: null } } as any);
    expect((await handler(request("POST"))).status).toBe(401);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("requires an endpoint so logout cannot revoke all of a user's devices", async () => {
    expect((await DELETE(request("DELETE", {}))).status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
  });
});
