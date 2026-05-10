# Slack-Like Delivery Plan — Week-1 Grounded

Created: 2026-05-09T21:30:00Z
Status: stripped execution artifact, derived from v10 hardened plan
Source: v10 hardened, cut to a realistic ~28-hour week-1 floor
Authoritative: this file. v7-v10 are background. Run from this.

## Scope Discipline

This plan ships the trust-boundary substrate plus the gates that catch regressions on it. It is **not** a security textbook.

Once Day 2B gates land (`run-claude-review.mjs`, `check-evidence.mjs`, `recheck-precommit.sh`, `check-workflow-hardening.mjs`, `governance-check`), every subsequent change is reviewed at the implementation layer — not the plan layer. Stop pre-flighting. Execute.

Items deferred from v10 to week-2/follow-up:

- Email enumeration test (manual probe Day 5).
- Automated branch protection script (set manually in GitHub UI Day 5).
- `profiles` table + email-leak test (no roster surface week 1).
- `SECURITY DEFINER` Semgrep ban (manual migration review week 1).
- Multi-tab signOut delivery test (covered indirectly by JWT-revocation test).
- `redact-evidence.mjs` (manual scrub Day 5).
- `check-migration-history.mjs` (git-log discipline week 1).
- `check-postinstall-allowlist.mjs` (`.npmrc` setting alone suffices).
- `dynamic-route-opt-out.yml` Semgrep (route-level opt-out is in middleware + per-route export).
- Dependabot/Renovate policy.
- `pnpm overrides` / `patches/` hash check.

Cheap one-line defenses retained: `.npmrc enable-pre-post-scripts=false`, `__Host-` / `__Secure-` cookie prefix, `revoke all on public.<table> from anon` per table.

## Week-One Product Scope

Build:

- Supabase Auth via email magic link with cookie-based session.
- Workspace shell at `/w/[workspaceSlug]`.
- Channel list scoped to channel membership.
- Persisted channel messages.
- Supabase Realtime Postgres Changes for INSERT delivery.
- Optimistic send with client nonce reconciliation.
- RLS for `workspaces`, `workspace_members`, `channels`, `channel_members`, `messages`.
- Server guard layer (`with-session`, `with-workspace-guard`, `with-channel-guard`).
- Access matrix tests + realtime non-delivery proof.

Cut explicitly week one:

- DMs, threads, reactions, uploads, notifications, presence, typing.
- Storage / file uploads.
- Realtime Broadcast.
- Search of any kind.
- AI recap.
- Message DELETE.
- Account deletion, data export, MFA, step-up auth.
- Member roster endpoint with email exposure.

## Locked Invariants (per subsystem)

### Auth

- Cookie-based session via `@supabase/ssr`. No JWT in `localStorage`.
- Cookie attrs: `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` or `__Secure-` prefix.
- Magic-link callback allowlists `redirect_to` to `^/w/[a-z0-9-]+/?$` and `/`.
- Logout: server-side `signOut` plus cookie clear.
- Server Actions enforce origin check.

### Data Model

- RLS enabled on every public table.
- `workspaces.slug` is `citext` unique (or normalized lowercase with check).
- `messages` migration sets `replica identity default`.
- Migrations forward-only (git-log discipline; no automated check this week).
- `revoke all on public.<table> from anon` for every public table (belt + suspenders behind RLS).
- No `SECURITY DEFINER` functions in app schemas (manual review on every migration).

### RLS Policies

- `workspaces` SELECT: `exists (select 1 from workspace_members wm where wm.workspace_id = workspaces.id and wm.user_id = auth.uid())`. No INSERT/UPDATE/DELETE policies.
- `workspace_members` SELECT: `user_id = auth.uid()`. No INSERT/UPDATE/DELETE policies.
- `channels` SELECT (private): joins `channel_members`. No client INSERT/UPDATE/DELETE.
- `channel_members` SELECT: `user_id = auth.uid()`. No client INSERT/UPDATE/DELETE.
- `messages` SELECT: joins `channel_members`. INSERT: `user_id = auth.uid()` + channel membership. No UPDATE/DELETE policies.

