# AI Engineering Standards and Project Rules

> **Purpose:** Standing instructions for every AI coding agent and human contributor to this repository. Prioritize correctness, maintainability, security, testability, and small, reviewable changes over speed or code volume.
>
> **Authority:** Follow these standards unless the project owner explicitly approves a documented exception. Existing project-specific decisions can extend these rules but must not silently weaken security, testing, or release protections. Never claim to have enforced a rule that is only written down.

## 1. Non-negotiable rules

1. **Never commit or push directly to `main` or `dev`.** Both are protected branches. Work on a short-lived branch and open a pull request (PR).
2. **Standard path:** `feat/*`, `fix/*`, or other short-lived task branch (see Section 3) **→ PR into `dev` → release PR from `dev` into `main`**.
3. **Never merge a PR, deploy to production, change production data, bypass protection, or run destructive commands without the project owner's explicit approval.** Opening a draft PR is acceptable when authorized; merging is not implicit.
4. **Never claim completion without observed verification.** Writing code, reviewing a diff, a passing build, or an AI-generated explanation is not proof that behavior works. Execute applicable checks against the final changed code, inspect their real results, and apply the verification gate in Section 12. A failing required check means the work is **BLOCKED**, not complete. Do not disable, skip, delete, mock away, or lower tests, coverage thresholds, lints, or security checks to get a green build.
5. **Test every changed behavior at the appropriate level.** Maintain meaningful unit, integration, and end-to-end (E2E) coverage across the project. For a code change, add or update the relevant test types and include happy paths, errors, boundaries, and regressions.
6. **Never expose secrets or sensitive user data.** No secrets in code, commits, screenshots, logs, fixtures, error reports, or AI prompts. Never access production data without authorization.
7. **Never fabricate verification evidence.** Report exactly which commands and tests were run, their real results, and which checks were not run and why. Never invent CI status, coverage numbers, screenshots, browser interactions, logs, deployment results, or manual testing.
8. **Avoid unrelated edits.** No speculative rewrites, unrelated dependencies, broad formatting, or architecture changes hidden in a small task.
9. **Preserve working functionality and public contracts** unless a breaking change is requested, planned, documented, and tested.
10. **When requirements are ambiguous or a decision is high-risk, explain the uncertainty and propose a safe approach before acting.** Prefer conservative, reversible changes.
11. **Implement automated CI/CD safeguards rather than only describing them.** A production-capable app must have an applicable CI workflow, verified required merge checks, and a documented and tested release/deployment path. Select a deployment mechanism based on the repository’s actual stack, hosting constraints, risk, and owner preference; never assume a specific vendor. Never equate a workflow template or passing build with an active, working pipeline.
12. **Keep the README status badges accurate.** Link to real GitHub Actions checks on named branches and to real coverage/deployment telemetry only when configured. Never use static success graphics, guessed endpoints, or old checks as evidence.

## 2. Required workflow for every task

### Before changing code

- Read this file, `README.md`, relevant docs, current tests, configuration, and nearby implementation patterns.
- Inspect Git status and the current branch. Never discard or overwrite the owner's uncommitted work.
- State the goal, success/acceptance criteria, assumptions, affected areas, risks, and test plan. For nontrivial changes, write a brief implementation plan before editing.
- Confirm that a suitable task branch exists; otherwise branch from the latest `dev` for normal work. Do not switch branches if that would endanger uncommitted changes.
- Search for existing abstractions and test utilities before adding new ones. Reuse established patterns unless there is a specific reason to improve them.
- For changes to APIs, persistence, authorization, concurrency, deployment, or shared architecture, identify impacts and backward-compatibility requirements before implementing.

### While implementing

- Make the smallest coherent change that satisfies the acceptance criteria.
- Keep code understandable, typed where supported, cohesive, and consistent with project conventions.
- Add or modify automated tests alongside implementation, preferably using a red/green/refactor cycle for bugs and complex logic.
- Run targeted checks early, then the full required suite against the **final code** before declaring verification. When implementation changes after a test run, rerun affected checks.
- Update documentation, examples, migrations, and changelog entries as appropriate.
- If new information invalidates the plan, revise the plan and communicate meaningful changes in scope.

### Before handing off

- Review the diff for correctness, scope creep, security issues, accidental secrets, generated files, and missing tests.
- Run formatter, linter, type checker, relevant tests, coverage report, and production build when applicable.
- Apply the **Verification Before Completion** gate in Section 12. Report the work status, branch, changes made, acceptance criteria with evidence, exact test commands and results, coverage impact, known risks, and follow-up work. If any required check fails or cannot run, do not label the work complete.
- Prepare a PR with context and verification instructions. **Do not merge or deploy without approval.**

## 3. Git strategy and branch protection

### Branch roles and naming

| Branch | Purpose | Starting point | Merge destination |
| --- | --- | --- | --- |
| `main` | Production-ready, released code | — | Protected; receives reviewed release PRs from `dev` |
| `dev` | Integration branch; deploys to staging when configured | — | Protected; receives reviewed work PRs |
| `feat/short-description` | New capability | `dev` | `dev` |
| `fix/short-description` (or `bug/`) | Ordinary bug fix | `dev` | `dev` |
| `refactor/short-description` | Behavior-preserving cleanup | `dev` | `dev` |
| `chore/short-description` | Maintenance, tooling, dependencies | `dev` | `dev` |
| `docs/short-description` | Documentation | `dev` | `dev` |
| `test/short-description` | Test-only work | `dev` | `dev` |
| `ci/short-description` | CI/workflow-only work | `dev` | `dev` |
| `perf/short-description` | Performance work | `dev` | `dev` |
| `hotfix/short-description` | Exceptional urgent production repair | `main` | See hotfix policy below |

