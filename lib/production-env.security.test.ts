import { describe, it, expect } from "vitest";
import { productionEnvProblems, REQUIRED_PRODUCTION_ENV } from "./production-env";

const complete = Object.fromEntries(
  REQUIRED_PRODUCTION_ENV.map((name) => [name, "set"]),
) as unknown as NodeJS.ProcessEnv;
complete.MESSAGE_ENCRYPTION_KEY = "a".repeat(64);

describe("productionEnvProblems", () => {
  it("accepts a complete production environment", () => {
    expect(productionEnvProblems(complete)).toEqual([]);
  });

  it("names every missing or blank variable", () => {
    const env = { ...complete, TURNSTILE_SECRET_KEY: undefined, CRON_SECRET: "  " };
    expect(productionEnvProblems(env)).toEqual([
      "CRON_SECRET is not set",
      "TURNSTILE_SECRET_KEY is not set",
    ]);
  });

  it("rejects a malformed message encryption key", () => {
    expect(productionEnvProblems({ ...complete, MESSAGE_ENCRYPTION_KEY: "abc" })).toEqual([
      "MESSAGE_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)",
    ]);
  });

  it("rejects the e2e auth bypass", () => {
    expect(productionEnvProblems({ ...complete, E2E_BYPASS_AUTH: "1" })).toEqual([
      "E2E_BYPASS_AUTH must not be set (it is for Playwright runs only)",
    ]);
  });
});
