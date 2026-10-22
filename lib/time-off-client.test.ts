import { describe, it, expect, vi } from "vitest";
import { decideTimeOffRequest, TimeOffClashError } from "./time-off-client";

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("decideTimeOffRequest", () => {
  it("sends the decision, and the resolve choice when given", async () => {
    const fetcher = reply(200, { ok: true, removedShifts: [4] });
    expect(await decideTimeOffRequest(7, "approved", "remove", fetcher)).toEqual({ removedShifts: [4] });
    expect(fetcher).toHaveBeenCalledWith("/api/time-off/7", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ status: "approved", resolve: "remove" }),
    }));
    const plain = reply(200, { ok: true });
    await decideTimeOffRequest(7, "denied", undefined, plain);
    expect(vi.mocked(plain).mock.calls[0][1]?.body).toBe(JSON.stringify({ status: "denied" }));
  });

  it("turns a scheduled clash into a TimeOffClashError with the shifts", async () => {
    const shifts = [{ id: 1, date: "2026-10-20", startMinutes: 540, endMinutes: 1020 }];
    const err = await decideTimeOffRequest(7, "approved", undefined, reply(409, { conflict: "scheduled", message: "They're scheduled", shifts })).catch((e) => e);
    expect(err).toBeInstanceOf(TimeOffClashError);
    expect(err.shifts).toEqual(shifts);
    expect(err.message).toBe("They're scheduled");
  });

  it("throws the server's error otherwise", async () => {
    await expect(decideTimeOffRequest(7, "approved", undefined, reply(404, { error: "Request not found" }))).rejects.toThrow("Request not found");
    const offline = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    await expect(decideTimeOffRequest(7, "denied", undefined, offline)).rejects.toThrow(/Couldn't deny/);
  });
});
