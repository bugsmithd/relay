---
name: ai-slop-cleaner
description: Relay-local anti-slop cleanup/review workflow. Use when asked to deslop, remove AI slop, simplify generated code, or run an anti-slop pass while preserving behavior.
allowed-tools: Read, Grep, Glob, Bash, Edit, MultiEdit
---

# AI Slop Cleaner — Relay local

Goal: remove AI-generated slop without changing behavior or crossing the current Day boundary.

Use this for Relay cleanup/refactor/deslop requests.

Rules:
- Read `CLAUDE.md` and the current Day slice in `.planning/claude-code-slack-agent-gates-week1-grounded-20260509.md` first.
- Write a short cleanup plan before edits.
- Lock behavior first: run or add the narrowest regression proof available before changing code.
- Prefer deletion, reuse, and boundary repair over new abstractions.
- Do not add dependencies unless explicitly approved.
- Keep changes small and reversible.
- After edits, run the narrowest useful checks first, then the relevant closeout gate.
- Report changed files, simplifications, validation, and remaining risks.

Review-only variant:
- If the user asks to review Claude's work, do not edit. Return `PASS`, `WARN`, or `BLOCK` with file/line evidence.
