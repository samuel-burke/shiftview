import { execFileSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script with no type declarations
import { checkBranchFlow } from "./branch-flow.mjs";

describe("checkBranchFlow", () => {
  it("accepts task branches into dev", () => {
    for (const head of ["feat/kiosk", "fix/slack-alerts", "bug/clock-drift", "chore/agents-engineering-workflow", "docs/ci-cd", "test/rls", "fix/dev-ci-e2glur", "chore/bump-next-16.4.2"]) {
      expect(checkBranchFlow("dev", head).ok, head).toBe(true);
    }
  });

  it("accepts tool branches into dev only", () => {
    for (const head of ["dependabot/npm_and_yarn/next-16.4.2", "coderabbit/fix-email-validation-dos/1fd046a8", "alert-autofix-9"]) {
      expect(checkBranchFlow("dev", head).ok, head).toBe(true);
      expect(checkBranchFlow("main", head).ok, head).toBe(false);
    }
  });

  it("rejects unprefixed, agent-named and malformed branches into dev", () => {
    for (const head of ["claude/project-thread-s6bujw", "integration/security-fixes", "my-change", "Feat/Kiosk", "feat/", "feat/-x", "main", "dev"]) {
      expect(checkBranchFlow("dev", head).ok, head).toBe(false);
    }
  });

  it("accepts only dev into main", () => {
    expect(checkBranchFlow("main", "dev").ok).toBe(true);
    for (const head of ["feat/kiosk", "fix/slack-alerts", "chore/release", "hotfix/punch-crash"]) {
      expect(checkBranchFlow("main", head).ok, head).toBe(false);
    }
  });

  it("accepts a hotfix into main only with the emergency-hotfix label", () => {
    expect(checkBranchFlow("main", "hotfix/punch-crash", ["emergency-hotfix"]).ok).toBe(true);
    expect(checkBranchFlow("main", "hotfix/punch-crash", ["hotfix"]).ok).toBe(false);
    expect(checkBranchFlow("main", "fix/punch-crash", ["emergency-hotfix"]).ok).toBe(false);
  });

  it("rejects other base branches", () => {
    expect(checkBranchFlow("feat/kiosk", "fix/x").ok).toBe(false);
  });

  it("fails the process with an annotation when the flow is wrong", () => {
    const script = path.join(__dirname, "branch-flow.mjs");
    const run = (env: Record<string, string>) =>
      execFileSync(process.execPath, [script], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });
    expect(run({ BASE_REF: "dev", HEAD_REF: "feat/kiosk" })).toContain("feat/kiosk -> dev");
    let failure: { status?: number; stdout?: string } = {};
    try {
      run({ BASE_REF: "main", HEAD_REF: "feat/kiosk" });
    } catch (error) {
      failure = error as typeof failure;
    }
    expect(failure.status).toBe(1);
    expect(failure.stdout).toContain("::error::PRs into main must come from dev");
    expect(run({ BASE_REF: "main", HEAD_REF: "hotfix/x", PR_LABELS: "bug, emergency-hotfix" })).toContain("Emergency hotfix");
  });
});
