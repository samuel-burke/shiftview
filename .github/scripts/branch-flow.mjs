// Checks a pull request's head and base branches against the branch model in
// AGENTS.md: task branches merge into dev, and only dev (or a hotfix/* branch
// the owner has labeled emergency-hotfix) merges into main.

// Prefixes people and agents use for task branches.
const TASK_BRANCH = /^(feat|fix|bug|refactor|chore|docs|test|ci|perf|hotfix)\/[a-z0-9][a-z0-9._-]*$/;

// Branches that tools open pull requests from: Dependabot updates, CodeRabbit
// and GitHub code scanning autofixes. They may target dev, never main.
const TOOL_BRANCH = /^(dependabot\/[\w./-]+|coderabbit\/[\w./-]+|alert-autofix-\d+)$/;

const HOTFIX_BRANCH = /^hotfix\/[a-z0-9][a-z0-9._-]*$/;

// Returns { ok, message } for a pull request from `head` into `base`.
// `fromFork` is true when the head branch lives in another repository: a
// fork's branch named dev is not this repository's dev.
export function checkBranchFlow(base, head, labels = [], fromFork = false) {
  if (base === "main") {
    if (fromFork) return { ok: false, message: "PRs into main must come from this repository's dev, not a fork." };
    if (head === "dev") return { ok: true, message: "Release PR: dev -> main." };
    if (HOTFIX_BRANCH.test(head) && labels.includes("emergency-hotfix")) {
      return { ok: true, message: "Emergency hotfix -> main. The label is not an approval: owner review is still required." };
    }
    return { ok: false, message: `PRs into main must come from dev (or a hotfix/* branch labeled emergency-hotfix), not "${head}".` };
  }
  if (base === "dev") {
    if (head === "main" || head === "dev") {
      return { ok: false, message: `"${head}" can't be merged into dev with a PR. Bring a hotfix back to dev from its hotfix/* branch.` };
    }
    if (TASK_BRANCH.test(head) || TOOL_BRANCH.test(head)) return { ok: true, message: `Task branch ${head} -> dev.` };
    return {
      ok: false,
      message: `"${head}" is not a task branch. Use feat/, fix/, bug/, chore/, docs/, refactor/, test/, ci/, perf/ or hotfix/ and a lowercase name (AGENTS.md section 3).`,
    };
  }
  return { ok: false, message: `Unexpected target branch "${base}". PRs target dev, and releases target main.` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { BASE_REF = "", HEAD_REF = "", PR_LABELS = "", HEAD_REPO = "", BASE_REPO = "" } = process.env;
  const labels = PR_LABELS.split(",").map((label) => label.trim()).filter(Boolean);
  const fromFork = HEAD_REPO.toLowerCase() !== BASE_REPO.toLowerCase();
  const { ok, message } = checkBranchFlow(BASE_REF, HEAD_REF, labels, fromFork);
  if (ok) {
    console.log(message);
  } else {
    console.log(`::error::${message}`);
    process.exit(1);
  }
}
