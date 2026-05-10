# Relay Claude capabilities

Purpose: make the Claude-side review/implementation tool stack visible in the repo, not hidden in a user-global config.

## Project-local skills

Claude should prefer repo-local skills under `.claude/skills/` for Relay work:

- `$caveman` / `$caveman-review` / `$caveman-commit` — concise output, review, and commit help.
- `$analyze` — read-only repo analysis before changing anything.
- `$code-review` — Day-scope/spec/evidence code review.
- `$security-review` — security review using the Sentry security-review skill.
- `$sentry-security-basics` — Sentry security, PII, data scrubbing, and privacy-safe config checks.
- `$sentry-security-pii-protection` — alias for Sentry PII/security review wording.
- `$ai-slop-cleaner` — anti-slop cleanup/review after behavior is locked.
- `$commit-work` — Lore-format commit workflow.

## Project MCPs

Project MCP config is in `.mcp.json`. It intentionally contains no secrets.

Configured servers:

- `context7` — current framework/library docs.
- `github` — available from user/plugin Claude config when authenticated; not project-scoped here because the direct project HTTP endpoint failed without plugin auth.
- `atlassian` — Jira/Confluence context when authenticated.
- `supabase` — Supabase project/docs/admin context when authenticated.
- `sentry` — Sentry context when authenticated.
- `playwright` — browser/e2e automation.
- `chrome-devtools` — browser/runtime inspection.
- `next-devtools` — Next.js runtime/debug context.

Auth is user/session owned. If a server says `Needs authentication`, do not fake evidence; record the blocker or authenticate explicitly.

## Relay review gauntlet default

For Day closeout or Claude claim review, use separate lanes:

1. `$analyze` — compare claims to repo files and evidence artifacts.
2. `$code-review` — spec, Day-scope, maintainability, and false-pass review.
3. `$security-review` — trust-boundary, auth, RLS, cookie, secret, and logging review.
4. `$ai-slop-cleaner` — slop/dead-code/overengineering review after behavior is proven.
5. `context7` MCP — docs/latest-stable compliance for Next.js, Supabase, Playwright, AJV, and related APIs.
6. Relevant runtime MCPs — Playwright/Chrome/Next/Supabase/Sentry when the claim depends on runtime proof.

Stop condition: no `BLOCK` findings, evidence artifacts exist and match claims, and any remaining `WARN` items are explicitly documented with Day ownership.
