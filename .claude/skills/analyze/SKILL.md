---
name: analyze
description: Relay-local read-only repository analysis. Use for investigate/analyze/why/how questions that need grounded file evidence before changes.
allowed-tools: Read, Grep, Glob, Bash
---

# Analyze — Relay local

Read-only contract:
- Do not edit files.
- Do not invent repo state.
- Answer from actual files, current git state, and evidence artifacts.
- Separate evidence from inference.
- Rank findings by severity/confidence.
- Include concrete file paths and line numbers when possible.
- If the current Day matters, confirm it from `CLAUDE.md`, the planning doc, and evidence runs.

Output:
1. Verdict / answer.
2. Evidence.
3. Confidence.
4. Gaps or next discriminating read-only check.
