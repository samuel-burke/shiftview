import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as listDevices, POST as createDevice } from "./devices/route";
import { DELETE as revokeDevice, PATCH as patchDevice } from "./devices/[id]/route";
import { GET as pinStatus, PUT as setPin, POST as generatePin, DELETE as clearPin } from "./pin/route";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { getOrgContext } from "@/lib/org-context";
import { writeAuditLog } from "@/lib/audit";
import { hashKioskToken, KIOSK_COOKIE } from "@/lib/kiosk-server";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/require-manager", () => ({ requireManager: vi.fn() }));
vi.mock("@/lib/org-context", async (orig) => ({ ...(await orig<typeof import("@/lib/org-context")>()), getOrgContext: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyManagers: vi.fn() }));

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const USER = { id: "user-1" };

function client({ rpc = { data: null, error: null } as { data: any; error: any }, setting = null as any } = {}) {
  const b: any = {};
  for (const m of ["select", "eq"]) b[m] = vi.fn(() => b);
  b.maybeSingle = vi.fn(async () => ({ data: setting, error: null }));
  const c = { rpc: vi.fn(async () => rpc), from: vi.fn(() => b) };
  vi.mocked(createClient).mockResolvedValue(c as any);
  return c;
}

function asManager() {
  vi.mocked(requireManager).mockResolvedValue({ user: USER, orgId: ORG, error: null } as any);
}
function asEmployee() {
  vi.mocked(requireManager).mockResolvedValue({ user: USER, orgId: null, error: "Manager access required" } as any);
}
function asSignedOut() {
  vi.mocked(requireManager).mockResolvedValue({ user: null, orgId: null, error: "Not authenticated" } as any);
  vi.mocked(getOrgContext).mockResolvedValue({ ctx: null, user: null, error: "Not authenticated" } as any);
}
function ctx(isManager: boolean, employeeId: number | null = 10) {
  vi.mocked(getOrgContext).mockResolvedValue({
    ctx: { user: USER, orgId: ORG, isManager, isOwner: false, employeeId, isDemo: false }, user: USER, error: null,
  } as any);
}

