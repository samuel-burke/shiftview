import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { REQUIRED_PRODUCTION_ENV } from "./production-env";

// .env.example is the setup checklist for a new environment, so it must name
// every variable a production build requires, and hold no real values.
const example = readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
const entries = new Map(
  example
    .split("\n")
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)] as const;
    }),
);

describe(".env.example", () => {
  it("lists every variable a production build requires", () => {
    const missing = REQUIRED_PRODUCTION_ENV.filter((name) => !entries.has(name));
    expect(missing).toEqual([]);
  });

  it("contains no secret values", () => {
    const allowed = new Map([["NEXT_PUBLIC_SITE_URL", "http://localhost:3000"]]);
    for (const [name, value] of entries) {
      expect([name, value]).toEqual([name, allowed.get(name) ?? ""]);
    }
  });

  it("does not enable the e2e auth bypass", () => {
    expect(entries.has("E2E_BYPASS_AUTH")).toBe(false);
  });
});
