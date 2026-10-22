// Closes the issues a merged pull request names with "Closes #N" (or Fixes,
// Resolves). GitHub only does this itself when the pull request merges into
// the default branch (main), and work here merges into dev first.

const KEYWORDS = "close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved";

// Issue numbers in this repository that `text` says it closes. "Closes
// owner/repo#N" for another repository is left alone.
export function linkedIssues(text, repo) {
  const pattern = new RegExp(`\\b(?:${KEYWORDS}):?\\s+(?:([\\w.-]+/[\\w.-]+))?#(\\d+)\\b`, "gi");
  const found = new Set();
  for (const [, other, number] of String(text ?? "").matchAll(pattern)) {
    if (other && other.toLowerCase() !== repo.toLowerCase()) continue;
    found.add(Number(number));
  }
  return [...found].sort((a, b) => a - b);
}

async function main() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, PR_BODY } = process.env;
  const api = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  for (const number of linkedIssues(PR_BODY, GITHUB_REPOSITORY)) {
    const issue = await fetch(`${api}/issues/${number}`, { headers }).then((r) => r.json());
    // A pull request number, a missing issue, or one already closed.
    if (!issue.number || issue.pull_request || issue.state !== "open") {
      console.log(`#${number}: skipped`);
      continue;
    }
    await fetch(`${api}/issues/${number}/comments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ body: `Closed by #${PR_NUMBER}, merged into dev.` }),
    });
    const closed = await fetch(`${api}/issues/${number}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ state: "closed", state_reason: "completed" }),
    });
    if (!closed.ok) throw new Error(`#${number}: ${closed.status} ${await closed.text()}`);
    console.log(`#${number}: closed`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
