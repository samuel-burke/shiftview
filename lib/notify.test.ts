import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./webpush", () => ({
  sendPush: vi.fn().mockResolvedValue("ok"),
}));
vi.mock("./demo-org", () => ({
  isDemoOrgId: (id: string) => id === "00000000-0000-0000-0000-00000000demo",
}));

import { notify, notifyManagers, notifyChessMove } from "./notify";
import { sendPush } from "./webpush";

const mockSendPush = vi.mocked(sendPush);

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const DEMO_ORG_ID = "00000000-0000-0000-0000-00000000demo";
const USER_ID = "user-1";

const SUB = { endpoint: "https://push.example/abc", p256dh: "key", auth_key: "auth" };

type MockOptions = {
  prefs?: Record<string, boolean>;
  subs?: (typeof SUB)[];
  managers?: { user_id: string }[];
};

function makeSupabase({ prefs = {}, subs = [SUB], managers = [] }: MockOptions = {}) {
  const rpc = vi.fn().mockImplementation((fn: string) => {
    if (fn === "notify_get_push_prefs") return Promise.resolve({ data: [prefs], error: null });
    if (fn === "notify_get_push_subs") return Promise.resolve({ data: subs, error: null });
    if (fn === "notify_get_manager_ids") return Promise.resolve({ data: managers, error: null });
    return Promise.resolve({ data: null, error: null });
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

beforeEach(() => {
  mockSendPush.mockClear();
});

describe("notify", () => {
  it("inserts the notification row and pushes when the pref is enabled", async () => {
    const { client, rpc } = makeSupabase({ prefs: { message_alerts: true } });
    await notify(client, {
      orgId: ORG_ID,
      userId: USER_ID,
      type: "message",
      title: "Alice",
      body: "hi",
    });

    expect(rpc).toHaveBeenCalledWith("notify_insert", expect.objectContaining({
      p_org_id: ORG_ID,
      p_user_id: USER_ID,
      p_type: "message",
    }));
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(mockSendPush.mock.calls[0][1]).toMatchObject({ title: "Alice", body: "hi" });
  });

  it("still inserts the row but skips the push entirely when the pref is disabled", async () => {
    const { client, rpc } = makeSupabase({ prefs: { message_alerts: false } });
    await notify(client, {
      orgId: ORG_ID,
      userId: USER_ID,
      type: "message",
      title: "Alice",
      body: "hi",
    });

    expect(rpc).toHaveBeenCalledWith("notify_insert", expect.anything());
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("treats a missing pref row as enabled", async () => {
    const { client } = makeSupabase({ prefs: {} });
    await notify(client, {
      orgId: ORG_ID,
      userId: USER_ID,
      type: "pto_approved",
      title: "Time off approved",
      body: "Jun 20",
    });
    expect(mockSendPush).toHaveBeenCalledTimes(1);
  });

  it("inserts the row but never pushes for the demo org", async () => {
    const { client, rpc } = makeSupabase();
    await notify(client, {
      orgId: DEMO_ORG_ID,
      userId: USER_ID,
      type: "message",
      title: "Alice",
      body: "hi",
    });
    expect(rpc).toHaveBeenCalledWith("notify_insert", expect.anything());
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

describe("notifyManagers", () => {
  it("inserts one broadcast row and pushes to each manager with the pref enabled", async () => {
    const { client, rpc } = makeSupabase({
      prefs: { late_punch_alerts: true },
      managers: [{ user_id: "mgr-1" }, { user_id: "mgr-2" }],
    });
    await notifyManagers(client, ORG_ID, "late_clock_in", "Late clock-in", "Bob is late");

    expect(rpc).toHaveBeenCalledWith("notify_insert", expect.objectContaining({
      p_org_id: ORG_ID,
      p_user_id: null,
    }));
    expect(mockSendPush).toHaveBeenCalledTimes(2);
  });

  it("skips pushes when the managers have the pref disabled", async () => {
    const { client } = makeSupabase({
      prefs: { late_punch_alerts: false },
      managers: [{ user_id: "mgr-1" }],
    });
    await notifyManagers(client, ORG_ID, "late_clock_in", "Late clock-in", "Bob is late");
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

describe("notifyChessMove", () => {
  const MOVE = {
    orgId: ORG_ID,
    toUserId: USER_ID,
    fromUserId: "user-2",
    fromName: "Alice",
    convId: "user-1_user-2",
    chessStatus: "active",
  };

  it("upserts the self-replacing notification row and pushes when the pref is enabled", async () => {
    const { client, rpc } = makeSupabase({ prefs: { chess_alerts: true } });
    await notifyChessMove(client, MOVE);

    expect(rpc).toHaveBeenCalledWith("notify_upsert_chess", expect.objectContaining({
      p_org_id: ORG_ID,
      p_user_id: USER_ID,
      p_title: "Your move!",
      p_data: expect.objectContaining({ type: "chess_move", convId: MOVE.convId }),
    }));
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(mockSendPush.mock.calls[0][1].data).toMatchObject({
      type: "chess_move",
      fromUserId: "user-2",
      convId: MOVE.convId,
    });
  });

  it("still upserts the row but skips the push when the chess pref is disabled", async () => {
    const { client, rpc } = makeSupabase({ prefs: { chess_alerts: false } });
    await notifyChessMove(client, MOVE);

    expect(rpc).toHaveBeenCalledWith("notify_upsert_chess", expect.anything());
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("upserts the row but never pushes for the demo org", async () => {
    const { client, rpc } = makeSupabase({ prefs: { chess_alerts: true } });
    await notifyChessMove(client, { ...MOVE, orgId: DEMO_ORG_ID });

    expect(rpc).toHaveBeenCalledWith("notify_upsert_chess", expect.anything());
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("uses end-of-game copy for a finished game", async () => {
    const { client, rpc } = makeSupabase({ prefs: { chess_alerts: true } });
    await notifyChessMove(client, { ...MOVE, chessStatus: "white_wins" });

    expect(rpc).toHaveBeenCalledWith("notify_upsert_chess", expect.objectContaining({
      p_title: "Checkmate!",
    }));
  });
});
