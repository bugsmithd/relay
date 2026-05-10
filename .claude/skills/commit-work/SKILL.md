---
name: commit-work
description: Relay-local commit workflow. Use when asked to stage, split, or commit Relay work using the required Lore commit protocol.
allowed-tools: Read, Grep, Glob, Bash
---

# Commit Work — Relay local

Use only when the user explicitly asks to commit/stage or the approved Claude task includes commits.

Rules:
- Inspect `git status`, `git diff`, and `git diff --cached` before committing.
- Stage only intended files.
- Do not push, rewrite history, or force-push without explicit approval.
- Every commit message must follow the Lore protocol in `CLAUDE.md`.
- If previous commits are non-Lore and the user forbids rewriting, do not rewrite; report it and add follow-up Lore commits only.
- Run the relevant narrow validation before commit when available.

Lore minimum:
- Intent line: why the change exists.
- Body: constraint/approach if useful.
- Trailers: `Confidence:`, `Scope-risk:`, `Tested:`, `Not-tested:` where applicable.
