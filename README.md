# Relay

Relay is a workspace-first messaging foundation. The current product slice proves the trust boundary first: a signed-in user can enter only the workspaces they belong to, using Supabase Auth, Supabase Postgres RLS, and Next.js server-side guards.

This is not a full Slack clone yet. Channels, messages, realtime delivery, search, DMs, threads, reactions, uploads, notifications, presence, and typing indicators are outside the current shipped surface unless a later README update says otherwise.

## What works today

- Email magic-link sign-in through Supabase Auth.
- Supabase session cookies via `@supabase/ssr`: `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` or `__Secure-` name prefix, no JWT in `localStorage`.
- A protected workspace shell at `/w/[workspaceSlug]`.
- Workspace membership enforced twice:
  - Next.js server guard: `withWorkspaceGuard`.
  - Supabase RLS policies on `workspaces` and `workspace_members`.
- Local seed data for member vs non-member access checks.
- Automated checks for redirect allowlists, RLS behavior, cookie shape, no JWT in `localStorage`, production backdoor blocking, and real magic-link login through local Mailpit.

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

## Prerequisites

- Node.js 24 or newer.
- pnpm, using the version pinned by `packageManager` in `package.json`.
- Docker running locally.
- Supabase CLI for the local Supabase stack.

Install dependencies with the lockfile:

```sh
pnpm install --frozen-lockfile
```

## Local environment

Start the local Supabase stack:

```sh
supabase start
```

Create `.env.local` from your local Supabase values. Do not commit this file.

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

For the default local Supabase stack the project ref/issuer is `supabase-demo`, so `SUPABASE_PROJECT_REF=supabase-demo` and `DEV_PROJECT_REF_ALLOWLIST=supabase-demo` work out of the box.

`SITE_ORIGIN` is load-bearing for magic links: the auth callback anchors every redirect to it, and your session cookie is scoped to its host. Run the dev server on the same host and port as `SITE_ORIGIN` (`127.0.0.1:3000` locally) — opening the app at `localhost:3000` instead will set the cookie on a host the magic-link callback will not redirect back to, and sign-in will silently bounce to `/login`.

Useful local ports:

| Service | URL |
| --- | --- |
| App for real magic-link flow | `http://127.0.0.1:3000` |
| App used by the default Playwright e2e suite | `http://127.0.0.1:3100` |
| Supabase API | `http://127.0.0.1:54321` |
| Supabase Studio | `http://127.0.0.1:54323` |
| Mailpit inbox | `http://127.0.0.1:54324` |

## Run the app

Run the app on the canonical host/port used by the magic-link configuration. Prefer the dedicated script:

```sh
pnpm dev:canonical
```

Equivalent direct invocation:

```sh
pnpm exec next dev -H 127.0.0.1 -p 3000
```

Plain `pnpm dev` binds the default Next.js host and lands the browser on `localhost:3000`, which is a different cookie origin from canonical `127.0.0.1:3000` and breaks magic-link sign-in. Use `pnpm dev:canonical`.

Open:

```text
http://127.0.0.1:3000
```

The home page links to `/login`. For a useful manual demo, seed a workspace first and sign in through `/login?redirect_to=<member_workspace>`, where `<member_workspace>` is the full path printed by the seed (e.g. `/w/test-run-demo-1-alpha`).

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

The seed writes the generated password and slugs to:

```text
.supabase-local/seed-credentials.json
```

That file is gitignored and must stay local. If `.supabase-local/seed-credentials.json` is missing, run `pnpm seed -- --run-id <id>` to generate it; never create or commit it manually.

Manual magic-link demo.

Source of truth for the actual member email, non-member email, and workspace paths/slugs is the seed stdout printed by `pnpm seed -- --run-id "$RUN_ID"` and the file it writes to `.supabase-local/seed-credentials.json`. The values in this section use placeholders like `<member_email>` and `<member_workspace>`; substitute the real ones from that output. The `<member_workspace>` placeholder stands for the full path the seed prints as `member_workspace=...`, including the `/w/` prefix — for example, a run id of `demo-1` would give `<member_email>` = `member-demo-1@relay-local.test` and `<member_workspace>` = `/w/test-run-demo-1-alpha`. Do not hardcode any single id.