const json = (url: string, method: string, body?: unknown) =>
  new Request(`https://app.test${url}`, {
    method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => vi.clearAllMocks());

// ── Kiosk devices ────────────────────────────────────────────────────────────

describe("GET /api/kiosk/devices", () => {
  it("managers see whether kiosk mode is on and the kiosks, without tokens", async () => {
    asManager();
    const c = client({
      setting: { value: "true" },
      rpc: { data: [{ id: 1, name: "Front", created_at: "2026-10-01T00:00:00Z", last_used_at: null, revoked_at: null, locked: true, failed_today: 6 }], error: null },
    });
    const res = await listDevices(json("/api/kiosk/devices", "GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: true,
      devices: [{ id: 1, name: "Front", createdAt: "2026-10-01T00:00:00Z", lastUsedAt: null, revokedAt: null, locked: true, failedToday: 6 }],
    });
    expect(c.rpc).toHaveBeenCalledWith("kiosk_list", { p_org: ORG });
  });

  it("kiosk mode is off unless set to true", async () => {
    asManager();
    client({ setting: null, rpc: { data: [], error: null } });
    expect((await (await listDevices(json("/api/kiosk/devices", "GET"))).json()).enabled).toBe(false);
  });

  it("employees get 403, signed-out 401", async () => {
    asEmployee();
    const c = client();
    expect((await listDevices(json("/api/kiosk/devices", "GET"))).status).toBe(403);
    expect(c.rpc).not.toHaveBeenCalled();
    asSignedOut();
    expect((await listDevices(json("/api/kiosk/devices", "GET"))).status).toBe(401);
  });
});

describe("POST /api/kiosk/devices", () => {
  it("registers this device: stores the token's hash, puts the token in an HttpOnly cookie only", async () => {
    asManager();
    const c = client({ rpc: { data: 5, error: null } });
    const res = await createDevice(json("/api/kiosk/devices", "POST", { name: "  Front counter " }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: 5, name: "Front counter" });

    const cookie = res.headers.get("Set-Cookie")!;
    const token = cookie.match(new RegExp(`^${KIOSK_COOKIE}=([^;]+)`))![1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/kiosk");
    expect(cookie).toContain("Secure");
    expect(c.rpc).toHaveBeenCalledWith("kiosk_create", { p_org: ORG, p_name: "Front counter", p_token_hash: hashKioskToken(token) });
    expect(JSON.stringify(body)).not.toContain(token);
    expect(JSON.stringify(vi.mocked(writeAuditLog).mock.calls)).not.toContain(token);
  });

  it("uses the manager's own store, never one named in the request", async () => {
    asManager();
    const c = client({ rpc: { data: 5, error: null } });
    await createDevice(json("/api/kiosk/devices", "POST", { name: "Front", orgId: OTHER_ORG }));
    expect((c.rpc.mock.calls[0] as any)[1].p_org).toBe(ORG);
  });

  it.each([[{}], [{ name: "" }], [{ name: "   " }], [{ name: "x".repeat(61) }], [{ name: 5 }]])("refuses %j", async (body) => {
    asManager();
    const c = client();
    expect((await createDevice(json("/api/kiosk/devices", "POST", body))).status).toBe(400);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("an employee can't register a kiosk, and gets no cookie", async () => {
    asEmployee();
    const c = client();
    const res = await createDevice(json("/api/kiosk/devices", "POST", { name: "Front" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("the database refusing (42501) is a 403 with no cookie", async () => {
    asManager();
    client({ rpc: { data: null, error: { code: "42501", message: "Manager access required" } } });
    const res = await createDevice(json("/api/kiosk/devices", "POST", { name: "Front" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("too many kiosks is a 409", async () => {
    asManager();
    client({ rpc: { data: null, error: { code: "54000", message: "A store can have at most 25 kiosks — revoke one first" } } });
    expect((await createDevice(json("/api/kiosk/devices", "POST", { name: "Front" }))).status).toBe(409);
  });
});

describe("DELETE / PATCH /api/kiosk/devices/:id", () => {
  it("a manager revokes a kiosk of their store", async () => {
    asManager();
    const c = client({ rpc: { data: true, error: null } });
    const res = await revokeDevice(json("/api/kiosk/devices/5", "DELETE"), params("5"));
    expect(res.status).toBe(200);
    expect(c.rpc).toHaveBeenCalledWith("kiosk_revoke", { p_org: ORG, p_id: 5 });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "kiosk.revoke", resourceId: "5" }));
  });

  it("another store's kiosk reads as not found", async () => {
    asManager();
    client({ rpc: { data: false, error: null } });
    expect((await revokeDevice(json("/api/kiosk/devices/99", "DELETE"), params("99"))).status).toBe(404);
  });

  it("employees can't revoke", async () => {
    asEmployee();
    const c = client();
    expect((await revokeDevice(json("/api/kiosk/devices/5", "DELETE"), params("5"))).status).toBe(403);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1", "1.5", "99999999999999999999"])("refuses id %s", async (id) => {
    asManager();
    const c = client();
    expect((await revokeDevice(json(`/api/kiosk/devices/${id}`, "DELETE"), params(id))).status).toBe(400);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("a manager unlocks a locked kiosk", async () => {
    asManager();
    const c = client({ rpc: { data: true, error: null } });
    const res = await patchDevice(json("/api/kiosk/devices/5", "PATCH", { unlock: true }), params("5"));
    expect(res.status).toBe(200);
    expect(c.rpc).toHaveBeenCalledWith("kiosk_unlock", { p_org: ORG, p_id: 5 });
  });

  it("PATCH needs { unlock: true }", async () => {
    asManager();
    client();
    expect((await patchDevice(json("/api/kiosk/devices/5", "PATCH", { unlock: "yes" }), params("5"))).status).toBe(400);
  });

  it("employees can't unlock", async () => {
    asEmployee();
    client();
    expect((await patchDevice(json("/api/kiosk/devices/5", "PATCH", { unlock: true }), params("5"))).status).toBe(403);
  });
});

// ── PINs ─────────────────────────────────────────────────────────────────────

describe("/api/kiosk/pin", () => {
  it("an employee sets their own PIN (employeeId defaults to them)", async () => {
    ctx(false, 10);
    const c = client({ rpc: { data: "ok", error: null } });
    const res = await setPin(json("/api/kiosk/pin", "PUT", { pin: "4821" }));
    expect(res.status).toBe(200);
    expect(c.rpc).toHaveBeenCalledWith("set_employee_pin", { p_org: ORG, p_employee: 10, p_pin: "4821" });
    expect(JSON.stringify(vi.mocked(writeAuditLog).mock.calls)).not.toContain("4821");
  });

  it("an employee can't set a coworker's PIN (refused before the database)", async () => {
    ctx(false, 10);
    const c = client();
    expect((await setPin(json("/api/kiosk/pin", "PUT", { employeeId: 11, pin: "4821" }))).status).toBe(403);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("a manager sets anyone's PIN in their store", async () => {
    ctx(true, 1);
    const c = client({ rpc: { data: "ok", error: null } });
    expect((await setPin(json("/api/kiosk/pin", "PUT", { employeeId: 11, pin: "4821" }))).status).toBe(200);
    expect(c.rpc).toHaveBeenCalledWith("set_employee_pin", { p_org: ORG, p_employee: 11, p_pin: "4821" });
  });

  it("another store's employee is refused by the database (404/403)", async () => {
    ctx(true, 1);
    client({ rpc: { data: null, error: { code: "P0002", message: "Employee not found" } } });
    expect((await setPin(json("/api/kiosk/pin", "PUT", { employeeId: 999, pin: "4821" }))).status).toBe(404);
    client({ rpc: { data: null, error: { code: "42501", message: "no" } } });
    expect((await setPin(json("/api/kiosk/pin", "PUT", { employeeId: 999, pin: "4821" }))).status).toBe(403);
  });

  it("a taken PIN is 409 without saying whose", async () => {
    ctx(false, 10);
    client({ rpc: { data: "taken", error: null } });
    const res = await setPin(json("/api/kiosk/pin", "PUT", { pin: "4821" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "That PIN is taken — choose another" });
  });

  it("too many taken PINs is 429", async () => {
    ctx(false, 10);
    client({ rpc: { data: "too_many", error: null } });
    expect((await setPin(json("/api/kiosk/pin", "PUT", { pin: "4821" }))).status).toBe(429);
  });

  it("the database's format/strength refusal is a 400 with its message", async () => {
    ctx(false, 10);
    client({ rpc: { data: null, error: { code: "22023", message: "That PIN is too easy to guess — choose another" } } });
    const res = await setPin(json("/api/kiosk/pin", "PUT", { pin: "1234" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too easy/);
  });

  it("a non-string PIN is 400", async () => {
    ctx(false, 10);
    const c = client();
    expect((await setPin(json("/api/kiosk/pin", "PUT", { pin: 4821 }))).status).toBe(400);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it.each([["abc"], [0], [-3], [1.5]])("a bad employeeId (%j) is 400", async (employeeId) => {
    ctx(true, 1);
    const c = client();
    expect((await setPin(json("/api/kiosk/pin", "PUT", { employeeId, pin: "4821" }))).status).toBe(400);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("generate returns the new PIN once", async () => {
    ctx(false, 10);
    const c = client({ rpc: { data: "731690", error: null } });
    const res = await generatePin(json("/api/kiosk/pin", "POST", {}));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ pin: "731690" });
    expect(c.rpc).toHaveBeenCalledWith("generate_employee_pin", { p_org: ORG, p_employee: 10 });
  });

  it("status says whether there is a PIN, never the PIN", async () => {
    ctx(true, 1);
    const c = client({ rpc: { data: { hasPin: true, updatedAt: "2026-10-01T00:00:00Z" }, error: null } });
    const res = await pinStatus(json("/api/kiosk/pin?employeeId=11", "GET"));
    expect(await res.json()).toEqual({ hasPin: true, updatedAt: "2026-10-01T00:00:00Z" });
    expect(c.rpc).toHaveBeenCalledWith("employee_pin_status", { p_org: ORG, p_employee: 11 });
  });

  it("a manager removes an employee's PIN", async () => {
    ctx(true, 1);
    const c = client({ rpc: { data: null, error: null } });
    expect((await clearPin(json("/api/kiosk/pin?employeeId=11", "DELETE"))).status).toBe(200);
    expect(c.rpc).toHaveBeenCalledWith("clear_employee_pin", { p_org: ORG, p_employee: 11 });
  });

  it("an employee can't remove a coworker's PIN", async () => {
    ctx(false, 10);
    const c = client();
    expect((await clearPin(json("/api/kiosk/pin?employeeId=11", "DELETE"))).status).toBe(403);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("a manager with no employee record must name one", async () => {
    ctx(true, null);
    client();
    expect((await setPin(json("/api/kiosk/pin", "PUT", { pin: "4821" }))).status).toBe(403);
  });

  it("signed out: 401", async () => {
    asSignedOut();
    client();
    expect((await setPin(json("/api/kiosk/pin", "PUT", { pin: "4821" }))).status).toBe(401);
    expect((await pinStatus(json("/api/kiosk/pin", "GET"))).status).toBe(401);
  });
});
