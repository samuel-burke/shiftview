# Security Policy

Thank you for helping keep ShiftView secure.

If you believe you have found a security vulnerability in ShiftView, please report it privately and responsibly. Please do not open a public GitHub issue for security reports.

## Supported versions

ShiftView is a hosted service with no released versions. Security fixes go to the current production deployment at https://shiftview.app (the `main` branch) through the normal release process, or through an emergency hotfix when needed. Older commits are not patched.

## Reporting a vulnerability

The preferred method is GitHub private vulnerability reporting.

If private reporting is not available or you are unable to use it, you may email:
- samuel_burke@me.com

When reporting, please include:
- a clear description of the vulnerability
- the affected component, route, or feature
- steps to reproduce the issue
- the impact or potential impact
- any proof-of-concept, exploit details, or screenshots if available
- the version, commit hash, or deployment environment if known

## Response timeline

We aim to:
- acknowledge receipt of a report within 5 business days
- provide an initial assessment within 10 business days
- work toward a fix and coordinate disclosure as quickly as possible

## Scope

We are interested in vulnerabilities affecting:
- authentication and authorization flaws
- broken access control
- server-side API route vulnerabilities
- issues in Supabase or database access logic
- injection flaws, unsafe input handling, or validation bypasses
- exposure of sensitive data
- privilege escalation or unsafe admin functionality
- session handling, secret management, or configuration weaknesses
- business logic flaws that could lead to unauthorized actions or data disclosure

## Out of scope

The following are generally not in scope unless they demonstrate a significant security impact:
- spam or nuisance issues
- missing security headers or best practices without a concrete exploit path
- self-XSS or UI issues without a practical impact
- reports that require social engineering or physical access
- vulnerabilities in third-party services or dependencies unless they directly affect ShiftView

## Disclosure policy

Please give us a reasonable opportunity to investigate and fix the issue before making it public. We support coordinated disclosure and will do our best to validate and remediate reported vulnerabilities promptly.

Thank you for helping protect ShiftView users, managers, and data.
