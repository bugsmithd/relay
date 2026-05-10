# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Relay — a one-week Slack-like vertical slice focused on the workspace/channel/message trust boundary.

## Authoritative plan

The only execution plan is:

`/Users/divyanshurathore/dev/personal/relay/.planning/claude-code-slack-agent-gates-week1-grounded-20260509.md`

Older plan revisions (v7–v10) are background review history. Do not read them unless the user explicitly asks.

## Mode: execution, not planning

We are executing the grounded plan. Do not propose v11/v12 revisions or new pre-flight reviews. New findings during execution are logged as Day-6+ follow-ups, not week-1 blockers. Cut order is in the plan; use it instead of inventing.

## Claude capabilities visible in repo

Repo-local Claude skills live under `.claude/skills/`; project MCPs live in `.mcp.json`.
This is intentional transparency: Relay review/implementation runs should not depend on hidden user-global capability assumptions.

Use these skills when they match the task:

- `$caveman`, `$caveman-review`, `$caveman-commit` for terse output/review/commit help.
- `$analyze` for read-only repo/evidence analysis.
- `$code-review` for Day-scope/spec/evidence review.
- `$security-review` for auth/RLS/cookie/secret/trust-boundary review.
- `$sentry-security-basics` or `$sentry-security-pii-protection` for Sentry PII/data-scrubbing/security checks.
- `$ai-slop-cleaner` for behavior-preserving anti-slop cleanup/review.
- `$commit-work` for Lore-format commit workflow.

Use `.mcp.json` servers when needed for current docs/runtime evidence: `context7`, `atlassian`, `supabase`, `sentry`, `playwright`, `chrome-devtools`, and `next-devtools`. Use GitHub from user/plugin scope when authenticated.
Do not fake MCP evidence; if an MCP needs authentication, record that blocker or authenticate explicitly.

## Repo state

Fresh app repo at `/Users/divyanshurathore/dev/personal/relay`. As of this cleanup: `CLAUDE.md`, `.planning/claude-code-slack-agent-gates-week1-grounded-20260509.md`, and `docs/decisions/backend.md` exist; `.omx/` runtime state and `.claude/settings.local.json` remain outside the repo. No `git init`, no `package.json`, no `Makefile`, no migrations, no tests. The first Day 1A action is project init.

## Phase awareness

Always confirm the current Day before acting. The plan splits into Day 1A → Day 1B → Day 2A → Day 2B → Day 3 → Day 4 → Day 5, gated. If the user has not stated the Day, ask. Do not pull artifacts forward from a later Day. Do not start Day 2 until Day 1A and Day 1B both have green stop conditions.

## Stack defaults

Locked for week 1 in `docs/decisions/backend.md` (bound until 2026-05-15). Do not switch stack mid-week without an explicit early-trigger from that file.

- Next.js (App Router).
- Supabase Auth (email magic link, cookie-based session via `@supabase/ssr`).
- Supabase Postgres with RLS.
- Supabase Realtime (Postgres Changes, INSERT-only with `channel_id` filter).
- pnpm with `--frozen-lockfile`; `.npmrc` sets `enable-pre-post-scripts=false`.

Open sub-decisions (hosting, Supabase tier, realtime test lane, SMTP) have their own bounds in `docs/decisions/backend.md`.

## Week-one cuts (out of scope)

No search, no AI recap, no DMs, no threads, no reactions, no uploads, no notifications, no presence, no typing, no storage/uploads, no message DELETE, no member roster endpoint exposing emails, no Realtime Broadcast, no account deletion, no MFA, no step-up auth.

## Security invariants

### Auth

- Cookie-based session via `@supabase/ssr`. **No JWT in `localStorage`.**
- Session cookie attrs: `HttpOnly`, `Secure`, `SameSite=Lax`, name prefixed `__Host-` or `__Secure-`.
- Magic-link callback validates `redirect_to` against allowlist `^/w/[a-z0-9-]+/?$` and `/`. External or protocol-relative URLs rejected.
- Logout = server-side `signOut` plus cookie clear. Not just cookie clear.
- Server Actions enforce `Origin`/`Host` match.
- Strip `code`/`token_hash` query params from any URL logging.

### Service role

- `SUPABASE_SERVICE_ROLE` is read **only** in `lib/supabase/admin.ts`, which starts with `import "server-only"`.
- Client components never import `admin.ts` directly or transitively.
- The bundle-leak scanner reads `.next/static` only. Do **not** interpolate `SUPABASE_SERVICE_ROLE` into JSX or HTML responses (covered separately by `no-service-role-in-jsx.yml`).

### Data model

- RLS enabled on every public table.
- Server guards (`with-session`, `with-workspace-guard`, `with-channel-guard`) wrap every workspace/channel/message data path. Workspace shell cannot ship without `with-workspace-guard`.
- `messages` SELECT policy joins `channel_members` (not `workspace_members`).
- `channels` private SELECT policy joins `channel_members`.
- INSERT policies verify `user_id = auth.uid()` plus channel membership.
- No client `INSERT`/`UPDATE`/`DELETE` policies in week one. All identity-table writes go through the server-only service-role path.
- `revoke all on public.<table> from anon` for every public table (defense behind RLS).
- No `SECURITY DEFINER` functions in app schemas without explicit trust-boundary review.
- Migrations are forward-only. Do not modify a previously-merged migration. Add a new migration to alter prior schema.
- Server-side DB access uses `supabase-js`, not raw `pg`, except inside `lib/supabase/admin.ts`.
- `messages` replica identity stays `default`. Do not change to `full` without security review.