Common preconditions for every flow below:

- Supabase local stack is up.
- App is running on the canonical origin: `http://127.0.0.1:3000` (`pnpm dev:canonical`).
- Seed has been run with a unique `RUN_ID` and you have the printed `<member_email>` and `<member_workspace>` path ready.
- Mailpit inbox is reachable at `http://127.0.0.1:54324`.

If you accidentally open the form at `http://localhost:3000` instead of canonical `http://127.0.0.1:3000`, submitting the login (or sign-out) form redirects you to `http://127.0.0.1:3000/login?error=host` with a visible message. This prevents a PKCE/session cookie host mismatch (cookies set on `localhost` cannot ride to a callback that lands on `127.0.0.1`). Re-submit on the canonical host.

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

For each of the bad targets below, open the URL, enter `<member_email>`, click the magic link from Mailpit, and expect to land on `/` (never on the supplied target):

- `http://127.0.0.1:3000/login?redirect_to=https://evil.example`
- `http://127.0.0.1:3000/login?redirect_to=//evil.example`
- `http://127.0.0.1:3000/login?redirect_to=/admin`

Cleanup removes local test-run workspaces and seed users (both the current `@relay-local.test` domain and any legacy `@relay-test.invalid` accounts left over from earlier seeds):

```sh
pnpm seed:cleanup
```

## Validation commands

Fast local checks:

```sh
pnpm typecheck
pnpm test:unit
```

Database/RLS checks require `.env.local` to be loaded into the shell:

```sh
set -a
source .env.local
set +a
pnpm test:db
```

Browser checks. The default suite needs `.env.local` loaded into the shell (same way as `pnpm test:db`); the magic-link suite reads `.env.local` itself, so a clean shell is fine:

```sh
set -a
source .env.local
set +a
pnpm test:e2e

pnpm test:e2e:magic
```

The two browser suites prove different things:

| Command | Purpose |
| --- | --- |
| `pnpm test:e2e` | Fast workspace-shell checks using the dev-only `/dev/test-signin` route on port `3100`. |
| `pnpm test:e2e:magic` | Real magic-link flow through the login form and Mailpit on port `3000`; the dev sign-in backdoor is disabled, and a sibling spec asserts `/dev/test-signin` returns `404` against the same server. |

Production-build backdoor regression (separate from the e2e suites; needs `.env.local` loaded and a current `pnpm build` output):

```sh
node --test tests/security/backdoor-production-blocked.spec.ts
```

Build check:

```sh
pnpm build
```

Repo governance checks exposed today:

```sh
make fast-check
make repo-law
make tools-version-check
```

`make repo-law` requires Semgrep on the local machine.

Day 1A closeout evidence, when needed:

```sh
make day-1a-closeout RUN_ID=<unique-run-id>
```

## Current product boundary

Relay currently proves the authentication and workspace-membership substrate. Treat the following as not shipped product behavior unless code and tests are added later:

- Channel list or channel membership UI.
- Message composer, message history, or realtime message delivery.
- Search, AI recap, DMs, threads, reactions, uploads, notifications, presence, or typing indicators.
- Production deployment or a connected cloud Supabase project.

Local Supabase is enough for the current slice. No hosted Supabase account is required to run or test the local foundation.

## Reference docs

- `docs/decisions/backend.md` — week-one backend/auth/database decision record.
- `docs/tasks/day-1a-auth-substrate-rls.md` — Day 1A implementation checklist and stop conditions.
- `docs/agent/claude-capabilities.md` — repo-local Claude skills and MCP servers used during review.
- `CLAUDE.md` and `AGENTS.md` — agent/operator constraints for trust-boundary work.
