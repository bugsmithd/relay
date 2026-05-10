---
name: code-review
description: Relay-local code review skill. Use for comprehensive review of Claude changes, Day stop-condition claims, trust-boundary edits, and PR-like diffs.
allowed-tools: Read, Grep, Glob, Bash
---

# Code Review — Relay local

Review contract:
- Default to read-only unless the user explicitly asks for fixes.
- Review against `CLAUDE.md`, the authoritative planning doc, Day scope, security invariants, and evidence artifacts.
- Do not accept summary claims without checking files or command artifacts.
- For trust-boundary paths, require stronger evidence.
- Prefer concrete blockers over generic style advice.

Severity:
- `BLOCK`: stop-condition false, security invariant broken, evidence invalid/stale, test false-pass, or Day boundary violation.
- `WARN`: real risk but not a Day blocker.
- `NIT`: cosmetic or maintainability-only.

Output format:
- Verdict: `PASS`, `PASS+WARN`, or `BLOCK`.
- Findings by severity with `file:line` evidence.
- What was verified.
- What remains unverified.