### Service Role

- `lib/supabase/admin.ts` is the only file that reads `SUPABASE_SERVICE_ROLE`.
- File starts with `import "server-only"`.
- Client components never import `admin.ts`.
- Bundle leak check scans `.next/static`.
- `no-service-role-in-jsx.yml` Semgrep covers SSR HTML payload.
- `no-raw-pg-client.yml` bans `pg` outside `admin.ts`.

### Realtime

- Subscribe events: `INSERT` only. Filter: `channel_id` only. No wildcards, no DELETE, no missing-filter.
- Realtime Broadcast banned week one.
- Subscribers receive events only for rows their JWT can SELECT (RLS-gated).
- Sign-out / JWT refresh tears down subscriptions.

### Evidence

- `evidence/manifest.schema.json`: AJV strict, Draft 2020-12, `additionalProperties: false`, `schema_version` integer, `artifact_paths` `minItems: 1`, SHA256 per entry, `git_sha`, commands array.
- `scripts/check-evidence.mjs`: AJV pass + `manifest.git_sha === git rev-parse HEAD` + working tree clean for closeout + SHA256 match per artifact + paired Claude transcript + citation substring resolution + trust-boundary `BLOCK` verdict fails.
- `evidence/trust-boundary-paths.json` validated by `evidence/trust-boundary-paths.schema.json`.

### Supply Chain

- `tools.lock.json`: binary versions (semgrep, pnpm, node), npm versions (next, supabase-js, ssr, ajv, ajv-formats, typescript), `lockfile_sha256` of `pnpm-lock.yaml`.
- CI runs `pnpm install --frozen-lockfile`.
- `.npmrc` sets `enable-pre-post-scripts=false`.
- `make tools-version-check` enforces all of the above.

### CI Posture

- `make governance-check` re-runs every pre-commit check server-side via `scripts/recheck-precommit.sh`.
- `scripts/check-workflow-hardening.mjs` asserts no unsafe `pull_request_target` checking out fork head with secrets, asserts SHA-pinned actions, asserts minimal `permissions`.
- Branch protection on `main` set manually in GitHub UI Day 5 (PR review required, status checks required, no direct push, signed commits).

## Day 1A — Auth Substrate + RLS Proofs (~6h)

### Must Ship

1. Next.js + Supabase project; `pnpm install --frozen-lockfile` works.
2. `.npmrc` with `enable-pre-post-scripts=false`.
3. `lib/supabase/{client,server,admin}.ts` with cookie-based session via `@supabase/ssr`. `admin.ts` starts with `import "server-only"`.
4. Migration `001_workspace_identity.sql`:
   - `workspaces` (slug `citext` unique), `workspace_members`.
   - RLS enabled on both.
   - SELECT policies per spec.
   - `revoke all on public.workspaces from anon`; same for `workspace_members`.
