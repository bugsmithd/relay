# Day 1A — Auth Substrate + RLS

Source: `.planning/claude-code-slack-agent-gates-week1-grounded-20260509.md` §"Day 1A — Auth Substrate + RLS Proofs".

## Day 1A Must Ship

1. Next.js + Supabase project; `pnpm install --frozen-lockfile` works.
2. `.npmrc` with `enable-pre-post-scripts=false`.
3. `lib/supabase/{client,server,admin}.ts` cookie-based session via `@supabase/ssr`. `admin.ts` starts `import "server-only"`.
4. Migration `001_workspace_identity.sql`:
   - `workspaces` (slug `citext` unique), `workspace_members`.
   - RLS enabled on both.
   - SELECT policies per spec.
   - `revoke all on public.workspaces from anon`; same for `workspace_members`.
5. Magic-link auth: `app/login/page.tsx`, `app/auth/callback/route.ts` with `redirect_to` allowlist; cookie `__Host-`/`__Secure-` prefix.
6. `lib/auth/with-session.ts`, `lib/auth/with-workspace-guard.ts`.
7. `scripts/seed.ts` with project-ref guard + JWT-claim guard; `--run-id`; prefix `test-run-<id>-`.
8. `scripts/seed-cleanup.mjs` same guards; deletes test-domain users + prefix-matched workspaces.
9. Workspace shell `/w/[workspaceSlug]` uses `with-workspace-guard.ts`.
10. `middleware.ts` redirects unauthenticated `/w/*` to `/login`.
11. `CLAUDE.md` with core invariants + named guard layer.
12. `Makefile` with `repo-law`, `fast-check`, `tools-version-check`.
13. `tools.lock.json` (binary, npm, lockfile sha256).
14. `semgrep/repo-law/service-role-boundary.yml` + positive/negative fixtures.
15. `scripts/check-bundle-leak.mjs`.
16. `scripts/test-bundle-leak-fixture.mjs` with `^(leak-test-|synthetic-)` prefix gate + `finally` cleanup.
17. `scripts/prove-precommit-service-role-rejection.sh`.
18. `.gitignore` covers `.supabase-local/seed-credentials.json` + evidence subpaths.
19. `evidence/manifest.schema.json`.
20. `evidence/trust-boundary-paths.json`.
21. `evidence/trust-boundary-paths.schema.json`.
22. `tests/auth/workspace-guard.spec.ts` (DB-backed, runs via `node --conditions=react-server --test`).
23. `tests/auth/magic-link-redirect-allowlist.spec.ts` (pure logic, runs via `node --test`).
24. `tests/e2e/no-token-in-localstorage.spec.ts` (Playwright; covers plan's `tests/auth/no-token-in-localstorage`).
25. `tests/e2e/cookie-prefix.spec.ts` (Playwright; covers plan's `tests/auth/cookie-prefix`).
26. `tests/rls/workspace-select-membership.spec.ts` (DB-backed).
27. `tests/rls/workspace-write-denial.spec.ts` (anon, non-member JWT, cross-workspace-member JWT — DB-backed).
28. `tests/rls/migration-rls-enabled.spec.ts` (static SQL scan, runs via `node --test`).
29. `tests/e2e/workspace-shell.spec.ts` (Playwright; signed-out redirect + signed-in member + non-member 404, covers stop-conditions 17-19).
30. Day 1A evidence manifest with SHA256 per artifact.

Test-runner choices:
- Pure-logic + static-scan tests run via Node 24's built-in `node --test` (no runner pinned in plan; `node --test` is zero-dep, always available).
- DB-backed tests run via `node --conditions=react-server --test` against the local Supabase stack at `127.0.0.1:54321`.
- Browser/cookie/localStorage tests run via Playwright. The plan does not name a browser runner; Playwright is the canonical choice and is pinned in `package.json` devDeps.

E2E sign-in path: a dev-only POST handler at `app/dev/test-signin/route.ts` accepts `{email,password}` and signs in via `@supabase/ssr` server client. The route returns 404 unless `RELAY_E2E_BACKDOOR=1` is set. `playwright.config.ts` sets that env only inside the spawned Next server. The route file is committed; production deploys never set the env.

## Day 1A Stop Condition

All must pass in one recorded sitting:

1. `make fast-check` exits 0.
2. `make repo-law` exits 0 (fixtures + repo).
3. `make tools-version-check` exits 0.
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
16. All Day 1A test files exit 0.
17. Signed-out `/w/<seeded-slug>` redirects to `/login`.
18. Signed-in seeded member sees workspace name, email, logout.
19. Signed-in non-member requesting `/w/<other-slug>` gets 403/redirect.
20. Manifest `git_sha` matches `git rev-parse HEAD`; SHA256 matches bytes.

## Verification commands

```
make fast-check
make repo-law
make tools-version-check
pnpm install --frozen-lockfile
pnpm build
SUPABASE_SERVICE_ROLE=leak-test-x node scripts/check-bundle-leak.mjs
env -u SUPABASE_SERVICE_ROLE node scripts/check-bundle-leak.mjs
SUPABASE_SERVICE_ROLE=leak-test-x node scripts/test-bundle-leak-fixture.mjs leak
SUPABASE_SERVICE_ROLE=leak-test-x node scripts/test-bundle-leak-fixture.mjs unreadable
SUPABASE_SERVICE_ROLE=eyJ.fake.x node scripts/test-bundle-leak-fixture.mjs leak
sh scripts/prove-precommit-service-role-rejection.sh
node --conditions=react-server scripts/seed.ts          # plan's `pnpm tsx scripts/seed.ts`
node --conditions=react-server scripts/seed-cleanup.mjs # plan's `pnpm tsx scripts/seed-cleanup.mjs`
git check-ignore .supabase-local/seed-credentials.json
pnpm exec ajv validate --spec=draft2020 -s evidence/trust-boundary-paths.schema.json -d evidence/trust-boundary-paths.json
pnpm exec ajv validate --spec=draft2020 -s evidence/manifest.schema.json -d evidence/runs/<run-id>/manifest.json
node --test tests/auth/magic-link-redirect-allowlist.spec.ts tests/rls/migration-rls-enabled.spec.ts
node --conditions=react-server --test tests/rls/workspace-select-membership.spec.ts tests/rls/workspace-write-denial.spec.ts tests/auth/workspace-guard.spec.ts
pnpm exec playwright test
```

Why `--conditions=react-server`: `lib/supabase/admin.ts` starts with `import "server-only"` per plan §"Service Role". The `server-only` package throws at import time in any non-React-Server context (browser bundle OR plain Node CLI). The `react-server` condition resolves the package to its empty stub, so CLI scripts can evaluate `admin.ts` while the Next bundler protection on client components is unchanged.

## Evidence artifacts

Run dir: `evidence/runs/<run-id>/`.

- `manifest.json` (validated by `manifest.schema.json`).
- `pnpm-install-frozen.txt`.
- `pnpm-build.txt`.
- `make-fast-check.txt`.
- `make-repo-law.txt`.
- `make-tools-version-check.txt`.
- `bundle-leak-positive.txt` (exit 0 with `leak-test-` value).
- `bundle-leak-no-env.txt` (exit 2 with no env).
- `bundle-leak-fixture-positive.txt`.
- `bundle-leak-fixture-real-shape-rejected.txt`.
- `precommit-service-role-rejection.txt`.
- `seed-prod-ref-guard-rejected.txt`.
- `seed-cleanup-prod-ref-guard-rejected.txt`.
- `gitignore-seed-credentials.txt`.
- `ajv-trust-boundary-paths.txt`.
- `tests-day1a.txt` (per-file pass output).
- `e2e-signed-out-redirect.txt`.
- `e2e-signed-in-member.txt`.
- `e2e-non-member-403.txt`.

## Non-goals (Day 1A only)

- No Day 1B work: no XSS/cache/headers middleware, no `dangerously-set-inner-html` rule, no security-headers middleware extension, no `dynamic = 'force-dynamic'` route opt-out.
- No Day 2 work: no `channels`/`channel_members`/`messages` migration, no `with-channel-guard`, no message paths, no Server Action origin enforcement, no API contract docs, no ADRs (`auth.md`, `server-guard-layer.md`, `realtime-test-lane.md`, `migrations.md`).
- No Claude skills or agents: `.claude/agents/`, `.claude/skills/` land Day 2B.
- No realtime: no Postgres Changes subscription, no publication tests, no broadcast tests.
- No messages: no message persistence, optimistic send, nonce reconciliation.
- No search.
- No AI recap.
- No `check-evidence.mjs`, `run-claude-review.mjs`, `recheck-precommit.sh`, `check-workflow-hardening.mjs`, `governance-check` Makefile target — Day 2B.
