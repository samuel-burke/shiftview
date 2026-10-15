import { describe, it, expect } from "vitest";
import { isE2eBypassEnabled } from "./e2e-bypass";

describe("isE2eBypassEnabled", () => {
  it("is off unless E2E_BYPASS_AUTH is exactly 1", () => {
    expect(isE2eBypassEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isE2eBypassEnabled({ E2E_BYPASS_AUTH: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isE2eBypassEnabled({ E2E_BYPASS_AUTH: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("is on for local and CI production builds", () => {
    expect(isE2eBypassEnabled({ E2E_BYPASS_AUTH: "1", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it.each([
    ["production", { VERCEL: "1", VERCEL_ENV: "production" }],
    ["preview", { VERCEL: "1", VERCEL_ENV: "preview" }],
    ["development", { VERCEL: "1", VERCEL_ENV: "development" }],
    ["VERCEL only", { VERCEL: "1" }],
    ["VERCEL_ENV only", { VERCEL_ENV: "preview" }],
  ])("can't be turned on in a Vercel deployment (%s)", (_name, vercel) => {
    expect(isE2eBypassEnabled({ E2E_BYPASS_AUTH: "1", ...vercel } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
