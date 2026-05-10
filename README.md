# Relay

Relay is a workspace-first messaging foundation. The current product slice proves the trust boundary first: a signed-in user can enter only the workspaces they belong to, using Supabase Auth, Supabase Postgres RLS, and Next.js server-side guards.

## Status

Current shipped slice: **Day 1A auth + workspace-membership boundary**.

What works today:

- Email magic-link sign-in through Supabase Auth.
- Supabase session cookies via `@supabase/ssr`: `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` or `__Secure-` name prefix, no JWT in `localStorage`.
- A protected workspace shell at `/w/[workspaceSlug]`.
- Workspace membership enforced twice:
  - Next.js server guard: `withWorkspaceGuard`.
  - Supabase RLS policies on `workspaces` and `workspace_members`.
- Local seed data for member vs non-member access checks.
- Automated checks for redirect allowlists, RLS behavior, cookie shape, no JWT in `localStorage`, production backdoor blocking, and real magic-link login through local Mailpit.

Not shipped yet:

- Channels, channel membership UI, messages, or realtime message delivery.
- Search, AI recap, DMs, threads, reactions, uploads, notifications, presence, or typing indicators.
- Production deployment or a connected cloud Supabase project.

Local Supabase is enough for the current slice. No hosted Supabase account is required to run or test the local foundation.

## Quick start

Prerequisites:

- Node.js 24 or newer.
- pnpm, using the version pinned by `packageManager` in `package.json`.
- Docker running locally.
- Supabase CLI for the local Supabase stack.

Install dependencies and start local Supabase:

```sh
pnpm install --frozen-lockfile
supabase start
```

Create `.env.local` from the values printed by `supabase status`. Do not commit this file.

```sh
SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local anon key from supabase status>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same local anon key>
SUPABASE_SERVICE_ROLE=<local service-role key from supabase status>
SUPABASE_PROJECT_REF=<local project ref / issuer expected by the service-role JWT>
DEV_PROJECT_REF_ALLOWLIST=<same local project ref, or a comma-separated local allowlist>
SITE_ORIGIN=http://127.0.0.1:3000
```

For the default local Supabase stack, `SUPABASE_PROJECT_REF=supabase-demo` and `DEV_PROJECT_REF_ALLOWLIST=supabase-demo` work out of the box.

Run the app on the canonical host used by magic links:

```sh
pnpm dev:canonical
```

Open:

```text
http://127.0.0.1:3000
```