### Realtime

- App subscriptions to `messages`: `event: "INSERT"` plus `channel_id` filter only. No wildcards, no DELETE, no missing-filter.
- Subscriptions use the signed-in user's JWT, never the service role.
- Realtime Broadcast is banned week one.
- Sign-out and JWT refresh tear down all subscriptions; re-subscribe under new auth context.

### XSS / cache / headers (Day 1B)

- `dangerouslySetInnerHTML` is banned repository-wide (Semgrep + pre-commit regex).
- Authenticated routes declare `export const dynamic = 'force-dynamic'` and `export const revalidate = 0`.
- Middleware sets `Cache-Control: no-store, private` for `/w/*` and `/api/*`.
- Middleware sets CSP, HSTS, Referrer-Policy, X-Content-Type-Options, X-Frame-Options.

## Trust-boundary paths

Edits to any of these are trust-boundary changes. Once `evidence/trust-boundary-paths.json` exists, that file is authoritative; until then, use this list:

- `lib/auth/**`
- `lib/supabase/admin.ts`
- `lib/recap/**`
- `lib/search/**`
- `supabase/migrations/**`
- `tests/auth/**`
- `tests/rls/**`
- `tests/realtime/**`
- `tests/security/**`
- `semgrep/repo-law/**`
- `.github/workflows/**`
- `middleware.ts`
- `evidence/manifest.schema.json`
- `evidence/trust-boundary-paths.json`
- `evidence/trust-boundary-paths.schema.json`

When editing these, expect a paired Claude review report + transcript (Day 2B+) and a non-`BLOCK` verdict for the change to pass `scripts/check-evidence.mjs`.

## Verification rule

No claim without a test or evidence artifact. Evidence lives under `evidence/runs/<run-id>/`.

Specifically:

- Do not fabricate manifest entries, SHA256 values, Claude transcripts, or citation lines.
- `manifest.git_sha` must equal `git rev-parse HEAD` at evidence-check time.
- Working tree must be clean for closeout evidence.
- Every `artifact_paths[]` entry must exist on disk and its SHA256 must match the recorded value.
- Local pre-commit can be bypassed via `git commit --no-verify`. Pre-commit pass is **not** ground truth. Ground truth is `make governance-check` (server-side re-runs every pre-commit check via `scripts/recheck-precommit.sh`).

## Commands

These commands are allowed only once they exist in the repo. Do not invoke them speculatively:

- `make fast-check`
- `make repo-law`
- `make tools-version-check`
- `make governance-check`
- `pnpm install --frozen-lockfile`
- `pnpm build`
- `pnpm tsx scripts/seed.ts`
- `pnpm tsx scripts/seed-cleanup.mjs`
- `node scripts/check-bundle-leak.mjs`
- `node scripts/test-bundle-leak-fixture.mjs`
- `sh scripts/prove-precommit-service-role-rejection.sh`
- `pnpm exec ajv validate ...`

No other build/lint/test runner is defined. Do not invent `pnpm test`, `vitest`, `jest`, `npm run *`, etc., before the corresponding script exists in `package.json`.

## Approval-required actions

Ask before running anything that touches external services, secrets, production data, or git history:

- `supabase db push`, `supabase db reset`, `supabase migration up` against any non-local project.
- `pnpm install` without `--frozen-lockfile`, `pnpm add`, `pnpm update`, dependency upgrades.
- `git push`, `git push --force`, `git rebase --interactive`, history rewrites.
- `gh repo create`, `gh pr merge`, branch protection changes.
- Any `vercel`, `netlify`, or other deploy command.
- Any command that reads `SUPABASE_SERVICE_ROLE` outside the test fixtures defined in the plan.

## Harness timing

Repo skills (`vertical-slice`, `authz-proof`) and the in-repo agent (`authz-reviewer`) land Day 2B, not Day 1A. Do not assume they exist before then.

The PreToolUse protected-file hook (`.claude/settings.json`) lands Day 2B and reads `evidence/trust-boundary-paths.json`. Until then, use the list above.

## Reviewer provenance

When asked to review code:

- Before Day 2B exists: do read-only inline review with concrete file paths and line numbers. Do not produce `claude-authz-review.json` files; that runner does not exist yet.
- Day 2B onward: reviews go through `scripts/run-claude-review.mjs`, which writes paired `evidence/runs/<run-id>/claude-authz-review.json` and `claude-authz-review-transcript.jsonl`. Hand-written review JSON is rejected by `scripts/check-evidence.mjs`.

## Cut discipline

If a Day overruns, use the cut order in the plan ("Cut order if scope slips"). Never cut from the floor list ("Never cut from above the floor"). Do not invent new cuts; do not silently defer floor items.