5. Magic-link auth: `app/login/page.tsx`, `app/auth/callback/route.ts` with `redirect_to` allowlist; cookie `__Host-` or `__Secure-` prefix.
6. `lib/auth/with-session.ts`, `lib/auth/with-workspace-guard.ts`.
7. `scripts/seed.ts` with project-ref guard + JWT-claim guard; accepts `--run-id`; prefixes slugs `test-run-<id>-`.
8. `scripts/seed-cleanup.mjs` with same guards; deletes test-domain users + prefix-matched workspaces.
9. Workspace shell at `/w/[workspaceSlug]` uses `with-workspace-guard.ts`.
10. `middleware.ts` redirects unauthenticated `/w/*` to `/login`.
11. `CLAUDE.md` with core invariants and named guard layer.
12. `Makefile` with `repo-law`, `fast-check`, `tools-version-check`.
13. `tools.lock.json` (binary versions, npm versions, lockfile sha256).
14. `semgrep/repo-law/service-role-boundary.yml` plus positive/negative fixtures.
15. `scripts/check-bundle-leak.mjs`.
16. `scripts/test-bundle-leak-fixture.mjs` with `^(leak-test-|synthetic-)` prefix gate and `finally` cleanup.
17. `scripts/prove-precommit-service-role-rejection.sh`.
18. `.gitignore` covers `.supabase-local/seed-credentials.json` and evidence subpaths.
19. `evidence/manifest.schema.json`.
20. `evidence/trust-boundary-paths.json`.
21. `evidence/trust-boundary-paths.schema.json`.
22. `tests/auth/workspace-guard.spec.ts`.
23. `tests/auth/magic-link-redirect-allowlist.spec.ts` (external, protocol-relative, internal-non-allowlist all rejected).
24. `tests/auth/no-token-in-localstorage.spec.ts` (no JWT-shaped value `^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` in `localStorage` after login).
25. `tests/auth/cookie-prefix.spec.ts` (session cookie name starts with `__Host-` or `__Secure-`).
26. `tests/rls/workspace-select-membership.spec.ts` (member, non-member, anon all behave correctly).
27. `tests/rls/workspace-write-denial.spec.ts` (three actors: anon, non-member JWT, cross-workspace-member JWT — all denied INSERT/UPDATE/DELETE on both tables).
28. `tests/rls/migration-rls-enabled.spec.ts`.
29. Day 1A evidence manifest with SHA256 per artifact.

### Day 1A Stop Condition

All must pass in one recorded sitting:

1. `make fast-check` exits 0.
2. `make repo-law` exits 0 (fixtures + repo).
3. `make tools-version-check` exits 0 (binary, npm, lockfile sha256).
4. `pnpm install --frozen-lockfile` exits 0.
5. Staged service-role violation outside `lib/supabase/admin.ts` rejected by pre-commit.
6. `pnpm build` exits 0.
7. `SUPABASE_SERVICE_ROLE=leak-test-key node scripts/check-bundle-leak.mjs` exits 0.
8. `env -u SUPABASE_SERVICE_ROLE node scripts/check-bundle-leak.mjs` exits 2.
9. `SUPABASE_SERVICE_ROLE=leak-test-key node scripts/test-bundle-leak-fixture.mjs` exits 0; cleanup verified.
10. `SUPABASE_SERVICE_ROLE=eyJ.fake.production node scripts/test-bundle-leak-fixture.mjs` exits 2 ("real-shape value rejected").
11. `sh scripts/prove-precommit-service-role-rejection.sh` exits 0.
12. `SUPABASE_PROJECT_REF=prod-xyz pnpm tsx scripts/seed.ts` exits 1.
13. `SUPABASE_PROJECT_REF=prod-xyz pnpm tsx scripts/seed-cleanup.mjs` exits 1.
14. `git check-ignore .supabase-local/seed-credentials.json` exits 0.
15. AJV validates `trust-boundary-paths.json` and `manifest.json`.
16. All Day 1A test files listed above exit 0.
17. Signed-out `/w/<seeded-slug>` redirects to `/login`.
18. Signed-in seeded member sees workspace name, email, logout.
19. Signed-in non-member requesting `/w/<other-slug>` gets 403/redirect.
20. Manifest `git_sha` matches `git rev-parse HEAD`; SHA256 matches bytes.

## Day 1B — XSS / Cache / Headers (~3h)

### Must Ship

1. `semgrep/repo-law/dangerous-html.yml` plus positive/negative fixtures.
2. Pre-commit regex hook bans `dangerouslySetInnerHTML` literal in `.tsx`/`.ts`.
3. `middleware.ts` extends to set:
   - `Cache-Control: no-store, private` for `/w/*` and `/api/*`.
   - `Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'`.
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
   - `Referrer-Policy: strict-origin-when-cross-origin`.
   - `X-Content-Type-Options: nosniff`.
   - `X-Frame-Options: DENY`.