For a useful manual demo, seed a workspace first with `RUN_ID=demo-1; pnpm seed -- --run-id "$RUN_ID"`, then sign in through `/login?redirect_to=<member_workspace>`, where `<member_workspace>` is the full path printed by the seed, for example `/w/test-run-demo-1-alpha`. See [Seed data for local demos](#seed-data-for-local-demos) for details.

## Architecture at a glance

| Layer | Current role |
| --- | --- |
| Next.js App Router | Login form, auth callback, workspace shell, server actions, route handlers. |
| Supabase Auth | Email magic links and session exchange. |
| Supabase Postgres | `workspaces` and `workspace_members` identity tables. |
| Supabase RLS | Database-level membership boundary. |
| Mailpit | Local email inbox exposed by the Supabase local stack. |
| Playwright | Browser-level auth and workspace-boundary checks. |

Service-role access is intentionally narrow: app code reads `SUPABASE_SERVICE_ROLE` only through `lib/supabase/admin.ts`, and that path is for local seed/admin flows, not browser code.

## Local environment details

`SITE_ORIGIN` is load-bearing for magic links: the auth callback anchors every redirect to it, and your session cookie is scoped to its host. Run the dev server on the same host and port as `SITE_ORIGIN` (`127.0.0.1:3000` locally). Opening the app at `localhost:3000` instead creates a different cookie origin and breaks the callback flow.

Useful local ports:

| Service | URL |
| --- | --- |
| App for real magic-link flow | `http://127.0.0.1:3000` |
| App used by the default Playwright e2e suite | `http://127.0.0.1:3100` |
| Supabase API | `http://127.0.0.1:54321` |
| Supabase Studio | `http://127.0.0.1:54323` |
| Mailpit inbox | `http://127.0.0.1:54324` |

`pnpm dev:canonical` runs:

```sh
pnpm exec next dev -H 127.0.0.1 -p 3000
```

Plain `pnpm dev` binds the default Next.js host and lands the browser on `localhost:3000`, which is a different cookie origin from canonical `127.0.0.1:3000`. Use `pnpm dev:canonical` for magic-link work.

## Seed data for local demos

Load local env vars before running seed scripts:

```sh
set -a
source .env.local
set +a
```

Create a deterministic local demo run:

```sh
RUN_ID=demo-1
pnpm seed -- --run-id "$RUN_ID"
```

The seed creates:

| Record | Stable shape | Use |
| --- | --- | --- |
| Member user | `member-<run-id>@relay-local.test` | Sign in and access the alpha workspace. |
| Non-member user | `nonmember-<run-id>@relay-local.test` | Denial checks; should not see protected workspace data. |
| Alpha workspace | `test-run-<run-id>-alpha` | Main manual demo workspace. |
| Beta workspace | `test-run-<run-id>-beta` | Secondary boundary fixture. |

Both addresses are local-only fixtures: `.test` is an IETF reserved TLD that never resolves, and Mailpit is the only inbox they reach. Real mail is never sent.

The seed writes generated credentials and slugs to:

```text
.supabase-local/seed-credentials.json
```

That file is gitignored and must stay local. If `.supabase-local/seed-credentials.json` is missing, run `pnpm seed -- --run-id <id>` to generate it; never create or commit it manually.

## Manual magic-link demo

Source of truth for the actual member email, non-member email, and workspace paths/slugs is the seed stdout printed by `pnpm seed -- --run-id "$RUN_ID"` and the file it writes to `.supabase-local/seed-credentials.json`.

The values below use placeholders:

- `<member_email>` — the member email printed by the seed, for example `member-demo-1@relay-local.test`.
- `<member_workspace>` — the full path printed as `member_workspace=...`, including the `/w/` prefix, for example `/w/test-run-demo-1-alpha`.

Do not hardcode any single run id.

Common preconditions for every flow below:

- Supabase local stack is up.
- App is running on the canonical origin: `http://127.0.0.1:3000` (`pnpm dev:canonical`).
- Seed has been run with a unique `RUN_ID` and you have the printed `<member_email>` and `<member_workspace>` path ready.
- Mailpit inbox is reachable at `http://127.0.0.1:54324`.

### Flow A — Deep-link workspace flow (recommended)

Exercises the full chain: query string → login form hidden input → server action → magic-link callback `next` → workspace landing.

1. Open `http://127.0.0.1:3000/login?redirect_to=<member_workspace>`.
2. Enter `<member_email>` and submit.
3. Open Mailpit and click the magic link.
4. Expect to land directly on `<member_workspace>` with the workspace name and signed-in email visible.

### Flow B — Plain sign-in flow

Exercises sign-in without a deep link. Useful when you want to confirm the default landing.

1. Open `http://127.0.0.1:3000/login`.
2. Enter `<member_email>` and submit.
3. Open Mailpit and click the magic link.
4. Expect to land on `/` (the home page).
5. Manually open `http://127.0.0.1:3000<member_workspace>`.
6. Expect the workspace shell to load with the workspace name and signed-in email visible.

### Flow C — Redirect allowlist smoke

Confirms the `safeRedirectTarget()` allowlist collapses unsafe `redirect_to` values to `/` instead of obeying them. The unit test suite (`pnpm test:unit`) already covers allowed and rejected redirect targets at the function layer; this flow is a quick manual sanity check at the browser layer.

For each bad target below, open the URL, enter `<member_email>`, click the magic link from Mailpit, and expect to land on `/` instead of the supplied target:

- `http://127.0.0.1:3000/login?redirect_to=https://evil.example`
- `http://127.0.0.1:3000/login?redirect_to=//evil.example`
- `http://127.0.0.1:3000/login?redirect_to=/admin`

Cleanup removes local test-run workspaces and seed users, including current `@relay-local.test` accounts and any legacy `@relay-test.invalid` accounts left over from earlier seeds:

```sh
pnpm seed:cleanup
```

## Validation commands

Use the smallest command that proves the claim you are checking:

| Goal | Command | Notes |
| --- | --- | --- |
| Fast local sanity | `make fast-check` | Runs schema validation and TypeScript. |
| TypeScript only | `pnpm typecheck` | No Supabase stack required. |
| Unit auth/RLS logic | `pnpm test:unit` | Redirect allowlist and migration-policy checks. |
| DB/RLS proof | `pnpm test:db` | Requires `.env.local` loaded into the shell. |
| Browser workspace shell | `pnpm test:e2e` | Uses the dev-only `/dev/test-signin` route on port `3100`; requires `.env.local` loaded. |
| Real magic-link flow | `pnpm test:e2e:magic` | Uses login form and Mailpit on port `3000`; reads `.env.local` itself. |
| Production backdoor regression | `node --test tests/security/backdoor-production-blocked.spec.ts` | Requires `.env.local` loaded and a current `pnpm build` output. |
| Build check | `pnpm build` | Next.js production build. |
| Repo-law checks | `make repo-law` | Requires Semgrep on the local machine. |
| Tool pin check | `make tools-version-check` | Compares local tooling to `tools.lock.json`. |
| Day 1A closeout evidence | `make day-1a-closeout RUN_ID=<unique-run-id>` | One-shot evidence closeout for Day 1A. |

Load `.env.local` into your shell before commands that need live local Supabase credentials:

```sh
set -a
source .env.local
set +a
```

The two browser suites prove different things:

| Command | Purpose |
| --- | --- |
| `pnpm test:e2e` | Fast workspace-shell checks using the dev-only `/dev/test-signin` route on port `3100`. |
| `pnpm test:e2e:magic` | Real magic-link flow through the login form and Mailpit on port `3000`; the dev sign-in backdoor is disabled, and a sibling spec asserts `/dev/test-signin` returns `404` against the same server. |


## Troubleshooting

### Magic link signs in but returns to `/login`

Use `http://127.0.0.1:3000`, not `http://localhost:3000`. Cookies are host-scoped and `SITE_ORIGIN` is `http://127.0.0.1:3000` locally.

If you submit the login or sign-out form from `localhost:3000`, the app redirects to `http://127.0.0.1:3000/login?error=host` with a visible message. Re-submit on the canonical host.

### Mailpit has no email

Check that the local Supabase stack is running, the app is using the local Supabase URL, and you submitted a seeded `@relay-local.test` address.

### Seed credentials are missing

Run:

```sh
pnpm seed -- --run-id <id>
```

Then read the generated values from seed stdout or `.supabase-local/seed-credentials.json`. Do not create or commit that file manually.

## Reference docs

- `.planning/claude-code-slack-agent-gates-week1-grounded-20260509.md` — authoritative week-one execution plan.
- `docs/decisions/backend.md` — week-one backend/auth/database decision record.
- `docs/tasks/day-1a-auth-substrate-rls.md` — Day 1A implementation checklist and stop conditions.
- `docs/agent/claude-capabilities.md` — repo-local Claude skills and MCP servers used during review.
- `CLAUDE.md` and `AGENTS.md` — agent/operator constraints for trust-boundary work.
