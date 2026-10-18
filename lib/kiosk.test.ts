import { describe, it, expect } from "vitest";
import {
  identifyFailure,
  isPinShape,
  kioskActions,
  kioskState,
  pinProblem,
  KIOSK_IDLE_MS,
  PUNCH_TYPES,
} from "./kiosk";

describe("isPinShape", () => {
  it.each(["4821", "48213", "482139", "0000"])("accepts %s", (pin) => {
    expect(isPinShape(pin)).toBe(true);
  });
  it.each(["", "123", "1234567", "12a4", " 4821", "4821 ", "48.1", "-482", "４８２１"])("refuses %j", (pin) => {
    expect(isPinShape(pin)).toBe(false);
  });
  it.each([4821, null, undefined, {}, ["4821"]])("refuses non-strings (%j)", (pin) => {
    expect(isPinShape(pin)).toBe(false);
  });
});

describe("pinProblem (mirrors kiosk_check_pin_format in 0063)", () => {
  it.each(["4821", "5937", "731690", "1357", "2468"])("accepts %s", (pin) => {
    expect(pinProblem(pin)).toBeNull();
  });
  it.each(["123", "1234567", "12a4", ""])("says %j has the wrong format", (pin) => {
    expect(pinProblem(pin)).toMatch(/4 to 6 digits/);
  });
  it.each(["1111", "000000", "99999", "1234", "3456", "123456", "7890", "4321", "987654", "0987"])(
    "says %s is too easy",
    (pin) => {
      expect(pinProblem(pin)).toMatch(/too easy/);
    },
  );
  it("allows a PIN that only starts like a run", () => {
    expect(pinProblem("1235")).toBeNull();
    expect(pinProblem("8901")).toBeNull();
  });
});

describe("kioskState / kioskActions — the /api/punches transitions", () => {
  it.each([
    [null, "clocked_out", ["clock_in"]],
    [undefined, "clocked_out", ["clock_in"]],
    ["clock_out", "clocked_out", ["clock_in"]],
    ["clock_in", "on_shift", ["break_start", "clock_out"]],
    ["break_end", "on_shift", ["break_start", "clock_out"]],
    ["break_start", "on_break", ["break_end"]],
  ])("after %s: %s, can %j", (last, state, actions) => {
    expect(kioskState(last)).toBe(state);
    expect(kioskActions(last)).toEqual(actions);
  });

  it("never offers a punch the API would refuse", () => {
    const allowed: Record<string, (string | null)[]> = {
      clock_in: [null, "clock_out"],
      clock_out: ["clock_in", "break_end"],
      break_start: ["clock_in", "break_end"],
      break_end: ["break_start"],
    };
    for (const last of [null, "clock_in", "clock_out", "break_start", "break_end"]) {
      for (const a of kioskActions(last)) expect(allowed[a]).toContain(last);
      for (const t of PUNCH_TYPES)
        if (allowed[t].includes(last)) expect(kioskActions(last)).toContain(t);
    }
  });
});

describe("identifyFailure", () => {
  it("answers every wrong PIN the same way, with no hint whose it was", () => {
    const r = identifyFailure({ status: "wrong", attempts_left: 3 });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "PIN not recognized", code: "wrong_pin", attemptsLeft: 3 });
  });
  it("a short lockout is 429 with Retry-After", () => {
    const r = identifyFailure({ status: "locked", needs_manager: false, retry_after: 120 });
    expect(r.status).toBe(429);
    expect(r.headers).toEqual({ "Retry-After": "120" });
    expect(r.body.retryAfter).toBe(120);
  });
  it("a lockout without a retry time still says when (5 minutes)", () => {
    expect(identifyFailure({ status: "locked", needs_manager: false }).headers).toEqual({ "Retry-After": "300" });
  });
  it("the daily lockout needs a manager (423)", () => {
    const r = identifyFailure({ status: "locked", needs_manager: true });
    expect(r.status).toBe(423);
    expect(r.body.needsManager).toBe(true);
    expect(r.headers).toBeUndefined();
  });
  it("an unknown or revoked kiosk is 401 no_kiosk; kiosk mode off is 403", () => {
    expect(identifyFailure({ status: "no_kiosk" })).toMatchObject({ status: 401, body: { code: "no_kiosk" } });
    expect(identifyFailure({ status: "disabled" })).toMatchObject({ status: 403, body: { code: "disabled" } });
  });
});

it("the kiosk forgets an employee after 30 seconds idle", () => {
  expect(KIOSK_IDLE_MS).toBe(30_000);
});