4. `app/w/[workspaceSlug]/page.tsx` declares `export const dynamic = 'force-dynamic'` and `export const revalidate = 0`.
5. `tests/auth/cache-control.spec.ts` (run against `pnpm build && pnpm start`, not `pnpm dev`).
6. `tests/security/headers.spec.ts` (run against prod build).
7. Day 1B evidence: `cache-control-headers.txt`, `security-headers.txt`, `dangerous-html-precommit-rejected.txt`.

### Day 1B Stop Condition

1. `make repo-law` exits 0 (now includes `dangerous-html.yml`).
2. Pre-commit on a `.tsx` file containing `dangerouslySetInnerHTML` → rejected.
3. After `pnpm build && pnpm start`, curl/`fetch` to `/w/<seeded-slug>` returns `Cache-Control: no-store, private` and all six security headers.
4. After `pnpm build && pnpm start`, curl/`fetch` to `/api/*` returns same headers.
5. `tests/auth/cache-control.spec.ts` and `tests/security/headers.spec.ts` exit 0.
6. Day 1B manifest covers Day 1B artifacts; SHA256 verified.

Do not start Day 2 until Day 1A and Day 1B both green.

## Day 2 — Channels / Messages / Gates (~9h)

### Day 2A — Trust Boundary / Data Path

Build:

- Migration: `channels`, `channel_members`, `messages` with RLS per spec; `messages` `replica identity default`; `revoke all from anon` per table.
- `lib/auth/with-channel-guard.ts`.
- Message create/read paths.
- Server Action origin enforcement.
- `docs/api-contract.md` generated from `tests/api/route-contract.spec.ts`.
- ADRs: `auth.md`, `server-guard-layer.md`, `realtime-test-lane.md`, `migrations.md`.
- `tests/api/route-contract.spec.ts`.
- `tests/auth/magic-link-replay.spec.ts` (use token twice → second use fails).
- `tests/auth/server-action-csrf.spec.ts` (cross-origin POST → 403).
- `tests/rls/all-tables-have-rls.spec.ts`.
- `tests/rls/policy-shape.spec.ts` (asserts `messages` SELECT policy expression references `auth.uid()` and joins `channel_members`; `channels` private SELECT joins `channel_members`).
- `tests/rls/channel-list-membership.spec.ts` (workspace member outside private channel sees zero rows).
- `tests/auth/guard-failure-modes.spec.ts` (denied guards return 403, never 500).
- `tests/util/run-isolation.spec.ts` (run-id-prefixed test data does not bleed across runs).
- `semgrep/repo-law/unguarded-route-query.yml` plus four enumerated fixture patterns:
  1. Route Handler in `app/api/**` calling `supabase.from('messages')` without preceding guard.
  2. Server Action mutating `messages` without guard.
  3. Route Handler reading by user-supplied workspace id without guard.
  4. Catch-all route `app/api/[...slug]/route.ts` touching workspace/channel/message data without guard.
- `semgrep/repo-law/no-service-role-in-jsx.yml` plus fixtures.
- `semgrep/repo-law/no-raw-pg-client.yml` plus fixtures.
- `semgrep/repo-law/fake-auth-bypass.yml`.
- `semgrep/repo-law/admin-client-boundary.yml`.

### Day 2B — Harness / Tooling

Build:

- CI governance workflow skeleton.
- `.claude/agents/authz-reviewer.md`.
- `.claude/skills/vertical-slice/SKILL.md`, `.claude/skills/authz-proof/SKILL.md`.
- `scripts/check-evidence.mjs` (consumes `evidence/trust-boundary-paths.json`; verifies `git_sha` and clean tree; verifies SHA256; verifies paired Claude transcript; fails on `BLOCK` verdict for trust-boundary paths).
- `scripts/run-claude-review.mjs` (records `claude --version` preflight; runs `claude -p --output-format stream-json --verbose`; writes paired `.json` + `.jsonl` atomically; verifies citation substring against repo content).
- `scripts/check-workflow-hardening.mjs` (asserts no unsafe `pull_request_target` checkout-of-fork-head, SHA-pinned actions, minimal `permissions`; fork-PR target check via fixture).
- `scripts/recheck-precommit.sh` (re-runs every pre-commit check server-side).
- `.claude/settings.json` PreToolUse protected-file hook reading `evidence/trust-boundary-paths.json`.
- `evidence/fixtures/block-verdict-trust-boundary/` with:
  - `claude-authz-review.json` (verdict `BLOCK`, citing trust-boundary path).
  - `claude-authz-review-transcript.jsonl` (non-empty).
  - `manifest.json`.
  - `target-file.ts` (cited file content).
- `.github/workflows/_fixtures/unsafe-pr-target.yml.fixture`.

### Day 2 Stop Condition

- All Day 2A tests green.
- `make governance-check` exits 0 with all blocking targets real (lint, typecheck, tests, repo-law, workflow-hardening, recheck-precommit, tools-version-check, evidence-check, bundle-leak).
- Fixture trust-boundary PR triggers `check-evidence.mjs` to require paired Claude review; absence exits non-zero.
- `evidence/fixtures/block-verdict-trust-boundary/` makes `check-evidence.mjs` exit non-zero.
- `git_sha` mismatch fixture makes `check-evidence.mjs` exit non-zero.
- Unsafe `pull_request_target` fixture makes `check-workflow-hardening.mjs` exit non-zero.
- `git commit --no-verify` of a service-role violation, then `make governance-check` → exits non-zero.
- ADRs `auth.md`, `server-guard-layer.md`, `realtime-test-lane.md`, `migrations.md` exist.

## Day 3 — Realtime (~5h)

Pre-condition: `docs/decisions/realtime-test-lane.md` and `docs/decisions/migrations.md` exist.

Build:

- Supabase Realtime Postgres Changes for INSERT delivery.
- Optimistic nonce reconciliation.
- Auth state-change listener: tear down all subscriptions on `SIGNED_OUT` and `TOKEN_REFRESHED`.
- `scripts/generate-access-matrix.mjs`.
- `docs/decisions/realtime.md`.
- `tests/realtime/publication-and-rls.spec.ts`:
  - Enumerates every table in `supabase_realtime` publication.
  - Asserts RLS-enabled per table.
  - Asserts `messages` SELECT policy expression references `auth.uid()` and joins `channel_members`.
  - Drift check: fails if a new public table joins the publication without explicit listing.
- `tests/realtime/unauthorized-non-delivery.spec.ts`:
  - Actor matrix A/B (members), C (non-member).
  - A sends; B receives one INSERT in 2s.
  - C receives zero INSERT in 5s.
  - C raw INSERT-only subscription on `messages` outside app code returns zero protected events.
- `tests/realtime/jwt-revocation-stops-delivery.spec.ts`:
  - Mechanism: admin removes user from `channel_members` via service-role path.
  - Within 5 seconds, subsequent INSERT events deliver zero rows to the revoked user.
  - On next subscription cycle (after JWT refresh or explicit resubscribe), zero historical/new events deliver.
- `tests/realtime/no-broadcast-usage.spec.ts` (greps app source for `.send({ type: 'broadcast' })` and `event: 'broadcast'`; asserts none).
- `semgrep/repo-law/realtime-message-subscription-boundary.yml` plus fixtures.
- `semgrep/repo-law/realtime-no-broadcast.yml` plus fixtures.

### Day 3 Acceptance

- All Day 3 tests green.
- Member receives INSERT within 2s.
- Non-member receives zero INSERT in 5s.
- Raw INSERT-only subscription by non-member returns zero.
- App code has no wildcard, DELETE, missing-`channel_id`, or Broadcast usage.
- JWT-revocation: revoked user receives zero events within 5s.
- Publication drift test fails on undocumented new-table membership.
- `docs/access-matrix.md` generated.

