import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { createAdminClient } from "@/lib/supabase-admin";
import { hashFeedToken, newFeedToken } from "@/lib/calendar-feed";
import { createFakeDb } from "../../__tests__/fake-db";

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));

const ORG = "org-1";
const token = newFeedToken();

function seed(archivedAt: string | null) {
  const db = createFakeDb({
    calendar_feeds: [{ org_id: ORG, employee_id: 5, token_hash: hashFeedToken(token) }],
    employees: [{ id: 5, org_id: ORG, name: "Avery", archived_at: archivedAt }],
    app_settings: [],
    schedules: [],
  });
  vi.mocked(createAdminClient).mockReturnValue(db.client as never);
}

const get = () => GET(new Request(`http://localhost/api/calendar/${token}.ics`), { params: Promise.resolve({ token: `${token}.ics` }) });

describe("GET /api/calendar/[token]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serves the feed for an active employee", async () => {
    seed(null);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
  });

  it("returns 404 once the employee is archived", async () => {
    seed("2026-10-01T00:00:00Z");
    expect((await get()).status).toBe(404);
  });
});
