import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApiFetch } from "./api-fetch";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(status: number) {
  return new Response(JSON.stringify({ ok: true }), { status });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("createApiFetch", () => {
  it("returns the response normally for 200", async () => {
    mockFetch.mockResolvedValue(makeResponse(200));
    const onUnauthorized = vi.fn();
    const apiFetch = createApiFetch(false, onUnauthorized);
    const res = await apiFetch("/api/test");
    expect(res.status).toBe(200);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("calls onUnauthorized and returns response on 401 in non-demo mode", async () => {
    mockFetch.mockResolvedValue(makeResponse(401));
    const onUnauthorized = vi.fn();
    const apiFetch = createApiFetch(false, onUnauthorized);
    const res = await apiFetch("/api/test");
    expect(res.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("does NOT call onUnauthorized on 401 in demo mode", async () => {
    mockFetch.mockResolvedValue(makeResponse(401));
    const onUnauthorized = vi.fn();
    const apiFetch = createApiFetch(true, onUnauthorized);
    const res = await apiFetch("/api/test");
    expect(res.status).toBe(401);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("passes url and init to fetch", async () => {
    mockFetch.mockResolvedValue(makeResponse(200));
    const apiFetch = createApiFetch(false, vi.fn());
    const init: RequestInit = { method: "POST", body: JSON.stringify({ x: 1 }) };
    await apiFetch("/api/schedules", init);
    expect(mockFetch).toHaveBeenCalledWith("/api/schedules", init);
  });

  it("does not call onUnauthorized for 403 responses", async () => {
    mockFetch.mockResolvedValue(makeResponse(403));
    const onUnauthorized = vi.fn();
    const apiFetch = createApiFetch(false, onUnauthorized);
    await apiFetch("/api/test");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