## Day 4 — Polish + ADRs (~3h)

Build:

- Empty/loading/error/deny states for the demo path.
- Screenshots: `empty-channel.png`, `loading-channel.png`, `error-state.png`, `deny-state.png` (deny chrome visually distinct from empty chrome).
- ADRs: `search-deferred.md`, `recap-deferred.md`.
- Manual evidence scrub: review `evidence/runs/*` for emails or message content; redact via local sed/script before publishing dossier.

### Day 4 Acceptance

- All four state screenshots captured per content schema.
- `search-deferred.md` and `recap-deferred.md` exist.
- Evidence scrub complete; no unintended PII in artifacts to be shared.

## Day 5 — Demo + Dossier (~2h)

Pre-condition: env-set checklist run.

Build:

- Final demo script.
- Final evidence dossier.
- Known deferrals list.
- Manual GitHub branch protection on `main`: PR review required, required status checks (`governance-check`), no direct push, signed commits.

### Day 5 Acceptance

- `make governance-check` exits 0.
- Final dossier with SHA256 per artifact and matching `git_sha`.
- Authz reviewer report paired with transcript; no `BLOCK` verdict on trust-boundary paths.
- Demo dry run completes without missing artifacts.
- Branch protection screenshot in evidence.

## Operator Runbook

### Auth

- **OR-Auth-1** Verify Supabase magic-link expiry default and single-use behavior at impl. Document in `docs/decisions/auth.md`.
- **OR-Auth-2** Verify Supabase service-role JWT project/issuer/ref claim name during seed implementation; do not hardcode `ref` without checking.
- **OR-Auth-3** Verify magic-link sender domain deliverability before demo. Configure custom SMTP with SPF/DKIM if demo audience uses corporate mail.
- **OR-Auth-4** Strip `code`/`token_hash` query params from app logs.
- **OR-Auth-5** Logout: server-side `signOut` plus cookie clear.

### DB

- **OR-DB-1** `messages` replica identity is `default`. Do not change to `full` without security review.
- **OR-DB-2** Migrations forward-only; do not modify previously-merged files. Use new migration to alter prior schema.
- **OR-DB-3** Manual migration review: scan every new migration for `SECURITY DEFINER`, `grant ... to anon`, broad `to public` grants. Reject before merge.

### CI

- **OR-CI-1** CI runs `pnpm install --frozen-lockfile`. Lockfile drift fails install.
- **OR-CI-2** Forked PRs do not run `make governance-check` against fork code with `SUPABASE_SERVICE_ROLE` exposed. Workflow uses `pull_request` (not `pull_request_target`) for fork PRs, or omits secrets.
- **OR-CI-3** Action references in `.github/workflows/*.yml` pinned by SHA, not tag.
- **OR-CI-4** Local pre-commit can be bypassed via `--no-verify`. CI re-runs every check via `recheck-precommit.sh`.
- **OR-CI-5** Day 5: set GitHub branch protection on `main` manually. Capture screenshot in evidence.

### Evidence

- **OR-Ev-1** `evidence/trust-boundary-paths.json` is itself a trust-boundary path. Glob changes need same review provenance.
- **OR-Ev-2** `evidence/runs/` may contain user emails or message content. Scrub before publishing dossier (manual Day 4).
- **OR-Ev-3** Manifest `git_sha` verified at evidence-check time. Working tree must be clean for closeout.
- **OR-Ev-4** Cross-machine seed credential handoff: do not transfer `seed-credentials.json` directly. Run `seed-cleanup.mjs` then re-seed; capture fresh creds.

### Demo

