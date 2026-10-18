import { describe, it, expect } from "vitest";
import { cleanRef, notableReferrerHost } from "./notable-visit";

describe("cleanRef", () => {
  it("accepts short slug-like tags", () => {
    expect(cleanRef("resume")).toBe("resume");
    expect(cleanRef("acme_2026-app")).toBe("acme_2026-app");
  });
  it("rejects anything else", () => {
    expect(cleanRef("")).toBeNull();
    expect(cleanRef("a b")).toBeNull();
    expect(cleanRef("x".repeat(33))).toBeNull();
    expect(cleanRef(42)).toBeNull();
  });
});

describe("notableReferrerHost", () => {
  it("matches listed sites and their subdomains", () => {
    expect(notableReferrerHost("www.linkedin.com")).toBe("linkedin.com");
    expect(notableReferrerHost("acme.wd5.myworkdayjobs.com")).toBe("acme.wd5.myworkdayjobs.com");
  });
  it("ignores other hosts and lookalikes", () => {
    expect(notableReferrerHost("google.com")).toBeNull();
    expect(notableReferrerHost("evillinkedin.com")).toBeNull();
    expect(notableReferrerHost(undefined)).toBeNull();
  });
});
