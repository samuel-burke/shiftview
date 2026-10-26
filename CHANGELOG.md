# Changelog

User-visible changes to ShiftView. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

ShiftView has no tagged releases yet. Production runs whatever is on `main`, and each release is a pull request from `dev` into `main`. Until the first tagged release, the open release PR ([#195](https://github.com/samuel-burke/shiftview/pull/195)) carries the full list of changes merged into `dev` since the last release. When it is prepared for merge, its list moves into a versioned section here.

## [Unreleased]

### Added

- Engineering and Git workflow policy (`AGENTS.md`), contributor guide, PR and issue templates, architecture, testing and CI/CD docs.
- CI: unit-test coverage with a floor at the current baseline, a production dependency audit, and a branch-flow check for pull requests into `dev` and `main`.
- `.env.example` listing every environment variable by name.
- Dependabot configuration for npm and GitHub Actions updates, targeting `dev`.
