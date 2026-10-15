import { describe, it, expect } from "vitest";
import { isE2eBypassEnabled } from "./e2e-bypass";

describe("isE2eBypassEnabled", () => {
  it("is off unless E2E_BYPASS_AUTH is exactly 1", () => {
    expect(isE2eBypassEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isE2eBypassEnabled({ E2E_BYPASS_AUTH: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isE2eBypassEnabled({ E2E_BYPASS_AUTH: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("is on for local, CI and preview builds", () => {
    expect(isE2eBypassEnabled({ E2E_BYPASS_AUTH: "1", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isE2eBypassEnabled({ E2E_BYPASS_AUTH: "1", VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("can't be turned on in a Vercel production deployment", () => {
    expect(isE2eBypassEnabled({ E2E_BYPASS_AUTH: "1", VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