- Name branches by intent; keep them short-lived and narrowly scoped. Use only the prefixes in the table above; agent- or tool-named prefixes are not allowed for human/agent task branches. `.github/workflows/branch-flow.yml` enforces this list.
- Use meaningful, atomic commits. Prefer Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`) when no existing project convention supersedes them.
- Do not force-push shared/protected branches, rewrite others' history, or commit binary/build artifacts unless intentionally required.
- Keep long-running work small by integrating via reviewed PRs. Resolve conflicts deliberately and rerun tests after resolution.

### Normal feature and bug workflow

1. Sync local `dev` safely with remote (without destroying local changes).
2. Create `feat/...` or `fix/...` from `dev`.
3. Implement, document, and test on the task branch.
4. Open a PR with **base `dev`**. CI must pass; obtain required review/owner approval.
5. Merge using the repository's approved strategy. Delete the merged task branch when safe.
6. Repeat until `dev` is ready for release; do not cherry-pick random features into `main` as a substitute for the release process.

### Release workflow: `dev` → `main`

- Prepare the version/release changes on a branch targeting `dev` first, including `CHANGELOG.md` and any version metadata; merge those changes into `dev`.
- Open a **dedicated, detailed release PR from `dev` into `main`**, not a generic feature PR.
- Release PR must include: release/version identifier; summary and business impact; included changes/PRs; breaking changes and migrations; full test/CI results; security and dependency checks; staging verification; deployment steps; monitoring; and rollback plan.
- Require all checks and manual review. Production deployments must use `main` or a reviewed, immutable release tag, never arbitrary feature commits.
- Tag releases consistently (for example, `v1.2.0`); follow Semantic Versioning when applicable. Keep release notes accurate.

### Emergency hotfix exception

- Use `hotfix/*` from `main` **only** when the owner approves an urgent production fix that cannot wait for the normal release train.
- Require a separate hotfix PR to `main`, clear severity justification, focused tests, owner review, and a rollback plan. The branch-flow workflow (`.github/workflows/branch-flow.yml`) requires an `emergency-hotfix` PR label for this exception; a label does **not** replace actual approval.
- Immediately reconcile the shipped hotfix back into `dev` through a PR, preserving its tests and documentation, so the next release does not regress it.

### Repository-level enforcement (must be configured, not merely stated)

- Protect **both** `dev` and `main`: require PRs, passing status checks, resolved review comments, and approvals appropriate to the team; prohibit direct/force pushes and branch deletion; disable bypass where supported.
- Require CI checks on PRs targeting both branches: lint/format, type check, unit, integration, E2E (at least critical smoke paths), build, coverage, dependency/security scans, and branch-flow validation as applicable.
- On `main`, enforce PR head branch `dev` except explicitly approved `hotfix/*` exceptions (enforced by `.github/workflows/branch-flow.yml` once it is a required check).
- Prefer preview environments for feature PRs, staging from `dev`, and production from `main`, with isolated secrets and databases.
- If branch rules/CI do not exist or cannot be verified, flag this as a setup blocker; **do not claim the repo is protected**.

## 4. Testing strategy and coverage

### Test the right behavior at the right level

- **Unit tests:** Pure functions, domain/business rules, input validation, calculations, state transitions, error and boundary cases. Keep unit tests fast and deterministic.
- **Integration tests:** Real interactions among modules, API handlers, services, authorization layer, database/repository layer, and external contracts where practical. Use controlled test databases and isolated fixtures.
- **E2E tests:** Important user journeys and system boundaries, such as sign-in, key workflows, permissions, and failure recovery. Run critical smoke tests on every PR; run broader E2E suites at least before release and wherever CI cost permits.
- **Regression tests:** Every fixed bug should get a test that fails before the fix and passes afterward when reasonably reproducible.
- **Contract tests:** Use when services, webhooks, APIs, events, or third-party boundaries need compatibility guarantees.
- **Accessibility and security tests:** Automate meaningful checks and supplement with manual inspection for risks automation cannot cover.

Do **not** mechanically write three redundant tests for every line or trivial helper. Every behavior change must have sufficient protection at the most useful layers, and every critical cross-component journey must have E2E coverage.

### Coverage policy

- Aim for **≥85% line coverage and ≥80% branch coverage** overall, with **≥90% coverage of newly added or changed testable code** where tooling supports it. These are initial project defaults, not a substitute for risk-based testing.
- Do not let existing coverage decrease without an explicit, justified owner-approved exception. If the repository starts below target, establish a measured baseline and an incremental improvement plan rather than falsifying compliance.
- Thoroughly exercise security-sensitive, financial, scheduling, authorization, and data-integrity logic. Review critical branches even where aggregate coverage is high.
- Test success, failure, empty/null, boundaries, malformed input, unauthorized access, race/concurrency behavior, time zones/dates, retries/timeouts, and cross-tenant isolation wherever relevant.
- Favor assertions about observable behavior over brittle implementation details. Avoid snapshots without review; keep mocks faithful to real contracts.
- Make tests repeatable: isolated fixtures, controlled clocks/IDs, cleanup, independent ordering, no live production dependencies, and bounded waits instead of arbitrary sleeps.
- Never hide failing tests with `.skip`, `.only`, ignored errors, loose assertions, or excessive mocks. Explain any temporary quarantine and obtain explicit approval.

## 5. Code quality, architecture, and design

- Favor simple, readable solutions with clear names, small responsibilities, and explicit interfaces. Do not overengineer for hypothetical requirements.
- Match the project's language/toolchain patterns; enable and respect strict typing when available. Avoid `any`/unchecked casts and suppressions without documented justification.
- Separate domain rules, data access, API/transport, presentation, and infrastructure concerns where the architecture warrants it. Business rules must not exist only inside UI handlers.
- Minimize duplication while resisting premature abstractions. Use established modules and services, and keep coupling low.
- Handle errors explicitly. Return useful, safe messages to users; preserve diagnostic context in secure logs. Never swallow exceptions silently.
- Validate input at trusted system boundaries, not only in the browser. Define output and failure contracts; do not trust clients or external systems.
- Use pagination and bounded operations for growing data. Avoid unnecessary N+1 queries, inefficient retries, resource leaks, and unbounded queues.
- Consider concurrency, idempotency, transactions, consistency, cancellation, and retries for workflows where duplicate or partial execution matters.
- Treat time zones, daylight-saving transitions, inclusive/exclusive boundaries, money/precision, and locale formatting as explicit design concerns when relevant.
- Create architecture decision records (`docs/adr/`) for significant choices, documenting alternatives, tradeoffs, and consequences.
- Favor configuration over environment-specific hard-coding. Keep constants named and explain surprising decisions, not obvious syntax.

## 6. Security and privacy by default

- Follow secure-development guidance relevant to the product; for web applications, use **OWASP ASVS** as a checklist for applicable risks.
- Perform authorization on the **server and data layer** for every protected action; authentication alone is insufficient. Verify resource ownership and role on each request.
- For multi-tenant apps, enforce organization/tenant scoping throughout queries, APIs, background jobs, storage, and database policies (for example, row-level security). Explicitly test that tenant A cannot access tenant B.
- Use parameterized queries/ORM safely; guard against SQL/command injection, XSS, CSRF where applicable, SSRF, open redirects, path traversal, insecure deserialization, and insecure direct object reference.
- Apply least privilege to users, service accounts, database roles, CI tokens, and third-party integrations. Keep secrets in approved environment/secret stores; commit only safe `.env.example` placeholders.
- Use the framework's maintained auth/session primitives, secure cookie settings, HTTPS, input-size limits, and appropriate CORS/CSP protections. Do not invent custom cryptography or authentication protocols.
- Rate-limit and abuse-protect exposed endpoints and expensive operations. Validate file types/sizes and signatures of incoming webhooks, and account for replay protection where relevant.
- Minimize personal-data collection and retention. Redact secrets, tokens, sensitive identifiers, and private payloads from logs, traces, analytics, prompts, and test fixtures.
- Pin/lock dependencies, inspect advisories, avoid unnecessary packages, and check licenses before adding dependencies. Keep a plan to patch known vulnerabilities.
- For high-risk changes (auth, payments, privileges, secrets, migrations), include a small threat/risk assessment and dedicated negative tests in the PR.

## 7. Database, migrations, and API changes

- Use version-controlled, reviewed migrations. Never change production schema/data ad hoc or execute destructive production actions without explicit approval and a recovery plan.
- Prefer backward-compatible, staged migrations (expand → migrate/backfill → contract) when old and new versions may coexist.
- Define required constraints/indexes and test rollback or recovery when practical. Backups are not a substitute for verifying migration behavior.
- Design for duplicate requests, concurrent writes, partial failures, referential integrity, and safe retries where applicable.
- Keep API/request/response schemas explicit and validated. Document breaking changes; update clients, docs, fixtures, and contract tests together.
- Never run E2E or integration tests against production resources.

## 8. Frontend, UX, and accessibility (when applicable)

- Build responsive, keyboard-operable, semantic interfaces with clear focus states, labels, and accessible feedback.
- Target **WCAG 2.2 AA** where applicable; test contrast, screen-reader labeling, errors, focus order, zoom, touch target sizes, and reduced-motion preferences.
- Use design-system tokens for colors, typography, spacing, and states. Avoid hard-coded one-off theme values when tokens exist.
- Cover loading, empty, success, error, offline/slow-network, and permission-denied states. Prevent accidental duplicate submissions.
- Keep forms validated on both client and server. Ensure the UI accurately reflects server authorization and business rules.
- Measure meaningful performance changes; avoid unnecessary bundles, re-renders, and requests. Prefer accessible progressive enhancement over clever but fragile UI.

## 9. CI/CD, environments, and operations

- Automate repeatable checks. Standardize project commands/scripts for `lint`, `format:check`, `typecheck`, `test`, `test:integration`, `test:e2e`, `test:coverage`, and `build` as appropriate to the stack; document alternatives for nonapp projects.
- Create a stack-specific GitHub Actions pipeline (or approved equivalent), rather than stopping at a branch validation workflow. At minimum, run appropriate formatting/linting, typing, unit, integration, critical E2E, coverage, dependency/security checks, and build; define genuine not-applicable exceptions by project.
- Run CI on PRs targeting `dev` and `main`, and on pushes to those branches when appropriate. The CI must run on the commit being evaluated; rerun after changes, and make required checks block merging.
- CI must fail on real failures. Keep required checks stable, deterministic, and protected from untrusted PR code obtaining production secrets. Keep job-level permissions minimal and never use `pull_request_target` to execute untrusted PR code with credentials.
- Separate development, test, staging, preview, and production resources; never reuse production secrets or databases in PR previews.
- Use reproducible installs and committed lockfiles; keep environment configuration documented and secrets out of source control.
- Use health checks, structured logs, appropriate metrics/alerts, and actionable error reporting for deployed apps. Avoid logging sensitive information.
- Provide graceful failure, timeouts, retry/backoff with limits, idempotent background jobs, and safe feature flags when needed.
- Document the release process and rollback method. Verify migrations, monitor after deploy, and retain an audit trail of what shipped.
- Select a deployment platform and delivery model that fit the application (for example a managed host, cloud infrastructure, containers, or a self-hosted server). **No provider is the default.** If the project does not deploy an application, document the appropriate package/artifact publishing or release process instead.
- For deployed applications, define how task branches are previewed (if supported), how `dev` is validated in an isolated integration/staging environment, and how authorized `main` releases reach production. These mappings must be explicitly configured and tested; a branch name alone does not create a deployment environment.
- Require applicable GitHub Actions quality checks and owner review before release merges. Choose a single authoritative deployment mechanism (host-native Git integration, Actions-based deployment, or another controller), and avoid duplicate deploy triggers. **If merging `main` automatically deploys, disclose this consequence and obtain explicit approval before merging.** GitHub PR checks alone may not enforce a post-merge production-promotion gate; configure actual provider controls or a separate approval step as necessary.
- Never claim a deployment or publication succeeded from a Git push or a passing build alone. Verify the **released artifact, expected commit, target environment, and real post-release behavior**, and distinguish code-ready, published, and production-verified states.
- Document deployment triggers, environment isolation, secret management, expected CI checks, staging/preview access, promotion controls, smoke tests, monitoring, rollback, and human approvals. This repository's plan is `docs/ci-cd.md`.

## 10. Documentation and change management

Keep these artifacts current when relevant:

- `README.md`: purpose, architecture overview, setup, environment variables (names only), local commands, test commands, deployments, troubleshooting, and **live CI status badges for `dev` and `main`**. Add coverage/deployment badges only when backed by real measured providers or supported dynamic checks. Check badge targets when changing CI workflow names or branch strategy.
- `CHANGELOG.md`: user-visible changes under an `Unreleased` section, then versioned releases grouped as Added / Changed / Fixed / Security / Removed when applicable. Update it as part of release preparation; also add meaningful unreleased entries during development where practical.
- `docs/architecture.md` or equivalent: main components, data flow, trust boundaries, and important integrations.
- `docs/adr/`: significant architecture decisions and rationale.
- API schemas, migration notes, runbooks, and operational instructions when the work changes them.
- `SECURITY.md`, `CONTRIBUTING.md`, and public-facing privacy/support/accessibility policies as applicable; apply the content and review requirements in Section 16.

Do not write fictitious accomplishments, stale setup instructions, or comments that contradict code. Comments should clarify decisions and invariants rather than narrate obvious code.

## 11. Pull request quality standard

Every PR must describe:

1. **Why:** problem, context, linked issue, and desired result.
2. **What:** meaningful code/behavior changes, limits of scope, screenshots if UI changes.
3. **Risk:** auth/data/security/compatibility/performance impact, migration or feature flags.
4. **Testing:** commands actually run, results, notable edge cases, coverage impact, and manual verification.
5. **Deployment:** rollout, configuration needs, monitoring, and rollback if applicable.
6. **Checklist:** reviewed diff, relevant tests and docs, no secrets, approvals pending/obtained.

For a `dev` → `main` PR also include the **release version, complete changelog, all included feature/bug PRs, staging evidence, breaking changes, known issues, and explicit production/rollback plan**. Use `.github/PULL_REQUEST_TEMPLATE.md` if provided.

## 12. Verification before completion (mandatory gate)

**The agent must demonstrate that the change works, not merely state that it should work.** Code generation, a clean diff, successful compilation, and self-review do **not** independently establish functional correctness. Do not say "done," "fixed," "working," "all tests pass," "production-ready," or similar unless the corresponding claim is supported by tests and checks actually performed on the final code and environment.

### Required verify-and-fix loop

1. **Define evidence before coding:** Convert each acceptance criterion into an observable verification step (automated test, API response, UI interaction, assertion, or appropriate manual check). Include relevant failure, boundary, authorization, and regression behavior. Mark checks as required or non-applicable with reasons.
2. **Reproduce bugs first where feasible:** Record the original failure and add a regression test that fails for the original defect. If reproduction is impossible, state why and what alternative evidence will be used.
3. **Implement and execute:** Run targeted unit/integration tests, then the applicable E2E user journey, static checks, coverage and build. A build proves buildability, **not** correct behavior. Use isolated test data and environments, never production resources.
4. **Inspect real output:** Check actual process exit codes, assertions, failing test names, logs, coverage artifacts, browser behavior, and relevant CI run results. A command that never started, hung, was skipped, or produced incomplete output did not pass. Do not cite an old CI run for a new commit.
5. **Fix and rerun:** Diagnose test or check failures; fix the underlying issue rather than weakening tests. Rerun affected tests after each relevant change, and rerun required checks after the **last** implementation change. If failures persist, report the blocker and next step; do not endlessly retry or hide failures.
6. **Verify user-visible behavior:** For frontend changes, use an actual browser or E2E runner when available, interact with affected flows, check success/error/loading states, and inspect the rendered result across relevant viewports. Screenshot or visual review can supplement, but does not replace behavior assertions. If no browser is available, disclose that UI behavior was **NOT RUN** rather than claiming the UI was visually verified.
7. **Verify integrations and permissions:** For backend/data changes, exercise real handler/service/database interactions using test resources where feasible; test access-denied and invalid-input cases. Mocks alone do not prove that integrations, migrations, or tenant isolation work.
8. **Match evidence to criteria:** Explicitly map each acceptance criterion to what passed, failed, or remains unverified. Record any environment differences, limitations, known failures, and regression risk.

### Required reporting semantics

**Check results** must be reported per item, using these exact labels:

- **PASS:** The check actually ran to completion against the relevant final revision, and its assertions/criteria succeeded.
- **FAIL:** The check ran and reported a failure (including a flaky or inconclusive failure until investigated).
- **NOT RUN:** The check was skipped, unavailable, interrupted, or could not be completed; give the reason and next action.
- **N/A:** The check genuinely does not apply to this change; briefly explain why. Do not use N/A just because a test is inconvenient.

**Overall implementation verification status** must be exactly one of:

- **VERIFIED:** All applicable required checks and acceptance criteria have observed passing evidence on the final code; no required check is failed or not run. Only now may the agent describe the **implementation** as complete/verified. This does **not** mean approved, merged, deployed, or production-validated.
- **PARTIALLY VERIFIED:** Some applicable checks passed, but other required checks were not run or remain inconclusive. Say precisely what works and what is unverified; **do not** claim completion.
- **UNVERIFIED:** Code was written/reviewed, but no meaningful execution-based verification of changed behavior was completed. **Do not** claim completion.
- **BLOCKED:** A required check fails, acceptance criteria fail, or a material blocker prevents necessary progress. List failures and remediation. **Do not** claim completion.

Never relabel a failing check as N/A or use PARTIALLY VERIFIED to conceal a failure. A test suite passing after tests were weakened or meaningful assertions removed does not count as proof. If a previously failing test is genuinely pre-existing, show the baseline evidence, state its scope and impact, and still disclose that the required check is failing; do not quietly mark it PASS.

### Minimal evidence record (in handoff and PR)

For every substantive change, provide:

| Item | Evidence to record |
| --- | --- |
| Acceptance criteria | Each criterion → verification performed → observed result |
| Automated tests | Exact command, execution environment, PASS/FAIL/NOT RUN/N/A, test counts or failing names when available |
| Coverage | Tool and actual measured line/branch/new-code figures, or NOT RUN; never estimate |
| UI/manual verification | User journey, browser/device or environment, steps/results, or NOT RUN |
| CI/build/security | Relevant run link/check and revision when available, or local command and observed outcome |
| Final status | VERIFIED / PARTIALLY VERIFIED / UNVERIFIED / BLOCKED, outstanding risks and next actions |

Keep evidence concise for tiny changes, but never omit the real verification status. **A separate release/deployment status** must say whether the change was merely coded, PR-ready, approved, merged, deployed, and verified in the target environment; these are not interchangeable.

## 13. Definition of done

Work is **not done** until:

- [ ] All acceptance criteria are mapped to actual verification evidence, and the implementation status is **VERIFIED** per Section 12.
- [ ] Change is focused, readable, typed where applicable, and manually diff-reviewed.
- [ ] Relevant unit, integration, E2E, regression, and negative-path tests exist and **have been executed successfully on the final code**.
- [ ] Coverage targets are measured and met or approved/baseline gaps are explicitly disclosed without pretending they passed.
- [ ] Applicable lint, format, type checks, security/dependency checks, and production build **actually passed**.
- [ ] User-visible UI or API journeys, access controls, input boundaries, error handling, and privacy were verified at suitable levels.
- [ ] Documentation, migrations, API contracts, and changelog/release notes are updated where relevant; repo policies (security, privacy, contributing, accessibility, support) were reviewed for changes in behavior and accuracy.
- [ ] A PR is prepared to the **correct protected branch**, with complete risk and verification evidence.
- [ ] Any required human approval has been obtained **before merging or deploying**; production verification is reported separately after authorized deployment.

If a required check cannot run, report **NOT RUN** with the reason and next step and classify overall status as **PARTIALLY VERIFIED** or **UNVERIFIED** as appropriate. If it fails, classify the work as **BLOCKED**. Never silently treat either as a pass.

## 14. Project kickoff checklist (run once for each new repository)

1. Identify the stack, runtime/package manager, repository structure, deployment target, data sensitivity, and critical user journeys.
2. Create/confirm `main` and `dev`, default workflow, naming conventions, and required protected-branch rules. Report any enforcement that needs repository-admin action.
3. Create/confirm `.gitignore`, `README.md`, `.env.example`, `AGENTS.md`, `CHANGELOG.md`, PR template, `CONTRIBUTING.md`, and `SECURITY.md` (for any shared/public repo). Determine license deliberately; never assume a license. Review the documentation/policy applicability matrix in Section 16 and add privacy, support, accessibility, and community files where applicable.
4. Establish formatter, linter, strict typing, test tools (unit/integration/E2E), coverage reports, secret/dependency scanning, and reproducible installs.
5. Configure CI on PRs to `dev` and `main`, including a branch-flow check. Set required statuses in GitHub protections once check names exist.
6. Define isolated test/preview/staging/production environments and document secrets management and deployments.
7. Create initial smoke tests for the most important workflow and negative tests for authentication/authorization when applicable. Establish which acceptance criteria require real browser or integration verification.
8. Record baseline coverage and set an attainable improvement plan if below target.
9. Write acceptance criteria, nonfunctional requirements, security/privacy risks, and initial architecture decisions for the first feature.
10. Establish a test-evidence baseline and enforce the Section 12 verification status in every task handoff and PR. Summarize what is configured, what requires the owner's credentials/approval, and which safeguards are **not yet enforced**.

## 15. Required AI handoff format

End substantive tasks with the following compact, evidence-backed report. Use the **exact status vocabulary from Section 12** and do not substitute impressions for observations:

- **Implementation verification status:** VERIFIED / PARTIALLY VERIFIED / UNVERIFIED / BLOCKED; **why:** ...
- **Branch / PR target and revision:** ...
- **Implemented:** ...
- **Acceptance criteria → evidence:** criterion / verification performed / PASS, FAIL, NOT RUN, or N/A ...
- **Automated checks (actual commands + observed outcomes):** unit ...; integration ...; E2E ...; lint/typecheck/build ...; security ... (include failing counts or error summaries where available)
- **Browser / manual verification:** steps, environment, result or NOT RUN ...
- **Coverage:** measured values/tool, baseline/change, or NOT RUN ...
- **Security and compatibility considerations:** ...
- **Docs / changelog:** ...
- **Open failures, risks, or required manual actions:** ...
- **Ready for PR?** Yes / No (why). **Merged or deployed?** No unless separately authorized and verified. **Verified in production?** No unless observed after approved deployment.


## 16. Repository documentation, governance, and public policies

**At project kickoff, audit repository files before scaffolding.** Read existing documents and compare them with real behavior, repository visibility, intended users, and data flows. Never replace correct project-specific text with a generic template. Create missing files on a task branch, and mark unresolved owner decisions. Do not claim that a template is a published or legally sufficient policy. Keep repository guidance consistent with the running app and public website.

### Files to evaluate at kickoff

| Artifact | Default expectation | What it must cover |
| --- | --- | --- |
| `README.md` | All projects | Purpose, status, features, stack, prerequisites, local setup, example configuration without secrets, commands for run/test/lint/build, environment overview, architecture links, deployment notes, support/security links, and known limits. **Accurate GitHub Actions status badges for `dev` and `main`**, once working CI exists; add verified coverage and deployment badges if supported. Commands must actually be validated, or labeled NOT RUN. |
| `AGENTS.md` | Every AI-assisted project | Current engineering and agent instructions; link out to more specific standards rather than duplicating conflicting requirements. |
| `.gitignore`, `.env.example` | All projects, as applicable | Exclude credentials, local state, caches, and build artifacts; show required environment variable **names only** or clearly fake placeholders. Never use live tokens. |
| `CHANGELOG.md` | Versioned/shipped projects | Unreleased and versioned behavior changes, breaking changes, and security fixes, without disclosing exploitable details before remediation. |
| `SECURITY.md` | Public/shared repositories; strongly recommended for private products too | Supported versions, **private** vulnerability-reporting channel, scope, disclosure expectations, and update/release policy. Set a real contact or configure GitHub private vulnerability reporting **before publishing**. Never direct researchers to file public vulnerability issues. |
| `CONTRIBUTING.md` | Shared or public repos | Local setup, branches (`feat/*`, `fix/*`, … → `dev` → `main`), coding conventions, testing/verification, PR process, review expectations, and safe handling of reports. |
| `PRIVACY.md` / public privacy notice | Applications processing personal data | Actual categories collected, purposes, sources, processors/sharing, hosting/transfer practices, retention/deletion, user controls, contact, and effective date, tailored to applicable laws. Have owner/legal review before publishing. A repository draft does **not** replace a privacy notice on the app/site when required. |
| `LICENSE` | Explicit owner decision | Choose a license consistent with product/business goals. **Never invent, select, or apply a license without owner approval**. For private proprietary work, do not imply open-source reuse rights. |
| `docs/architecture.md` | Nontrivial systems | Components, data flow, identity/tenant boundaries, trust zones, infrastructure, external services, deployment, failure modes, and links to decisions. |
| `docs/adr/` | Significant design decisions | Date, context, alternatives, decision, trade-offs, and consequences. Do not retroactively fabricate decisions. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Shared workflows | Purpose, risk, acceptance criteria, observed verification, security/privacy effects, migration, documentation, and release checklist. |
| `.github/ISSUE_TEMPLATE/` | Team/community projects | Bug report (repro, expected/actual, safe logs), feature request (outcomes and constraints). Warn not to include secrets or vulnerability details. |
| `.github/CODEOWNERS` | Team repositories | Actual GitHub users/teams for review areas; do not guess names. Activate only with valid owners and suitable repo settings. |
| `.github/dependabot.yml` | Repos with supported package ecosystems | Correct ecosystem, paths, cadence, and safe PR target; inspect actual lockfiles first. An unconfigured example must not be installed as a live workflow. |
| `CODE_OF_CONDUCT.md`, `SUPPORT.md` | Public/community projects | Participation expectations, reporting channel, help routes, response boundaries; avoid promises that cannot be kept. |
| `ACCESSIBILITY.md` | User-facing apps | Accessibility goal, tested scope, known limitations, and ways to report barriers; do not claim conformance without an actual audit. |
| Operational docs / runbooks | Production services | Environment access boundaries, incident response, backup/restore **tested** procedure, monitoring, rollback, data retention, and operational ownership. |
| `.github/workflows/ci.yml` (or stack equivalent) | Production-capable repositories | Actual runnable CI on PRs/pushes for formatting/lint/type/unit/integration/E2E/build/security/coverage where applicable; mandatory checks enforced by GitHub rulesets. Do not activate an unadapted example. |
| `docs/ci-cd.md` (or provider-specific guide) | Deployed applications | Branch-to-environment mapping, deploy triggers, preview/staging/production isolation, provider integration, smoke tests, required approvals, monitoring, and rollback. |

### Privacy and data governance requirements

1. Before writing a privacy notice, map personal-data inputs, storage destinations, third-party SDKs/vendors, cookies/analytics, authentication, retention periods, backups, logs, and deletion paths. Validate against actual code/config and ask the owner to confirm anything not observable.
2. Separate **engineering documentation** (`docs/data-inventory.md` or a data-flow diagram) from the **user-facing policy**; the policy must be understandable to non-developers. Do not falsely claim "we never collect/share/store" information based on assumption.
3. Treat sensitive information and data about children, payments, or regulated domains as triggers for additional professional/legal review. Do not claim legal compliance merely because a policy file exists.
4. If the application handles user data, verify that its published privacy notice is accessible from the user-facing app where appropriate, and that documented deletion/contact processes are real. If the notice needs legal approval, label it DRAFT and block publication until approved.
5. Record privacy-impacting product changes in relevant PRs and update the notice **before** release when user-facing disclosures must change.

### Security disclosure and incident response requirements

1. Do not publish a `SECURITY.md` that lists a nonfunctional security inbox or guarantees a response SLA the maintainer cannot meet. Recommend GitHub private vulnerability reporting when available and configured; otherwise require the owner to specify a secure contact.
2. Exclude vulnerability exploit details, raw production data, passwords, access tokens, and PII from public issues, PRs, test fixtures, changelogs, and screenshots.
3. For a security incident, preserve relevant evidence, contain the issue using approved procedures, rotate compromised credentials where authorized, assess scope and exposure, and notify the owner promptly. Consult applicable legal/notification requirements with qualified advisors; do not promise compliance without evidence.

### Ongoing documentation checks

- Update the `README.md` and `CONTRIBUTING.md` whenever setup commands, tooling, branch policies, or required tests change. Verify examples on the **current** code, or mark unverified steps.
- Update the architecture docs and ADRs when system boundaries or major technical decisions change; link relevant PRs.
- Review `SECURITY.md` and privacy notice when dependencies, authentication, authorization, vendors, telemetry, retention, or data flows change.
- Before each release, check all public docs for broken links, out-of-date version/support claims, unapproved placeholders, **CI badges and coverage links that report the correct branch and workflow**, and mismatches with application behavior.
- **Never mark documentation or policy setup COMPLETE just because files exist.** Report which files were created/updated, which contents were validated, and which require owner or legal approval.


## 17. README badges and automated release pipeline

### README status requirements

- Place badges immediately below the README title, pointing to real, active sources. At minimum show **CI: dev** and **CI: main** once the named workflow has run. Example URL shape for a GitHub Actions workflow at `.github/workflows/ci.yml`:

  ```markdown
  [![CI · dev](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/OWNER/REPO/actions/workflows/ci.yml?query=branch%3Adev)
  [![CI · main](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/OWNER/REPO/actions/workflows/ci.yml?query=branch%3Amain)
  ```

- Substitute the **actual** repository owner, repo, branch names, and workflow file after connecting GitHub; verify each badge opens the correct workflow history. Do not display unresolved placeholders as active badges. Private-repo badge visibility may be restricted.
- Coverage badges require a real coverage publisher and accurately reflect a specified branch and actual results. A saved coverage artifact does not automatically provide a public dynamic badge; configure a provider if one is wanted.
- A deployment badge must link to a genuine deployment-status provider. A badge that says only `deployed` or `passing` without an authoritative dynamic source is prohibited. Otherwise show an ordinary link to the deployment dashboard, or a clearly labeled environment link, not a fabricated status badge.
- Never modify test criteria, publish misleading static status shields, or hard-code coverage percentages just to improve the README's appearance.

### CI/CD implementation requirements

1. **Audit what exists.** Identify actual package manager, lockfile, runtime version, scripts, test tooling, services and environments. Use existing automation where suitable; do not add duplicate competing deployment triggers.
2. **Create an actionable CI pipeline.** Require failing commands to produce a failing check, run tests in safe ephemeral/staging environments, and store actionable test/coverage evidence. Configure workflow concurrency, least-privilege permissions, reproducible dependency installs, and controlled third-party actions.
3. **Enforce it in GitHub.** Configure required checks on `dev` and `main` through repository rulesets/protection. Specify exact job names; a YAML file in the repo alone cannot enforce this. A GitHub administrator may need to enable branch rules, deployment checks, and protected environments.
4. **Choose the deployment platform deliberately.** Evaluate the repository's requirements and owner constraints; record the chosen host, deploy controller, build artifact, environments, promotion strategy, and rollback mechanism in an architecture decision. Use **one** deployment owner; do not install conflicting Git integration and CI-driven deployment triggers. Use least-privilege secrets and protected environments as supported. For libraries/CLI-only projects, substitute artifact publishing and package-release verification as appropriate.
5. **Release with approval.** A release PR from `dev` to `main` must include tests, coverage, changelog, staging verification (where applicable), migrations, rollback plan, and owner review. If merging automatically publishes or deploys, disclose that outcome and obtain approval beforehand. Where stronger gating is needed, configure real environment approvals or controlled promotion for the chosen tool/provider.
6. **Validate reality, not intention.** Execute the CI workflow on the actual repository and observe results for the exact commit. When a deployment is part of the release, confirm the selected provider's deployment event/status, deployed commit/artifact, target environment, and safe post-deployment smoke tests. If permissions/integrations are missing, status is `NOT CONFIGURED`, `NOT RUN`, or `UNVERIFIED`, not complete.
7. **Maintain documentation.** Update README badges, deployment docs, GitHub required check names, and instructions whenever the workflow filename, script names, deployment branch mapping or release mechanism changes.

### Required audit report at kickoff and release

| Gate | Required observation |
| --- | --- |
| CI definition | Real CI file in active location, adapted to the repository's actual scripts and tests |
| CI execution | Actual GitHub Actions run for the current commit, with recorded results |
| Protected branches | Ruleset/branch protection verified for `dev` and `main`, or clearly marked needs admin setup |
| README badges | Each visible badge loads a real status for the correct workflow and branch |
| Preview/staging | Available preview/staging environments mapped and verified; if unavailable or not applicable, explain alternative validation |
| Production | Actual provider/environment mapping for `main`, release approvals, and promotion behavior verified (when deployment applies) |
| Release confirmation | Production deployment status, commit, real smoke tests, monitoring and rollback recorded |


---

## Project-specific context (ShiftView)

These extend the rules above for this repository. Where they are stricter, they win.

### Product and stack

- ShiftView is a multi-tenant scheduling, time clock and live-coverage PWA for retail and fulfillment teams (managers and hourly employees). Live at https://shiftview.app.
- Next.js 16 (App Router) + React 19 + TypeScript (strict), Tailwind CSS v4, Supabase (Postgres, Auth, Realtime), Web Push, Resend, Cloudflare Turnstile, Slack incoming webhook for operator alerts. Node.js 22, npm with a committed `package-lock.json`.
- Architecture, trust boundaries and data flow: `docs/architecture.md`, `docs/MULTI_TENANCY.md`. Test strategy and coverage baseline: `docs/testing.md`. CI/CD and releases: `docs/ci-cd.md`.

### Commands

| Purpose | Command |
| --- | --- |
| Install | `npm ci` |
| Lint / typecheck | `npm run lint` / `npm run typecheck` |
| Unit + route-handler tests (Vitest) | `npm test` |
| Coverage (with enforced floor) | `npm run test:coverage` |
| Security unit tests (`*.security.test.ts`) | `npm run test:security` |
| Database integration tests (real Postgres, RLS, RPCs) | `npm run test:sql` (needs `PGHOST`, `PGUSER`, `PGPASSWORD`) |
| E2E (Playwright, APIs mocked, no backend) | `npm run build && npm run test:e2e` |
| Production build | `npm run build` |

There is no separate formatter; ESLint is the style gate. Do not mass-reformat files.

### Git and PR conventions

- Branch from `origin/dev` with a prefix from Section 3 (`feat/`, `fix/`, `chore/`, ...). PRs target `dev`, never `main`.
- Every feature or fix has a GitHub issue, and the PR body says `Closes #N`. `.github/workflows/close-linked-issues.yml` closes it when the PR merges into `dev`.
- Commits are authored as `Samuel Burke <32547172+samuel-burke@users.noreply.github.com>`. Do not add AI co-author trailers. Never rewrite already-pushed commits.
- The standing release PR from `dev` to `main` is the only PR allowed into `main`. When a PR merges into `dev`, add a line for it to the release PR body and to `CHANGELOG.md` under `Unreleased`, and add any new migration to the release PR's "Before release" list.
- Ask the owner before pushing, opening a PR, merging, or deploying unless they asked for that step.

### Security boundaries that every change must keep

- Every tenant row carries `org_id`. Route handlers get the organization only from `getOrgContext()` / `requireManager()` and scope every query by it. RLS enforces the same boundary a second time, so changes to tables, policies or RPCs need a SQL test in `supabase/manual-tests/` proving tenant A cannot read or write tenant B.
- The service-role client bypasses RLS: use it only after the route has checked the caller, and never in browser code. Never prefix a secret with `NEXT_PUBLIC_`.
- `E2E_BYPASS_AUTH=1` is honored only outside Vercel (`lib/e2e-bypass.ts`) and fails a production build (`lib/production-env.ts`). Do not widen it.
- Punches: geofence and coordinate validation (`lib/geo-validation.ts`) and punch ownership are security checks, not UX. Keep their negative tests.
- Name new security regression tests `*.security.test.ts` (Vitest) or add a `*.test.sql` file in `supabase/manual-tests/`; CI runs both in the `security` job.

### Database and production

- Production Supabase is read-only for agents. Never run writes, migrations or destructive SQL against production without the owner's explicit approval for that specific action.
- Migrations live in `supabase/migrations/` and are applied manually in order; production keeps no migration history. A migration whose header says **DEPLOY THE APP FIRST** must wait until its app code is live. Every migration after `0037` must be included by `supabase/manual-tests/baseline.test.sql` (`npm run test:sql` fails otherwise).
- Check schema drift with `supabase/schema-fingerprint.sql` (read-only).

### Environments

- Hosting is Vercel with its Git integration as the single deploy mechanism (see `docs/ci-cd.md` and `docs/adr/0001-deployment-platform.md`). Do not add a second deploy trigger (for example a GitHub Actions deploy job).
- Do not point tests, previews or local runs at production data.

### Ownership

- Owner and sole reviewer: `samuel-burke` on GitHub. Security reports follow `SECURITY.md`.
