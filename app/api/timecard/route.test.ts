import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeQueryBuilder, makeSupabaseClient, MOCK_ORG_ID, MOCK_USER } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));

const request = () => new Request("http://localhost/api/timecard?employeeId=5&from=2026-11-02&to=2026-11-02");

function managerClient() {
  const client = makeSupabaseClient({
    user: MOCK_USER,
    isManager: true,
    linkedEmployee: { id: 5, name: "Alice" },
    queryData: [],
  });
  client.rpc.mockImplementation(() => makeQueryBuilder({
    data: [{ date: "2026-11-02", reason: "Flu" }], error: null,
  }));
  return client;
}

describe("GET /api/timecard — private callout reasons", () => {
  it("keeps reasons in the manager's timecard using the scoped RPC", async () => {
    const client = managerClient();
    vi.mocked(createClient).mockResolvedValue(client as any);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).days[0].callout).toEqual({ reason: "Flu" });
    expect(client.rpc).toHaveBeenCalledWith("callouts_for_org", { p_org: MOCK_ORG_ID });
    expect(client.from).not.toHaveBeenCalledWith("callouts");
  });

  it("preserves reasons in CSV exports", async () => {
    const client = managerClient();
    vi.mocked(createClient).mockResolvedValue(client as any);
    const res = await GET(new Request(`${request().url}&format=csv`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv");
    expect(await res.text()).toContain("Flu");
  });

  it("fails the request when the private read fails", async () => {
    const client = managerClient();
    client.rpc.mockImplementation(() => makeQueryBuilder({ data: null, error: { message: "read failed" } }));
    vi.mocked(createClient).mockResolvedValue(client as any);
    expect((await GET(request())).status).toBe(500);
  });

  it("keeps timecards restricted to managers", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, linkedEmployee: { id: 5 } });
    vi.mocked(createClient).mockResolvedValue(client as any);
    expect((await GET(request())).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