- **OR-Demo-1** Pre-demo env-set checklist:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE` (server-only)
  - `SUPABASE_PROJECT_REF` matches dev/test allowlist
  - SMTP configured if customized
  - Browser open in clean profile
- **OR-Demo-2** Magic-link mail fallback: if mail does not arrive within 30s, switch to seeded-password sign-in via `DEMO_PASSWORD_FALLBACK=1` env. Restricted to dev project. Disable env immediately after demo.
- **OR-Demo-3** Bundle-leak scanner reads `.next/static` only. Do not interpolate `SUPABASE_SERVICE_ROLE` into JSX or HTML responses (covered by `no-service-role-in-jsx.yml`).
- **OR-Demo-4** Verify `--verbose` requirement with `--output-format stream-json` in installed Claude Code build.

## Demo Shape

Show product:

1. Login (magic link).
2. Workspace shell.
3. Send persisted message.
4. Second authorized browser receives persisted INSERT.
5. Unauthorized browser receives zero protected INSERT.

Show proof if asked:

1. Access matrix.
2. Realtime unauthorized non-delivery test.
3. JWT revocation test.
4. Service-role Semgrep rule with fixtures.
5. Bundle leak check output (incl. pattern-rejection).
6. `--no-verify` bypass detection.
7. Fork-PR-target fixture rejection.
8. One authz-reviewer report plus transcript.
9. Branch protection screenshot.

Demo target: 10 min product, 5 min proof, 15 min total.

## Budget Summary

| Phase | Hours | Cumulative |
|---|---|---|
| Day 1A | ~6 | 6 |
| Day 1B | ~3 | 9 |
| Day 2A | ~5 | 14 |
| Day 2B | ~4 | 18 |
| Day 3 | ~5 | 23 |
| Day 4 | ~3 | 26 |
| Day 5 | ~2 | 28 |

Total: **~28 hours**. Realistic for one focused person across five days with debug margin.

If any day overruns, cut from this list (top first):

1. `scripts/recheck-precommit.sh` (defer to Day 3 if Day 2 slips; manual `--no-verify` discipline meanwhile).
2. `semgrep/repo-law/admin-client-boundary.yml` (overlap with `service-role-boundary`).
3. `semgrep/repo-law/fake-auth-bypass.yml` (overlap with Day 1A regex hook).
4. `tests/util/run-isolation.spec.ts` (test-pollution discipline manually).
5. `evidence/fixtures/block-verdict-trust-boundary/` (verify Day 3+).

Never cut from above the floor:

- Cookie-based session.
- Magic-link redirect allowlist test.
- Three-actor workspace-write-denial test.
- Migration RLS-enabled test.
- `service-role-boundary.yml` Semgrep + fixtures.
- Bundle-leak check + fixture w/ prefix gate.
- Seed safety with project-ref + JWT-claim guards.
- `with-channel-guard` + message paths Day 2.
- `unguarded-route-query.yml` with four fixtures.
- `no-service-role-in-jsx.yml`.
- `check-evidence.mjs` with `git_sha` match.
- `run-claude-review.mjs`.
- `check-workflow-hardening.mjs` with fork-PR safety.
- `tests/realtime/publication-and-rls.spec.ts` with drift.
- `tests/realtime/unauthorized-non-delivery.spec.ts`.
- `tests/realtime/jwt-revocation-stops-delivery.spec.ts`.

## Implementation References

- Supabase Realtime Postgres Changes: https://supabase.com/docs/guides/realtime/postgres-changes
- Supabase Realtime Authorization: https://supabase.com/docs/guides/realtime/authorization
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Auth (magic link / email OTP): https://supabase.com/docs/guides/auth/auth-email-passwordless
- Supabase SSR: https://supabase.com/docs/guides/auth/server-side-rendering
- Next.js caching: https://nextjs.org/docs/app/building-your-application/caching
- Next.js middleware: https://nextjs.org/docs/app/building-your-application/routing/middleware
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code MCP: https://docs.claude.com/en/docs/claude-code/mcp
- Semgrep pre-commit: https://semgrep.dev/docs/extensions/pre-commit
