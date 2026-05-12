# Day 2A — Trust Boundary / Data Path

Source: `.planning/claude-code-slack-agent-gates-week1-grounded-20260509.md` §"Day 2A — Trust Boundary / Data Path".
Budget: ~5h per plan §"Budget Summary" (line 417). Day 2 total is ~9h (Day 2A ~5h + Day 2B ~4h); this slice covers only Day 2A.

Planning-only artifact. No implementation was started.

## Current repo reconciliation

Resolves wording mismatches between the plan and the current repo. Each item is grounded in a file/line anchor.

1. **Authoritative plan file.** `AGENTS.md:13` cites `.planning/Codex-slack-agent-gates-week1-grounded-20260509.md` which does not exist on disk. The actual plan is `.planning/claude-code-slack-agent-gates-week1-grounded-20260509.md`, correctly named in `CLAUDE.md:9`. Use the on-disk file. Treat AGENTS.md as substantively equivalent to CLAUDE.md (same invariants); the divergent filename is a tool-templated artifact and not authoritative.
2. **Migration state.** `supabase/migrations/001_workspace_identity.sql` ships `workspaces` + `workspace_members` with `enable + force row level security` and `revoke all on … from anon` (lines 28-31, 24-25). Day 2A adds `supabase/migrations/002_channels_and_messages.sql` (forward-only). Do not modify `001_*.sql`.
3. **Auth-guard HOF pattern.** `lib/auth/with-session.ts:10-19` exposes `withSession(fn)`. `lib/auth/with-workspace-guard.ts:30-70` exposes `withWorkspaceGuard(slug, fn)` composing `withSession`. Day 2A's `lib/auth/with-channel-guard.ts` follows the same HOF shape and composes `withWorkspaceGuard`. Denial path uses the same `redirect("/")` shape (`with-workspace-guard.ts:54, 66`) so 404-vs-403 distinction is not leaked.
4. **`proxy.ts` carries a Day-1B-only `api404()` synthetic 404.** `proxy.ts:42-44` returns `securityHeaders(new NextResponse(null, {status: 404}))` for every matched `/api/*` request, because Day 1B introduced the `/api/:path*` matcher widening before any real `/api/*` routes existed. Day 2A introduces real Route Handlers under `app/api/**`; the `api404()` branch must be replaced with a header-attaching pass-through (`securityHeaders(NextResponse.next({ request }))`) before the first real route lands, or the new route is unreachable behind the proxy's synthetic 404. **Do not introduce API routes until `api404()` replacement behavior is explicitly handled.**
5. **No `app/api/` directory exists.** `find app -name "*.ts" -o -name "*.tsx"` returns `app/auth/callback/route.ts`, `app/dev/test-signin/route.ts`, `app/layout.tsx`, `app/login/{actions.ts,page.tsx}`, `app/page.tsx`, `app/w/[workspaceSlug]/page.tsx` — none under `app/api/`. Day 2A creates `app/api/messages/route.ts` as the single Day-2A Route Handler.
6. **Server Action origin enforcement is already implemented.** `app/login/actions.ts:15-25` defines `isSameOrigin()` (compares `Origin` header host to `Host` header). `app/login/actions.ts:30-45` defines `canonicalRedirectIfHostMismatch()` (compares request `Host` to `SITE_ORIGIN` host). Both are used in `sendMagicLinkAction` (lines 47-61) and `signOutAction` (lines 82-93). Day 2A reuses these helpers in `app/w/[workspaceSlug]/actions.ts`'s `sendMessageAction`; **no new origin-check primitive is introduced**.
7. **`app/w/[workspaceSlug]/page.tsx`** (lines 4-5) already carries `export const dynamic = "force-dynamic"` and `export const revalidate = 0`. Day 2A modifies the page to compose `withChannelGuard` after `withWorkspaceGuard`, but does not touch the route-level dynamic/revalidate exports.
8. **Test runner choice.** `package.json:14-17` defines `test:unit` (`node --test`), `test:db` (`node --conditions=react-server --test`), and `test:e2e` (Playwright). Day 2A pure-logic + static-SQL tests use `node --test`; DB-backed tests use `node --conditions=react-server --test`; the route-contract spec uses the ephemeral-port `next start` harness pattern from `tests/security/backdoor-production-blocked.spec.ts:26-39` (NOT Playwright — Playwright is `next dev`-only per `playwright.config.ts:41`).
9. **Multi-actor test harness.** `tests/lib/supabase-test-harness.ts:57-117` provides `setupHarness()` returning `{ admin, anon, member, nonMember, workspaceA, workspaceB, cleanup }`. Member is in workspaceA; non-member is in neither. For Day 2A's channel-vs-workspace boundary proofs AND the cross-workspace-binding deny proof, the harness is extended (in a single small patch) to seed:
   - A private channel `channelA1` in workspaceA.
   - A `channel_members` row binding the existing `member` to `channelA1`.
   - A second workspaceA member `workspaceOnlyMember` who is a `workspace_members` row in workspaceA but **not** a `channel_members` row in `channelA1`. This third actor is load-bearing: it proves workspace membership alone is insufficient for channel/message visibility.
   - A private channel `channelB1` in **workspaceB**, plus a `channel_members` row binding the existing `member` to `channelB1`. This cross-workspace seed is load-bearing for the cross-workspace-binding deny test (see Must Ship #3 + #8): `member` is a workspaceA member AND a channel_member of `channelB1` (which lives in workspaceB), so a request bound to `/w/<workspaceA.slug>/<channelB1.id>` must deny on the workspace-id-mismatch check, not on membership.
   - At least one seed message in `channelA1` authored by `member`.
   This extension lands as part of Phase 3, not before.
10. **RLS test patterns established.** `tests/rls/migration-rls-enabled.spec.ts:25-56` is a static SQL grep over `supabase/migrations/**.sql`. `tests/rls/workspace-select-membership.spec.ts:18-71` and `tests/rls/workspace-write-denial.spec.ts:46-134` are runtime DB-backed multi-actor specs. Day 2A's new specs follow these patterns directly; `policy-shape.spec.ts` adds a third axis (admin-client query over `pg_policies`) not previously used.
11. **Semgrep rule layout.** `semgrep/repo-law/service-role-boundary.yml` (real rule with `paths.exclude`) plus `semgrep/repo-law/fixtures/service-role-boundary.{yml,test.ts}` is the canonical layout. Day 1B added `semgrep/repo-law/dangerous-html.yml` using `pattern-regex` because JSX-attribute literals under-match AST patterns. Day 2A rules target well-typed function calls (`supabase.from(...).insert(...)`, `createClient(...)`, etc.), so the preferred idiom is `pattern-either` of `pattern: <ast>` clauses with `pattern-not-inside` guards. Each rule has the canonical fixture pair and a Makefile `repo-law` block (positive fires + negative does not + repo scan clean).
12. **Evidence schema supports Day 2A.** `evidence/manifest.schema.json:21` includes `"2A"` in the `day` enum. `evidence/trust-boundary-paths.json:4-19` covers `lib/auth/**`, `supabase/migrations/**`, `tests/{auth,rls,realtime,security}/**`, `semgrep/repo-law/**`, `proxy.ts`. It does **not** cover any `app/**` paths — yet Day 2A introduces three message paths under `app/`: the Route Handler `app/api/messages/route.ts`, the Server Action `app/w/[workspaceSlug]/actions.ts` (`messages` INSERT), and the modified Server Component `app/w/[workspaceSlug]/page.tsx` (renders messages + composes the guard chain). Day 2A appends **both** `"app/api/**"` AND `"app/w/**"` to the trust-boundary `globs`. The broader `app/w/**` (rather than narrower `app/w/**/actions.ts` + `app/w/**/page.tsx`) is intentional: the workspace shell is itself a security-boundary surface; any future file added under it (`layout.tsx`, `loading.tsx`, additional Server Actions, client-component splits that touch message-write callbacks) inherits Day-2B paired-review coverage automatically without per-file glob updates. Editing `evidence/trust-boundary-paths.json` is itself a trust-boundary change (OR-Ev-1); this edit is part of Day 2A scope and is recorded in the exact file map below.
13. **Pre-Day-2B reviewer provenance applies.** `CLAUDE.md` §"Reviewer provenance" + `CLAUDE.md` §"Harness timing": the Claude review runner (`scripts/run-claude-review.mjs`) and `evidence/runs/<run-id>/claude-authz-review.json` chain land Day 2B. Day 2A trust-boundary edits get **inline read-only review with file/line anchors**. Do **not** fabricate `claude-authz-review.json` or transcript files; `scripts/check-evidence.mjs` (Day 2B) rejects hand-written review JSON.

## Carry-forwards entering Day 2A

Three carry-forwards from prior days require explicit handling. Each has a specific in-Day-2A action or non-action.

1. **`api404()` is Day-1B-only and must be replaced before the first `/api/*` route lands.** `proxy.ts:42-44` (the `api404()` helper) plus `proxy.ts:83-85` (the `/api/*` branch returning `api404()`) intercept every `/api/*` request and return a synthetic 404 with the six Day-1B headers attached. This was correct Day 1B (no real routes existed). Day 2A Phase 4 introduces `app/api/messages/route.ts`; before that file is added, `proxy.ts` must be refactored to `return securityHeaders(NextResponse.next({ request }))` on the `/api/*` branch so requests pass through to Next routing with headers intact. The Day 1B header tests (`tests/auth/cache-control.spec.ts`, `tests/security/headers.spec.ts`) must continue to pass byte-for-byte after the refactor (the `/api/<probe>` path stays a 404 from Next, not from `api404()`; headers still attach via the proxy's pass-through response).
2. **Semgrep telemetry env determinism — Day 2B governance scope, NOT Day 2A.** `make repo-law` currently does not set `SEMGREP_SEND_METRICS=off` in the Makefile (`Makefile:25-64`); on machines with restricted network egress or stale CA trust stores, the default Semgrep telemetry beacon hangs or crashes the scan. Day 2A introduces five new `semgrep scan` invocations in `Makefile repo-law`, raising the Makefile's total `semgrep scan` count from 4 to 9. **Do not pin `SEMGREP_SEND_METRICS=off` in the Makefile during Day 2A.** Day 2B governance work (`scripts/recheck-precommit.sh` or Makefile env pinning) is the correct scope. Day 2A documents the env-set expectation in the closeout run-log only.
3. **CSP / RSC hydration risk under `script-src 'self'`.** Plan-locked CSP excludes `'unsafe-inline'` from `script-src`. Day 1B verified the workspace shell hydrates under this CSP for the simple `<h1>{workspace.name}</h1>` render. Day 2A adds a message render and a message-composer form; if any new component (e.g., a client component for the composer) breaks hydration under the CSP, surface the conflict to the user. **Do not silently relax the CSP — that is a plan amendment, not an implementation discovery.** Same posture as `docs/tasks/day-1b-xss-cache-headers.md` §Risks line 119.

## Day 2A Must Ship

The plan's verbatim Day 2A build list (plan §211-237), expanded for execution. Items 1-9 are plan-authoritative; the trust-boundary-paths extension (item 10) and `proxy.ts` refactor (item 11) are Day 2A-derivative changes required to make the plan-listed items reachable.

1. **Migration `supabase/migrations/002_channels_and_messages.sql`** (forward-only):
   - `public.channels` (id uuid PK, workspace_id uuid not null references `public.workspaces(id)` on delete cascade, name text not null, kind text not null default `'private'`, created_at timestamptz not null default now()).
   - `public.channel_members` (channel_id uuid not null references `public.channels(id)` on delete cascade, user_id uuid not null references `auth.users(id)` on delete cascade, created_at timestamptz not null default now(), primary key (channel_id, user_id)). Index on `(user_id)` for the join shape used by SELECT policies.
   - `public.messages` (id uuid PK, channel_id uuid not null references `public.channels(id)` on delete cascade, user_id uuid not null references `auth.users(id)` on delete cascade, body text not null, client_nonce text null, created_at timestamptz not null default now()). Index on `(channel_id, created_at desc)` for the read shape used by the GET route.
   - `alter table public.messages replica identity default` (explicit — surfaces intent even though `default` is the default).
   - `enable row level security` + `force row level security` on all three tables.
   - `revoke all on public.channels from anon; revoke all on public.channel_members from anon; revoke all on public.messages from anon`.
   - SELECT/INSERT policies per item 2 below. **No client UPDATE/DELETE policies in week one** — write paths for membership tables go through `lib/supabase/admin.ts` only.

2. **RLS policies** (text shape, encoded in the same migration file 002):
   - `channels` SELECT policy (`channels_select_member_only`, `to authenticated`): `exists (select 1 from public.channel_members cm where cm.channel_id = channels.id and cm.user_id = auth.uid())`.
   - `channel_members` SELECT policy (`channel_members_select_self`, `to authenticated`): `user_id = auth.uid()`.
   - `messages` SELECT policy (`messages_select_channel_member`, `to authenticated`): `exists (select 1 from public.channel_members cm where cm.channel_id = messages.channel_id and cm.user_id = auth.uid())`. **Message visibility must be proven through `channel_members`.**
   - `messages` INSERT policy (`messages_insert_self_and_member`, `to authenticated`, `with check`): `user_id = auth.uid() and exists (select 1 from public.channel_members cm where cm.channel_id = messages.channel_id and cm.user_id = auth.uid())`.
   - No INSERT/UPDATE/DELETE policies on `channels` or `channel_members`.
   - No UPDATE/DELETE policies on `messages`.
   - **Workspace membership is insufficient for private channel/message access.** The SELECT policies above join `channel_members`, not `workspace_members`, by design.

3. **`lib/auth/with-channel-guard.ts`** — new HOF.
   - Signature: `withChannelGuard<T>(workspaceSlug: string, channelId: string, fn: (ctx: ChannelContext) => Promise<T>): Promise<T>`.
   - `ChannelContext = WorkspaceContext & { channel: { id: string; name: string; kind: string; workspace_id: string } }`.
   - Composes `withWorkspaceGuard(workspaceSlug, …)`; inside the callback, the channel lookup MUST require **all three** of the following conditions in a single user-scoped query (no admin client):
     - `channels.id = channelId`
     - `channels.workspace_id = workspace.id` (the workspace already resolved by `withWorkspaceGuard`)
     - existence of a `channel_members` row for `(channelId, user.id)` (subquery or join in the same statement)
     A zero-row result on this combined query is the deny case.
   - **The `channels.workspace_id = workspace.id` clause closes a confused-deputy vulnerability** (cross-workspace channel binding): a user who is a workspaceA `workspace_members` row AND a `channel_members` row in `channelB`-in-workspaceB could otherwise visit `/w/<workspaceA>/<channelB.id>`, and a guard that only verifies (workspace membership) AND (channel membership) independently would accept — silently binding a foreign-workspace channel into workspaceA's request context. RLS would still allow the data read (the user IS a channel_member of channelB), so the URL semantics, audit logs, and any workspace-slug-derived rendering would treat channelB as a workspaceA channel. Only the cross-link `channels.workspace_id = workspace.id` check prevents the bind.
   - Pre-DB rejection of `channelId` not matching `^[0-9a-fA-F-]{36}$` (UUID shape) — same defensive pattern as `with-workspace-guard.ts:8 + 34-37`.
   - **Denial collapse:** the deny path MUST NOT distinguish between (a) channel does not exist, (b) channel exists in a different workspace than the slug, (c) user is not a `channel_members` row for the channel. All three collapse to the same `redirect("/")` target and the same structured `console.warn` log reason category (a single string such as `"not-found-or-not-bound-or-not-member"`). Never expose 404-vs-403 distinction; never expose channel-existence-vs-foreign-workspace distinction via log strings, redirect destinations, response timing, or body content.
   - On DB error (`error` non-null from PostgREST), log `"db-error"` with `error.code` only (no message, no detail), redirect to `/`.
   - **Use the user-scoped supabase server client for the lookup. Do not admin-probe channel existence** — admin reads would bypass RLS to determine whether a channel exists for response-shaping purposes, leaking existence to attackers via timing differences or via the existence check itself.

4. **Message create/read paths.**
   - **Read** (server-rendered): `app/w/[workspaceSlug]/page.tsx` modified to:
     - Compose `withWorkspaceGuard` → `withChannelGuard` (after selecting a channel id — Day 2A uses the first channel the user is a member of in the workspace; channel selection UI is out of scope, see §Non-goals). The composed guard chain enforces the workspace-id binding from Must Ship #3 — a foreign-workspace channel id under the wrong slug denies via the uniform `redirect("/")` shape.
     - Query `messages` via the user-scoped supabase server client (NOT admin), ordered by `created_at desc`, limited to 50 rows.
     - Render messages and a `<form action={sendMessageAction}>` composer.
   - **Create** (Server Action): `app/w/[workspaceSlug]/actions.ts` (new file) exports `sendMessageAction(formData)`. Action body:
     - Imports `isSameOrigin` and `canonicalRedirectIfHostMismatch` from `@/app/login/actions` (or extracts both into a shared `@/lib/auth/request-origin.ts` helper if the import shape forbids cross-server-action imports — see §Sequencing Phase 4).
     - Calls `canonicalRedirectIfHostMismatch("/w/<slug>")`, then `isSameOrigin()` — same order as `sendMagicLinkAction` (`app/login/actions.ts:47-61`).
     - Reads `channel_id`, `body`, `client_nonce` from `formData`. **Wraps the INSERT in `withChannelGuard(workspaceSlug, channel_id, …)`** so the channel-membership AND workspace-id-binding checks happen before the DB write. Rejects empty `body` with `redirect("/w/<slug>?error=empty")` inside the guarded callback.
     - INSERT via user-scoped server client (NOT admin). RLS WITH CHECK is the defense-in-depth layer; `withChannelGuard` is the app-layer gate that ALSO blocks cross-workspace bindings (which RLS alone would silently accept since the user genuinely IS a `channel_members` row of the foreign channel).
     - `revalidatePath("/w/<slug>")` then `redirect("/w/<slug>")` to render the new row.
   - **Read (HTTP)**: `app/api/messages/route.ts` GET handler. Query string accepts `channel_id` (required, UUID-shape) and an optional `before` cursor (ISO timestamp). Composes `withSession` (resolves `auth.uid()`) + an explicit single-query channel lookup that verifies ALL THREE conditions: channel exists, channel `workspace_id` matches a workspace the user is a `workspace_members` row of (`exists` subquery against `workspace_members`), AND user is a `channel_members` row for that channel. **Existence-probing collapse:** any inaccessible-or-unknown channel id returns `HTTP 404` with body `{}`. The four inaccessible cases — (a) unknown channel id, (b) cross-workspace channel id where the user is not in the channel's workspace, (c) workspace-only-member-not-in-channel, (d) non-workspace-member — all return byte-identical `404 + {}`. Only the channel-member-in-bound-workspace case returns `200 + { messages: [{ id, channel_id, user_id, body, created_at }] }`. **Choice rationale:** 404-for-all-inaccessible matches the existing app-side discipline (`with-workspace-guard.ts:54-66` redirects to `/` uniformly for unknown-vs-not-member) and follows the principle "give the attacker the same answer they'd see if the resource truly did not exist." The handler uses the user-scoped supabase client only; **no admin probe to determine existence** — that would bypass RLS to decide response status, leaking existence via timing or response shape. Used as the subject of `tests/api/route-contract.spec.ts`.

5. **Server Action origin enforcement.** `sendMessageAction` calls `isSameOrigin()` before any DB work. Cross-origin POST → redirect to `/login?error=origin` (same shape as `sendMagicLinkAction` in `app/login/actions.ts:58-61`). Tested by `tests/auth/server-action-csrf.spec.ts`.

6. **`docs/api-contract.md`** — generated from `tests/api/route-contract.spec.ts`.
   - The spec is the source of truth: each contract case is a `test()` with a documented request/response shape.
   - At Day 2A closeout, run a one-shot extraction (manual `node` script invocation; **no new project script in `package.json`**) that walks the spec file and emits a markdown table per route. The doc lives at `docs/api-contract.md`. The script is `scripts/gen-api-contract.mjs` (NEW), invoked manually as part of the closeout flow.
   - For Day 2A, the only documented route is `GET /api/messages` with the request schema (`?channel_id=<uuid>&before=<iso-timestamp>?`) and exactly **two** wire-distinguishable response classes (per Finding-5 existence-probing collapse):
     - **`200 OK`** + `{ messages: [{ id, channel_id, user_id, body, created_at }] }` — only when the requesting user is a `channel_members` row of a channel whose `workspace_id` matches a workspace the requesting user is a `workspace_members` row of.
     - **`404 Not Found`** + body `{}` — for every other case: unknown channel id, cross-workspace channel id (user not in the channel's workspace), workspace-only-member-not-in-channel, non-workspace-member.
   - The contract MUST explicitly state that `404` does **not** distinguish existence from inaccessibility, and that this collapse is intentional anti-probing behavior. The contract MUST also state that the handler uses user-scoped RLS-visible reads only; no admin probe decides the response status.

7. **ADRs** (under `docs/decisions/`). Each ADR must have substantive content — not just a title. The set:
   - `docs/decisions/auth.md` — magic-link semantics (OTP single-use + expiry per OR-Auth-1), redirect-allowlist invariant (`^/w/[a-z0-9-]+/?$` and `/`), cookie shape (`__Host-`/`__Secure-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, no Domain), `SITE_ORIGIN` anchoring (per `lib/auth/site-origin.ts:14-18`), `isSameOrigin` + host-mismatch redirect, server-side `signOut` + cookie clear (OR-Auth-5).
   - `docs/decisions/server-guard-layer.md` — three-layer composition (`withSession` → `withWorkspaceGuard` → `withChannelGuard`); HOFs over middleware (rationale: types flow through generics; denial shape is per-layer; testable in isolation); failure-mode shape (all denials redirect to `/`; no 500s, no 404-vs-403 distinction); error logging discipline (`logDeny` with `code` only, no message/detail).
   - `docs/decisions/realtime-test-lane.md` — **chooses the local Supabase stack** for Day 3 RLS-realtime tests over a nightly dev project. Rationale: deterministic, no shared state, no network flake. Bound: re-evaluate Day 3 if local stack realtime delivery proves incompatible with the chosen RLS policy shape (`docs/decisions/backend.md` early-trigger #1). This ADR is a **Day 2A prerequisite for Day 3** (`plan:271`).
   - `docs/decisions/migrations.md` — forward-only discipline (`OR-DB-2`); numeric monotonic prefix (`001_`, `002_`, …); manual review for `SECURITY DEFINER` / `grant … to anon` / broad `to public` grants (`OR-DB-3`); explicit `replica identity` discipline (`messages` stays `default`, OR-DB-1).

8. **Tests** (plan §221-228, 8 specs).
   - **`tests/api/route-contract.spec.ts`** — `node --test` + ephemeral-port `next start` (PID-ancestry stale-server guard reused from `tests/security/backdoor-production-blocked.spec.ts:26-39`). Drives `GET /api/messages?channel_id=<uuid>`. **Five actor/path cases** (per Finding-5 existence-probing collapse and Finding-3 cross-workspace binding; each signs in via `app/dev/test-signin/route.ts` with `RELAY_E2E_BACKDOOR=1`):
     - **Case A — Channel member, in-workspace channel:** `200` + non-empty `messages[]` with the seeded message.
     - **Case B — Workspace-only member** (workspace_members row in workspaceA, no channel_members row in `channelA1`): `404` + `{}`, byte-identical to Cases C/D/E.
     - **Case C — Cross-workspace channel id** (`channelB1`, in workspaceB; signed-in `member` is a `channel_members` row of `channelB1` AND in workspaceA): `404` + `{}`, byte-identical to Cases B/D/E. **This is the cross-workspace-binding deny test for the route handler (Finding 3): the user satisfies channel-membership but the channel's `workspace_id` is not a workspace the user belongs to under the requested path, so the handler MUST return 404, not 200.**
     - **Case D — Unknown channel id** (random UUID not present in DB): `404` + `{}`, byte-identical to Cases B/C/E.
     - **Case E — Non-workspace member** (signed-in user is in zero workspaces): `404` + `{}`, byte-identical to Cases B/C/D.
     - **Wire-equality assertion** across Cases B/C/D/E: assert `status` AND `body bytes` are byte-identical (not just `status === 404`). False-pass guard: if any inaccessible case returns a different body (e.g., `{}` vs `""`, or a different header) the spec MUST fail explicitly. Second false-pass guard: if Case C returns `200` (the cross-workspace binding leak), surface as the load-bearing failure with a clear message; do not let it silently degrade.
     Document each request/response in the spec's `test()` titles so `scripts/gen-api-contract.mjs` can extract.
   - **`tests/auth/magic-link-replay.spec.ts`** — admin SDK (`auth.admin.generateLink({ type: 'magiclink', email })`) mints a token; spec calls `auth.verifyOtp({ token_hash, type: 'magiclink' })` twice. Asserts: first call returns `data.session` non-null and `error` null; second call returns `error` non-null and `data.session` null. False-pass guard: reject as inconclusive if the second call returns BOTH non-null `data.session` AND non-null `error`.
   - **`tests/auth/server-action-csrf.spec.ts`** — ephemeral-port harness. POSTs a Next 16 Server Action invocation (`Next-Action` header + serialized payload) to `/w/<slug>` with `Origin: https://evil.example` and the spawned server's `Host` value. Asserts: response status 3xx redirecting to `/login?error=origin`; admin-side probe shows zero rows inserted into `messages` for the test channel. False-pass guard: if the action's same-origin path is reachable from the same harness (control case), confirm GREEN on a same-origin POST first; otherwise the harness is broken.
   - **`tests/rls/all-tables-have-rls.spec.ts`** — DB-backed, admin client. Queries `pg_class` joined to `pg_namespace` for all tables in `public`; asserts both `relrowsecurity = true` AND `relforcerowsecurity = true` for every public table. Catches drift: any future migration that creates a table without `enable + force RLS` fails this test. Complements (does not replace) `tests/rls/migration-rls-enabled.spec.ts:25-56` (static SQL grep).
   - **`tests/rls/policy-shape.spec.ts`** — DB-backed via `psql` subprocess. Queries `pg_policies` for `tablename in ('channels','channel_members','messages')` and `information_schema.role_table_grants` for the grant matrix. **Per `docs/tasks/day-2a-phase-2.5-blocker-fixes.md` (the slice that closed OMX review on this spec), the predicate-shape assertions are exact normalized `qual` / `with_check` equality (Option A only)** against the canonical forms captured from the live local stack — not substring matches. The grant matrix covers all five app tables (workspaces, workspace_members, channels, channel_members, messages) after migration 003 hardened the workspace-table ACLs. Asserts:
     - `messages` SELECT policy `qual` is byte-identical to the canonical normalized form.
     - `messages` INSERT policy `with_check` is byte-identical to the canonical normalized form (top-level `user_id = auth.uid()` author predicate proven distinct from the `cm.user_id = auth.uid()` membership user binding by construction of the canonical string).
     - `channels` SELECT and `channel_members` SELECT policy `qual` are byte-identical to their canonical normalized forms.
     - The exact set of policies on the three Day-2A tables (deepStrictEqual against tablename/policyname/cmd/roles).
     - No row in `pg_policies` has `cmd in ('UPDATE','DELETE','ALL')` for any of the three tables.
     - `authenticated` SQL grants across the five app tables equal exactly the minimal `{SELECT, SELECT, INSERT, SELECT, SELECT, SELECT}` set per table.
     - `anon` and `PUBLIC` hold zero grants on the five tables.
     - No `UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` granted to anon/authenticated/PUBLIC on any of the five tables.
     Failure shape: any predicate, set, or grant drift fails this test.
   - **`tests/rls/channel-list-membership.spec.ts`** — DB-backed. Uses the extended `setupHarness()` (member as `channel_members` of `channelA1` AND of `channelB1`; workspaceOnlyMember as workspaceA-only with no `channel_members` row; nonMember in neither workspace). Assertions on `channelA1` (the same-workspace channel):
     - `member.client.from("messages").select("id").eq("channel_id", channelA1.id)` returns `>= 1` row.
     - `workspaceOnlyMember.client.from("messages").select("id").eq("channel_id", channelA1.id)` returns `length === 0` (workspace membership ≠ channel access).
     - `nonMember.client.from("messages").select("id").eq("channel_id", channelA1.id)` returns `length === 0`.
     - Same three-actor matrix repeated for `channels` SELECT (`channelA1` only visible to its `channel_members` row).
     - **Cross-workspace channel sanity assertion** (informs Finding 3 interpretation, not a route-handler test): `member.client.from("messages").select("id").eq("channel_id", channelB1.id)` succeeds because `member` IS a `channel_members` row of `channelB1` — RLS gates on membership alone, NOT on which workspace the channel belongs to. This row-level pass confirms the route-handler-layer workspace-id binding (Must Ship #3) is the actual confused-deputy defense, not RLS.
     Negative-actor assertions land first (TDD step 4).
   - **`tests/auth/guard-failure-modes.spec.ts`** — DB-backed, runs each guard under denial.
     - `withSession`: no session cookie → redirects to `/login` (assert status 3xx + location).
     - `withWorkspaceGuard`: signed-in non-member → redirects to `/`.
     - `withChannelGuard`, **denial-A** (workspace-only-member): signed-in `workspaceOnlyMember` (in workspaceA, not channel_member of `channelA1`) requests `/w/<workspaceA.slug>/<channelA1.id>` → redirects to `/`.
     - `withChannelGuard`, **denial-B** (cross-workspace binding, Finding 3): signed-in `member` (workspaceA member AND `channel_members` row of `channelB1`-in-workspaceB) requests `/w/<workspaceA.slug>/<channelB1.id>` → redirects to `/`. **Assert the redirect target AND the structured log reason category are byte-identical to denial-A.** The foreign-channel-exists distinction MUST NOT be observable from the response, the log, or the redirect target.
     - `withChannelGuard`, **denial-C** (unknown channel id): signed-in `member` requests `/w/<workspaceA.slug>/<random-uuid>` → redirects to `/`. Same byte-identical denial shape as denial-A and denial-B.
     - All assertions via the ephemeral-port harness driving real requests to `/w/<slug>/<channel-id>`. **No 500s on any denial.** False-pass guard #1: a 500 response is a test failure regardless of body content. False-pass guard #2: if denial-A, denial-B, and denial-C produce different log reason categories OR different redirect targets, the spec MUST fail — the existence/foreign-workspace distinction MUST NOT leak via any observable channel.
   - **`tests/util/run-isolation.spec.ts`** — `setupHarness()` runs A and B with distinct `runId`s, sequentially. Asserts:
     - After run B's setup, run A's `member.client` cannot see run B's seeded workspace (zero rows for `slug = test-run-<B>-alpha`).
     - After run A's cleanup, run B's seeded rows are untouched.
     - No two harness runs share a slug prefix.
     **Cuttable per plan §"Cut order"; if cut, the discipline shifts to manual `test-run-<id>-` prefix audit.**

9. **Repo-law rules + fixtures** (plan §229-237, 5 rules).
   - **`semgrep/repo-law/unguarded-route-query.yml`** + **six positive fixture patterns** + one negative fixture. Pattern shape: match `supabase.from('messages'|'channels'|'channel_members').<insert|update|delete|select>(...)` (or `await supabase.from(...)...`) inside files under `app/api/**` or `app/**/actions.ts`. **The "safe" antecedent is `withChannelGuard` ONLY (or a future explicit channel-membership-binding guard helper) — NOT `withSession`, NOT `withWorkspaceGuard`.** Workspace membership is insufficient for private channel/message access (CLAUDE.md §"Data model" + plan §80); the rule enforces that distinction at the static-analysis layer. Implementation: `pattern-either` of the banned-call shapes, with `pattern-not-inside` anchored ONLY to `withChannelGuard`-callback contexts (and not to `withSession`/`withWorkspaceGuard` callbacks). The fixtures decompose as:
     **Four plan-enumerated positive patterns** (plan §230-233):
     1. Route Handler in `app/api/**` (e.g., `app/api/messages/route.ts.example`) calling `supabase.from('messages')` with no preceding guard at all.
     2. Server Action mutating `messages` with no preceding guard at all.
     3. Route Handler reading by user-supplied workspace id with no preceding guard at all.
     4. Catch-all route `app/api/[...slug]/route.ts` touching workspace/channel/message data with no preceding guard at all.
     **Two false-safe positive patterns** (Day 2A-derivative tightening per the channel-vs-workspace-boundary invariant; these are NOT plan-fabrications, they implement plan §80's "joins `channel_members` (not `workspace_members`)" rule at the static-analysis layer):
     5. **`withSession`-only**: a Route Handler in `app/api/**` (or a Server Action in `app/**/actions.ts`) wraps a `supabase.from('messages'|'channels'|'channel_members').<…>(…)` call inside `withSession(async (ctx) => { … })` but NOT inside `withChannelGuard`. The rule MUST fire — `withSession` resolves `auth.uid()` only, not channel binding.
     6. **`withWorkspaceGuard`-only**: a Server Action wraps a `supabase.from('messages'|'channels'|'channel_members').<…>(…)` call inside `withWorkspaceGuard(slug, async (ctx) => { … })` but NOT inside `withChannelGuard`. The rule MUST fire — workspace membership is insufficient for private channel/message access.
     **Negative fixture:** one Route Handler + one Server Action, each wrapping the `supabase.from('messages').<…>` call inside `withChannelGuard(workspaceSlug, channelId, async (ctx) => { … })`. Markers: `// ok: unguarded-route-query`. **Floor item — not cuttable.**
   - **`semgrep/repo-law/no-service-role-in-jsx.yml`** + fixtures. Bans interpolation of `process.env.SUPABASE_SERVICE_ROLE` (or any binding holding a service-role JWT) into JSX, HTML response, `NextResponse.json` body, `Response.json` body, or template strings landing in a response. Pattern: `pattern-either` of the matched sink shapes, with `pattern-inside: function $F(...) { ... return <$JSX>...</$JSX>; }` and similar response-return shapes. Positive fixture: a TSX component reading SUPABASE_SERVICE_ROLE and rendering it in a `<p>` or `<pre>` tag. Negative fixture: the same component rendering a public env var. **Floor item — not cuttable.**
   - **`semgrep/repo-law/no-raw-pg-client.yml`** + fixtures. Bans `import { Client, Pool } from 'pg'`, `require('pg')`, `new pg.Client(...)`, `new pg.Pool(...)` outside `lib/supabase/admin.ts`. Matches OR-DB-3 invariant. Positive fixtures: import + require + new shapes. Negative fixture: a file in `lib/supabase/admin.ts` (excluded by `paths.exclude`).
   - **`semgrep/repo-law/fake-auth-bypass.yml`**. Bans hard-coded auth bypasses in app code: `auth.uid() === 'admin'`-style string literals, `if (process.env.NODE_ENV !== 'production')` gating around auth checks, `bypassAuth()` named helpers. Pattern-either of the offending shapes. **Cuttable per plan cut order #3.**
   - **`semgrep/repo-law/admin-client-boundary.yml`**. Bans `createSupabaseAdminClient(...)` calls outside `lib/supabase/admin.ts`, `scripts/seed.ts`, `scripts/seed-cleanup.mjs`, `scripts/check-bundle-leak.mjs`, `scripts/test-bundle-leak-fixture.mjs`. Overlaps with `service-role-boundary.yml`. **Cuttable per plan cut order #2.**

10. **Trust-boundary list extension.** `evidence/trust-boundary-paths.json` `globs` array gains BOTH `"app/api/**"` AND `"app/w/**"`. The broader `app/w/**` glob brings the new Server Action (`app/w/[workspaceSlug]/actions.ts`) and the modified workspace shell page (`app/w/[workspaceSlug]/page.tsx`) — both message paths — under the Day-2B `check-evidence.mjs` paired-review requirement once that runner lands. **Rationale for `app/w/**` over narrower `app/w/**/actions.ts` + `app/w/**/page.tsx`:** the workspace shell is itself a security-boundary surface; any future file under it (`layout.tsx`, `loading.tsx`, additional Server Actions, client-component splits that touch message-write callbacks) inherits paired-review coverage automatically without per-file glob updates. Per `evidence/trust-boundary-paths.json:20` (OR-Ev-1), the edit to this file is itself a trust-boundary change.

11. **`proxy.ts` refactor.** `proxy.ts:42-44` (the `api404()` helper) and `proxy.ts:83-85` (the `/api/*` branch that returns `api404()`) are removed. The `/api/*` branch becomes:
    ```
    if (!isWorkspacePath) {
      return securityHeaders(NextResponse.next({ request: req }));
    }
    ```
    The Day 1B header tests (`tests/auth/cache-control.spec.ts`, `tests/security/headers.spec.ts`) must continue to pass byte-for-byte under this refactor — the headers attach via the `securityHeaders(...)` helper exactly as before, just on a pass-through response instead of a synthetic 404. Verify post-refactor by re-running both specs and confirming GREEN before adding `app/api/messages/route.ts`.

## Day 2A Stop Condition

Day 2 Stop Condition (plan §258-267) mixes Day 2A and Day 2B items; the slice-green criterion is the Day 2A subset only.

**Day 2A slice green** — sufficient to mark Day 2A complete:

1. `supabase/migrations/002_channels_and_messages.sql` applies cleanly to the local Supabase stack with no errors.
2. `node --test tests/rls/migration-rls-enabled.spec.ts` exits 0 with the new tables exercised (`enable + force RLS`, `revoke all from anon` confirmed by static SQL grep).
3. `node --conditions=react-server --test tests/rls/all-tables-have-rls.spec.ts` exits 0 with `channels`, `channel_members`, `messages` enumerated and `relrowsecurity = true` AND `relforcerowsecurity = true` for each.
4. `node --conditions=react-server --test tests/rls/policy-shape.spec.ts` exits 0 with the Phase-2.5 contract active (`docs/tasks/day-2a-phase-2.5-blocker-fixes.md`):
   - All four predicate-shape assertions (channels SELECT qual, channel_members SELECT qual, messages SELECT qual, messages INSERT with_check) are exact normalized equality against the canonical forms captured from the live local stack — Option A only; substring-only and substring-plus-structural-rejection proofs are explicitly rejected.
   - Top-level `messages.user_id = auth.uid()` author predicate is structurally distinct from the `cm.user_id = auth.uid()` membership user binding, proven by the exact-equality assertion against the canonical with_check.
   - Exact policy set on the three Day-2A tables (deepStrictEqual against the four expected rows).
   - No UPDATE/DELETE/ALL policies exist for any of the three tables.
   - Grant matrix covers all five app tables: `authenticated` holds only the minimal `SELECT` (and `INSERT` for messages); `anon` and `PUBLIC` hold zero; no dangerous privileges (UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) leaked to anon/authenticated/PUBLIC.
5. `node --conditions=react-server --test tests/rls/channel-list-membership.spec.ts` exits 0:
   - Channel member sees ≥ 1 message in channelA1.
   - Workspace-only member sees zero messages in channelA1.
   - Non-workspace member sees zero rows for both `messages` and `channels` queries.
6. `node --conditions=react-server --test tests/auth/guard-failure-modes.spec.ts` exits 0; every denial path (incl. `withChannelGuard` denial-A workspace-only-member, denial-B cross-workspace-binding, denial-C unknown-channel-id) returns 3xx or 403, never 500; denial-A/B/C produce byte-identical redirect targets AND log reason categories (no existence-vs-foreign-workspace leak).
7. `node --conditions=react-server --test tests/auth/magic-link-replay.spec.ts` exits 0; second OTP consumption fails with non-null error and null session.
8. `node --conditions=react-server --test tests/auth/server-action-csrf.spec.ts` exits 0; cross-origin POST redirected to `/login?error=origin`; admin probe confirms zero `messages` row written.
9. `node --conditions=react-server --test tests/api/route-contract.spec.ts` exits 0 for all five actor/path cases: Case A channel-member → `200` + messages; Cases B (workspace-only), C (cross-workspace channel id), D (unknown channel id), E (non-workspace member) all return byte-identical `404 + {}` (existence-probing collapse).
10. `node --conditions=react-server --test tests/util/run-isolation.spec.ts` exits 0 (or is cut per cut discipline; cut state must be recorded explicitly in the closeout note).
11. `make repo-law` exits 0 with all five new rules:
    - Positive fixtures fire (semgrep exit 1). For `unguarded-route-query.yml`: all **six** positive fixtures fire (the four plan-enumerated "no guard at all" cases AND the two Day-2A-derivative false-safe cases — `withSession`-only and `withWorkspaceGuard`-only). The `withChannelGuard`-wrapped negative fixture does NOT fire.
    - Negative fixtures do not fire (semgrep exit 0).
    - Repo scan over the live repo does not fire (semgrep exit 0).
12. `proxy.ts` `api404()` branch is removed; `/api/*` is a header-attaching pass-through. `node --test tests/security/headers.spec.ts tests/auth/cache-control.spec.ts` (Day 1B specs) continue to pass byte-for-byte after the refactor.
13. The four ADRs exist at `docs/decisions/{auth,server-guard-layer,realtime-test-lane,migrations}.md` with substantive content (not stubs).
14. `docs/api-contract.md` exists, generated from `tests/api/route-contract.spec.ts` via `scripts/gen-api-contract.mjs` (manual invocation; no `package.json` script entry).
15. `evidence/trust-boundary-paths.json` has BOTH `"app/api/**"` AND `"app/w/**"` appended to `globs`; AJV-valid under `evidence/trust-boundary-paths.schema.json`.

**Day 2 (full Stop Condition, plan §258-267) — NOT closed by this slice.** Items requiring Day 2B before they can pass:

- `make governance-check` exits 0 with all blocking targets real (lint, typecheck, tests, repo-law, workflow-hardening, recheck-precommit, tools-version-check, evidence-check, bundle-leak).
- Fixture trust-boundary PR triggers `check-evidence.mjs` to require paired Claude review; absence exits non-zero.
- `evidence/fixtures/block-verdict-trust-boundary/` makes `check-evidence.mjs` exit non-zero.
- `git_sha` mismatch fixture makes `check-evidence.mjs` exit non-zero.
- Unsafe `pull_request_target` fixture makes `check-workflow-hardening.mjs` exit non-zero.
- `git commit --no-verify` of a service-role violation, then `make governance-check` → exits non-zero.

Day 2A produces the data path and the static rules that the Day 2B harness enforces. It does not produce the harness itself.

## Day 2A sequencing (8 phases)

Strict phase order. Each phase has gating output that the next phase reads.

**Phase 1 — Migration + RLS table guarantees.** Write `supabase/migrations/002_channels_and_messages.sql` with all three table definitions, `enable + force RLS`, `revoke all from anon`, and the SELECT/INSERT policies for all three tables. Static check: extend or re-run `tests/rls/migration-rls-enabled.spec.ts` (existing) — confirms the new tables are RLS-enabled at the SQL-text layer. Apply migration to local stack. No tests touch the live DB yet.

**Phase 2 — Policy-shape tests.** Write `tests/rls/all-tables-have-rls.spec.ts` (runtime pg_catalog enumeration) and `tests/rls/policy-shape.spec.ts` (pg_policies query). Run both. Expected GREEN against the Phase-1 migration. If RED, the Phase 1 migration is wrong; fix it (forward-only edit only if file is uncommitted; otherwise add `003_*.sql`). **Phase 2 closed OMX review with five blockers; see `docs/tasks/day-2a-phase-2.5-blocker-fixes.md` for the named-blocker fix slice that must complete before Phase 3.**

**Phase 2.5 — OMX blocker fixes.** Scope and contract live in `docs/tasks/day-2a-phase-2.5-blocker-fixes.md`. Creates `supabase/migrations/003_harden_workspace_acl.sql` (revoke broad privileges from `authenticated`/`public` on `workspaces`/`workspace_members`, grant minimal SELECT only). Tightens `tests/rls/policy-shape.spec.ts`: exact normalized predicate equality (Option A only) replaces substring matches; grant matrix extends from three Day-2A tables to all five app tables; duplicated `psqlQuery` helper tightened to require local host AND port 54322 AND db postgres. Tightens the same helper in `tests/rls/all-tables-have-rls.spec.ts` (assertions unchanged). Truth-up edits to this doc and `docs/tasks/day-2a-phase-2-policy-shape-tests.md` only. No Phase 3 work.

**Phase 3 — Channel guard + harness extension.** Write `lib/auth/with-channel-guard.ts` (HOF; three-condition single-query lookup with `channels.id` + `channels.workspace_id = workspace.id` + `channel_members` binding; uniform `redirect("/")` deny shape; single log-reason category; no admin probe). Extend `tests/lib/supabase-test-harness.ts` to seed `channelA1` (workspaceA, `member` is `channel_members`), `workspaceOnlyMember` (workspaceA only, no channel_members row), `channelB1` (workspaceB, `member` is also `channel_members`), plus one seed message in `channelA1`. Write `tests/auth/guard-failure-modes.spec.ts` covering denial-A (workspace-only-member), denial-B (cross-workspace binding), denial-C (unknown channel id). Run; expected GREEN; denial-A/B/C byte-identical.

**Phase 4 — Proxy refactor + message routes.** Refactor `proxy.ts`: remove `api404()`; pass-through `/api/*` with `securityHeaders(NextResponse.next({ request }))`. Re-run Day 1B header specs; expected GREEN unchanged. Then write `app/api/messages/route.ts` GET handler implementing the Finding-5 existence-probing collapse (all four inaccessible cases return byte-identical `404 + {}`; only `200 + messages[]` for in-channel, in-workspace member; user-scoped reads only, no admin probe). Write `app/w/[workspaceSlug]/actions.ts` `sendMessageAction` wrapping the INSERT in `withChannelGuard` (Finding-3 workspace-id binding). Modify `app/w/[workspaceSlug]/page.tsx` to compose `withChannelGuard` and render messages + composer. If shared-helper extraction is needed (origin-check helpers), create `lib/auth/request-origin.ts` and update `app/login/actions.ts` to import from it — same-shape edit, no behavior change.

**Phase 5 — Route contract spec + doc generation.** Write `tests/api/route-contract.spec.ts` with all five actor/path cases (A channel-member 200; B workspace-only-member 404; C cross-workspace-channel-id 404; D unknown-channel-id 404; E non-workspace-member 404) AND the byte-identical wire-equality assertion across Cases B/C/D/E. Run; expected GREEN. Write `scripts/gen-api-contract.mjs` (one-shot reader of the spec file). Run it manually; output to `docs/api-contract.md` documenting exactly two wire-distinguishable response classes. **No `package.json` script entry for this generator** — it runs at closeout only.

**Phase 6 — Auth/CSRF/replay tests.** Write `tests/rls/channel-list-membership.spec.ts` (negative-actor case first, then positive). Write `tests/auth/server-action-csrf.spec.ts`. Write `tests/auth/magic-link-replay.spec.ts`. Run each; expected GREEN. Write `tests/util/run-isolation.spec.ts` last (cuttable).

**Phase 7 — Repo-law rules.** Write the five rules + fixture pairs in order: `unguarded-route-query.yml` (floor; six positive fixtures = 4 plan-enumerated + 2 false-safe `withSession`-only and `withWorkspaceGuard`-only), `no-service-role-in-jsx.yml` (floor), `no-raw-pg-client.yml` (floor), `fake-auth-bypass.yml` (cuttable), `admin-client-boundary.yml` (cuttable). For each: positive fixture + `// ruleid:` markers, negative fixture + `// ok:` markers. Extend `Makefile repo-law` target with one block per rule (positive fires + negative does not + repo scan clean). Run `make repo-law`; expected exit 0.

**Phase 8 — ADRs + handoff.** Write the four ADRs with substantive content. Extend `evidence/trust-boundary-paths.json` `globs` with BOTH `"app/api/**"` AND `"app/w/**"`; AJV-validate. Final review: cross-check every Stop Condition item against an actual artifact. **No commit unless explicitly authorized.**

## TDD / false-pass ordering

Strict order is deliberate; out-of-order steps cause false-pass risk.

1. **Static checks before live DB.** Phase 1 lands the migration file. Run `tests/rls/migration-rls-enabled.spec.ts` (static SQL grep) before applying the migration to the local stack. Catches a wrong-shape migration before paying the cost of a push. RLS-on-the-table is a precondition for any policy claim — a policy on a non-RLS table grants nothing AND fails closed silently.
2. **Apply migration, then runtime RLS check.** Run `tests/rls/all-tables-have-rls.spec.ts` against the live local DB. Both static and runtime checks must be GREEN before proceeding to policy-shape.
3. **Policy-shape test as the false-pass canary.** `policy-shape.spec.ts` queries `pg_policies` for `qual` / `with_check` content. Anchor assertions against `pg_policies` row content, not raw migration SQL — a regex matching `auth.uid()` in a comment instead of an SQL token would false-pass.
   - **Phase 2.5 supersedes the substring model.** Per `docs/tasks/day-2a-phase-2.5-blocker-fixes.md` §Blocker 1 / §Blocker 2, substring-presence alone is insufficient: the substring `user_id = auth.uid()` appears twice in the canonical `messages` INSERT with_check (once at the top level pinning author identity, once inside the membership EXISTS subquery pinning membership user binding), and a buggy migration could drop the top-level predicate while keeping the subquery and still satisfy the substring check. The Phase 2.5 contract requires **exact normalized `qual` / `with_check` equality (Option A only)** for the four predicate assertions. Substring-plus-structural-rejection (Option B) is explicitly rejected because it cannot reject tacked-on top-level AND clauses (e.g., `AND (1 = 1)`).
4. **Negative-actor tests before positive.** `channel-list-membership.spec.ts` writes the "workspace-only-member → zero rows" actor test BEFORE the positive "channel member sees rows" test. Reason: a wrong SELECT policy joining `workspace_members` (instead of `channel_members`) passes the positive case correctly AND fails the negative case correctly. Writing positive-first risks accepting the wrong policy because the positive case already passes; the failure surfaces only at the negative-actor case. Writing negative-first forces the correct join.
5. **Guard-failure tests before guard usage.** `guard-failure-modes.spec.ts` exercises `withChannelGuard` under denial before any production code calls it. Three negative-actor cases run together: denial-A (workspace-only-member), denial-B (cross-workspace channel binding — Finding 3), denial-C (unknown channel id). **Denial-B is the load-bearing case for the workspace-id-binding check**: write it BEFORE finalizing `withChannelGuard` — expected RED if the guard only verifies (workspace) AND (channel membership) independently (a `member` who is a `channel_members` row of `channelB1`-in-workspaceB visits `/w/<workspaceA.slug>/<channelB1.id>` and the guard accepts); GREEN once the `channels.workspace_id = workspace.id` clause is added. Assert byte-identical redirect target AND log reason category across denial-A/B/C; ANY divergence is a leak and the spec fails.
6. **Route-contract spec before route exists; wire-equality assertion before route refinement.** `route-contract.spec.ts` declares the request/response contract for all five actor/path cases; run against the ephemeral-port server before `app/api/messages/route.ts` exists. Expected RED — the route returns 404 from the proxy's `api404()` (pre-refactor) or 404 from Next routing (post-refactor, no handler). The proxy refactor + route implementation closes Case A to GREEN. **The wire-equality assertion across Cases B/C/D/E is the existence-probing-collapse canary**: write it explicitly (compare `status` AND `body bytes`, not just `status === 404`) BEFORE implementing the handler's response shape — a naive implementation returning `403` for non-member and `404` for unknown channel id will fail the equality assertion, surfacing the existence leak. GREEN only when all four inaccessible cases return byte-identical `404 + {}`. **False-pass guard for Case C (cross-workspace channel id):** if Case C returns `200`, the workspace-id binding in `withChannelGuard` is missing or the handler skipped the guard — fail loudly, do not let the spec degrade silently to "non-member sees nothing under RLS."
7. **`proxy.ts` refactor before adding `app/api/**` routes.** Critical order. Adding `app/api/messages/route.ts` while `proxy.ts:42-44 api404()` is still in place renders the route unreachable; tests against it return the proxy's synthetic 404, not the route's response. Refactor first; confirm `tests/security/headers.spec.ts` and `tests/auth/cache-control.spec.ts` (Day 1B specs) still GREEN — only then add the route. **Do not introduce API routes until `api404()` replacement behavior is explicitly handled.**
8. **Server Action CSRF test sequence.** Cross-origin POST first (expected GREEN if action rejects; RED if action accepts). Same-origin POST second (control case — must be GREEN, otherwise the harness is broken and the cross-origin RED was a false-pass). Both required.
9. **Magic-link replay false-pass guard.** Reject as inconclusive if the second OTP consumption returns BOTH non-null `data.session` AND non-null `error` — this is Supabase reporting "succeeded but warning". Treat as harness inconclusive; investigate before believing the spec's GREEN.
10. **Semgrep rules: positive AND negative fixtures before rule lands in `repo-law`.** For each of the five rules, the fixture pair lands first. Run `semgrep scan` against each isolated fixture; positive fires, negative does not. Add `paths.exclude` to the real rule; run repo scan; clean. Inverting (real rule + repo scan before fixtures) risks shipping a rule that the repo scan already evaded, then fitting fixtures to match the wrong AST.
11. **Repo scan is the second-from-last check.** After all rules + fixtures are GREEN: `make repo-law` repo scan must return zero findings against the existing Day 1A/1B code. If a finding surfaces in current code, the finding is real — fix the code or scope the rule to exclude only the specific file with a documented reason; do not weaken the rule globally.
12. **Evidence capture is the last step.** Only after every spec is GREEN against the current HEAD. Compute SHA256s, write `manifest.json`, AJV-validate, verify `git_sha === git rev-parse HEAD` with a clean working tree. **Do not create evidence manifests until implementation has real artifacts and hashes.**

**False-pass watchlist:**

- A `before()` hook throwing (DB push failed, OTP-mint failed, spawned-server didn't bind) treated as a security RED. Investigate before believing the spec's RED.
- A test signed-in user accidentally reading rows through the admin client (e.g., via a closure capturing `H.admin` instead of `H.member.client`). Always grep the spec for `H.admin.from(...)` in assertion paths.
- A policy-shape regex matching the table name in a comment instead of an SQL token. Anchor against `pg_policies` row content; do not parse raw SQL.
- A passing INSERT-denial test where the row was nevertheless inserted. Always cross-check via admin probe — pattern at `tests/rls/workspace-write-denial.spec.ts:19-26`.
- A 500 response masquerading as a 4xx. Status code must be asserted explicitly; do not rely on "non-2xx" alone.
- The ephemeral-port harness's stale-server guard tripping silently if `lsof` is missing on the test machine — investigate as harness bug, not flaky test.

## Time budget (~5h)

| Window | Phase | Work |
|---|---|---|
| 0:00–0:45 | 1 | `supabase/migrations/002_channels_and_messages.sql` (tables, RLS enable+force, revoke from anon, SELECT/INSERT policies). Static SQL check via `migration-rls-enabled.spec.ts`. Apply to local stack. |
| 0:45–1:15 | 2 | `tests/rls/all-tables-have-rls.spec.ts` + `tests/rls/policy-shape.spec.ts`. Both GREEN against Phase 1 migration. |
| 1:15–1:45 | 3 | `lib/auth/with-channel-guard.ts` (three-condition lookup incl. `channels.workspace_id = workspace.id`). `tests/lib/supabase-test-harness.ts` extension (channelA1 + workspaceOnlyMember + channelB1 + member-as-channel_member-of-channelB1 + seed message). `tests/auth/guard-failure-modes.spec.ts` with denial-A (workspace-only), denial-B (cross-workspace binding), denial-C (unknown id) — byte-identical shape across A/B/C. GREEN. |
| 1:45–2:45 | 4 | `proxy.ts` refactor (remove `api404()`; pass-through `/api/*`). Re-run Day 1B specs; GREEN. Optional `lib/auth/request-origin.ts` extraction. `app/api/messages/route.ts` GET. `app/w/[workspaceSlug]/actions.ts` `sendMessageAction`. `app/w/[workspaceSlug]/page.tsx` modified. |
| 2:45–3:15 | 5 | `tests/api/route-contract.spec.ts` (five actor/path cases: channel-member 200; workspace-only 404; cross-workspace-channel-id 404; unknown-channel-id 404; non-workspace 404; byte-identical wire-equality assertion across the four 404 cases). `scripts/gen-api-contract.mjs`. Run; emit `docs/api-contract.md` (two response classes: 200, 404). |
| 3:15–4:00 | 6 | `tests/rls/channel-list-membership.spec.ts` (negative-first). `tests/auth/server-action-csrf.spec.ts`. `tests/auth/magic-link-replay.spec.ts`. `tests/util/run-isolation.spec.ts` (cuttable; defer if Phase 7 needs the slack). |
| 4:00–4:45 | 7 | `semgrep/repo-law/unguarded-route-query.yml` (safe antecedent = `withChannelGuard` only) + **6 positives (4 plan-enumerated + 2 derivative false-safe: withSession-only, withWorkspaceGuard-only)** + 1 negative. `no-service-role-in-jsx.yml` + fixtures. `no-raw-pg-client.yml` + fixtures. `fake-auth-bypass.yml` + fixtures (cuttable). `admin-client-boundary.yml` + fixtures (cuttable). Extend `Makefile repo-law` with one block per rule. |
| 4:45–5:00 | 8 | Four ADRs (substantive content). Extend `evidence/trust-boundary-paths.json` `globs`. Final review. **No commit unless explicitly authorized.** |

5h budget, 0h debug margin. If Phase 7 overruns, cut in plan-prescribed order: `admin-client-boundary.yml` → `fake-auth-bypass.yml` → `tests/util/run-isolation.spec.ts`. Each cut is logged in the closeout note. **Never cut from the floor list** (see §Cut discipline).

Plan §"Cut order" does not include Day 2A items above #2 (`scripts/recheck-precommit.sh` is Day 2B), so the cuttable surface is exactly three items. If those three cuts are insufficient, raise overrun to the user — do not invent new cuts.

## Exact file map

Migration:

| Action | Path | Purpose |
|---|---|---|
| Create | `supabase/migrations/002_channels_and_messages.sql` | Tables (`channels`, `channel_members`, `messages`), `enable + force RLS`, `revoke all from anon`, SELECT + INSERT policies per spec, `replica identity default` on `messages` (explicit). |

Auth/guards:

| Action | Path | Purpose |
|---|---|---|
| Create | `lib/auth/with-channel-guard.ts` | `withChannelGuard(workspaceSlug, channelId, fn)` HOF. Composes `withWorkspaceGuard`; verifies `channel_members` row for `(channelId, auth.uid())`. Redirect-to-`/` on deny. UUID-shape pre-DB rejection. Structured `logDeny`. |
| Create | `lib/auth/request-origin.ts` (optional, Phase 4) | Extracts `isSameOrigin` and `canonicalRedirectIfHostMismatch` from `app/login/actions.ts:15-44` if cross-server-action import is forbidden; otherwise omit. |
| Modify | `app/login/actions.ts` | Only if `lib/auth/request-origin.ts` is created: replace inline helpers with imports. Behavior unchanged. |

App routes:

| Action | Path | Purpose |
|---|---|---|
| Create | `app/api/messages/route.ts` | GET handler (paginated channel-scoped message read). Composed with `withSession` + channel-member verification. Trust-boundary file (covered by new `"app/api/**"` glob entry). |
| Create | `app/w/[workspaceSlug]/actions.ts` | `sendMessageAction(formData)` Server Action. Reuses `isSameOrigin` + `canonicalRedirectIfHostMismatch`. INSERT via user-scoped client (RLS WITH CHECK). `revalidatePath` + `redirect`. |
| Modify | `app/w/[workspaceSlug]/page.tsx` | Compose `withChannelGuard` after `withWorkspaceGuard`. Query messages (limit 50, ordered desc). Render messages + composer `<form action={sendMessageAction}>`. |

Proxy:

| Action | Path | Purpose |
|---|---|---|
| Modify | `proxy.ts` | Remove `api404()` helper (lines 40-44). Replace `/api/*` branch (lines 83-85) with `return securityHeaders(NextResponse.next({ request: req }));`. Keep `/w/*` auth-redirect logic untouched. Trust-boundary file. |

Tests:

| Action | Path | Purpose |
|---|---|---|
| Create | `tests/api/route-contract.spec.ts` | `node --test`; ephemeral-port `next start` harness; **five** actor/path cases for `GET /api/messages` (channel-member 200; workspace-only 404; cross-workspace-channel-id 404; unknown-channel-id 404; non-workspace 404); byte-identical wire-equality assertion across all four 404 cases. |
| Create | `tests/auth/magic-link-replay.spec.ts` | Admin-minted OTP consumed twice; second consumption asserted-failed. |
| Create | `tests/auth/server-action-csrf.spec.ts` | Cross-origin POST to `sendMessageAction`; assert redirect to `/login?error=origin`; admin probe confirms zero `messages` rows. |
| Create | `tests/auth/guard-failure-modes.spec.ts` | All three guards under denial; `withChannelGuard` denial-A (workspace-only), denial-B (cross-workspace binding — Finding 3), denial-C (unknown channel id); byte-identical redirect target + log reason category across A/B/C; never 500. |
| Create | `tests/rls/all-tables-have-rls.spec.ts` | Admin pg_catalog enumeration; `relrowsecurity` AND `relforcerowsecurity` true for every public table. |
| Create | `tests/rls/policy-shape.spec.ts` | Admin `pg_policies` query; substring assertions on `qual`/`with_check`; no UPDATE/DELETE policies on the three Day-2A tables. |
| Create | `tests/rls/channel-list-membership.spec.ts` | Three-actor on `channelA1`: in-channel sees, workspace-only-member sees zero, non-workspace sees zero. Cross-workspace sanity: `member` sees `channelB1` (RLS gates on membership, not workspace binding). Negative-actor case first. |
| Create | `tests/util/run-isolation.spec.ts` | Two sequential `setupHarness()` runs; no cross-bleed. **Cuttable.** |
| Modify | `tests/lib/supabase-test-harness.ts` | Extend `Harness` with `channelA1` (workspaceA), `workspaceOnlyMember` (workspaceA-only, no channel_members row), `channelB1` (workspaceB; `member` is a channel_members row), and one seed message in `channelA1`. New harness members are additive; existing members unchanged so Day 1A specs continue to pass. |

Repo-law:

| Action | Path | Purpose |
|---|---|---|
| Create | `semgrep/repo-law/unguarded-route-query.yml` | Real rule; "safe" antecedent narrowed to `withChannelGuard` only (NOT `withSession`, NOT `withWorkspaceGuard`); `paths.exclude` (tests, fixtures, evidence, .planning, .claude, node_modules, .next, docs). Floor item. |
| Create | `semgrep/repo-law/fixtures/unguarded-route-query.yml` | Self-firing fixture rule (no `paths.exclude`). |
| Create | `semgrep/repo-law/fixtures/unguarded-route-query-positive.test.ts` | **Six** positive fixture cases: 4 plan-enumerated "no guard at all" patterns (plan §230-233) + 2 Day-2A-derivative false-safe patterns (`withSession`-only, `withWorkspaceGuard`-only). `// ruleid:` markers on each. |
| Create | `semgrep/repo-law/fixtures/unguarded-route-query-negative.test.ts` | Guarded-route + guarded-Server-Action negatives, each wrapping the banned call inside `withChannelGuard(workspaceSlug, channelId, …)`. `// ok:` markers. |
| Create | `semgrep/repo-law/no-service-role-in-jsx.yml` | Real rule. Floor item. |
| Create | `semgrep/repo-law/fixtures/no-service-role-in-jsx.yml` | Self-firing fixture rule. |
| Create | `semgrep/repo-law/fixtures/no-service-role-in-jsx.test.tsx` | Positive + negative fixtures with markers. |
| Create | `semgrep/repo-law/no-raw-pg-client.yml` | Real rule. Floor item (OR-DB-3). |
| Create | `semgrep/repo-law/fixtures/no-raw-pg-client.yml` | Self-firing fixture rule. |
| Create | `semgrep/repo-law/fixtures/no-raw-pg-client.test.ts` | Positive + negative fixtures with markers. |
| Create | `semgrep/repo-law/fake-auth-bypass.yml` | Real rule. **Cuttable per plan cut order #3.** |
| Create | `semgrep/repo-law/fixtures/fake-auth-bypass.yml` | Self-firing fixture rule. **Cuttable.** |
| Create | `semgrep/repo-law/fixtures/fake-auth-bypass.test.ts` | Positive + negative fixtures. **Cuttable.** |
| Create | `semgrep/repo-law/admin-client-boundary.yml` | Real rule. **Cuttable per plan cut order #2.** |
| Create | `semgrep/repo-law/fixtures/admin-client-boundary.yml` | Self-firing fixture rule. **Cuttable.** |
| Create | `semgrep/repo-law/fixtures/admin-client-boundary.test.ts` | Positive + negative fixtures. **Cuttable.** |

Build/CI:

| Action | Path | Purpose |
|---|---|---|
| Modify | `Makefile` | Extend `repo-law` target with one block per new rule (positive probe + negative probe + repo scan). Mirror the existing Day 1A/1B block shape (lines 25-64). Reuse the `--exclude` set. No new top-level targets. |
| Verify | `package.json` | No new scripts. `test:db` may be re-invoked with the extended Day-2A spec list; the existing `test:db` script's argv is sufficient since `node --conditions=react-server --test` accepts additional files at invocation time. No new dependencies. |

ADRs / docs:

| Action | Path | Purpose |
|---|---|---|
| Create | `docs/decisions/auth.md` | Magic-link + cookie + redirect-allowlist + same-origin enforcement + sign-out decisions. |
| Create | `docs/decisions/server-guard-layer.md` | `withSession` → `withWorkspaceGuard` → `withChannelGuard` composition; HOFs over middleware; denial shape. |
| Create | `docs/decisions/realtime-test-lane.md` | Local Supabase stack chosen for Day 3 RLS-realtime tests. Day 2A prereq for Day 3. |
| Create | `docs/decisions/migrations.md` | Forward-only discipline, numbering, manual SECURITY DEFINER / broad-grant review. |
| Create | `docs/api-contract.md` | Generated from `tests/api/route-contract.spec.ts` via `scripts/gen-api-contract.mjs`. |

Generator script:

| Action | Path | Purpose |
|---|---|---|
| Create | `scripts/gen-api-contract.mjs` | One-shot reader of the route-contract spec. Emits `docs/api-contract.md`. Manual invocation; **no `package.json` script entry**. |

Evidence:

| Action | Path | Purpose |
|---|---|---|
| Modify | `evidence/trust-boundary-paths.json` | Append BOTH `"app/api/**"` AND `"app/w/**"` to `globs`. AJV-valid under existing schema. Trust-boundary edit (OR-Ev-1). |
| Verify | `evidence/manifest.schema.json` | `day` enum already includes `"2A"`. No edit. |

Closeout (at evidence-capture time only, NOT pre-created):

| Action | Path | Purpose |
|---|---|---|
| Create | `evidence/runs/day-2a-<n>/` | Run directory. `<n>` = smallest unused integer ≥ 1. |
| Create | `evidence/runs/day-2a-<n>/manifest.json` | AJV-valid, `day: "2A"`, real `git_sha` from `git rev-parse HEAD` post-commit, real SHA256 per artifact, `created_at` ISO timestamp. |
| Create | `evidence/runs/day-2a-<n>/<artifact>.txt` | Per-command stdout + exit-code footer for each Stop Condition command. |

## Validation commands

Only commands that already exist post-Day-1B or that this slice creates. **No invented runners** (no `pnpm test`, `vitest`, etc.).

```
# Static + governance gates (existing):
make fast-check
make repo-law                                # extended with five new rule blocks
make tools-version-check
pnpm install --frozen-lockfile
pnpm build

# Local Supabase stack (pre-requisite for DB-backed tests):
supabase start                               # local target only
supabase db reset                            # local target only; re-applies 001 + 002

# Test runs (existing patterns):
node --test tests/rls/migration-rls-enabled.spec.ts
node --conditions=react-server --test \
  tests/rls/all-tables-have-rls.spec.ts \
  tests/rls/policy-shape.spec.ts \
  tests/rls/channel-list-membership.spec.ts
node --conditions=react-server --test \
  tests/auth/guard-failure-modes.spec.ts \
  tests/auth/magic-link-replay.spec.ts \
  tests/auth/server-action-csrf.spec.ts
node --conditions=react-server --test tests/api/route-contract.spec.ts
node --conditions=react-server --test tests/util/run-isolation.spec.ts
node --test tests/security/headers.spec.ts             # Day 1B; re-run after proxy refactor
node --test tests/auth/cache-control.spec.ts           # Day 1B; re-run after proxy refactor

# Contract doc generation (Day 2A-new, one-shot):
node scripts/gen-api-contract.mjs > docs/api-contract.md

# Evidence chain (existing AJV + git):
pnpm exec ajv validate --spec=draft2020 \
  -s evidence/trust-boundary-paths.schema.json \
  -d evidence/trust-boundary-paths.json
pnpm exec ajv validate --spec=draft2020 \
  -s evidence/manifest.schema.json \
  -d evidence/runs/day-2a-<n>/manifest.json
git rev-parse HEAD                                     # tie to manifest.git_sha at closeout
```

**Local Supabase stack pre-requisite for DB-backed tests:**

- `supabase start` succeeded; `127.0.0.1:54321` reachable.
- `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_ANON_KEY=<local>`, `SUPABASE_SERVICE_ROLE=<local>` set, and the service-role JWT carries a `role` or `iss` claim matching `SUPABASE_PROJECT_REF` (per `lib/supabase/admin.ts:46-62` + `tests/lib/test-target-guard.ts:33-87`).
- `SUPABASE_PROJECT_REF` is in `DEV_PROJECT_REF_ALLOWLIST`.
- Migrations 001 + 002 applied to the local stack.

If the local stack is not running, DB-backed tests refuse to start via `assertTestTargetSafe()` (`tests/lib/test-target-guard.ts:43-50`). Treat refusal as a harness blocker, not a test failure.

## Cut discipline

Authoritative cut order from plan §"Cut order if scope slips" (lines 425-432):

1. `scripts/recheck-precommit.sh` — **Day 2B item. NOT cuttable from Day 2A.**
2. `semgrep/repo-law/admin-client-boundary.yml` — Day 2A. Cuttable.
3. `semgrep/repo-law/fake-auth-bypass.yml` — Day 2A. Cuttable.
4. `tests/util/run-isolation.spec.ts` — Day 2A. Cuttable.
5. `evidence/fixtures/block-verdict-trust-boundary/` — **Day 2B item. NOT cuttable from Day 2A.**

**Day 2A cuttable surface** (in cut order): `admin-client-boundary.yml` (+ fixtures) → `fake-auth-bypass.yml` (+ fixtures) → `tests/util/run-isolation.spec.ts`. Each cut is recorded in the closeout note with explicit "cut per plan §425-432 #X" reasoning. **If those three cuts are insufficient, raise overrun to the user — do not invent new cuts.**

**Day 2A floor — NEVER cut** (plan §"Never cut from above the floor" lines 433-450):

- `with-channel-guard` + message paths.
- `unguarded-route-query.yml` with four fixture patterns *(plan-floor minimum quoted verbatim from plan §443; Day 2A ships **six** total per Must Ship #9 — the four plan-enumerated patterns PLUS two Day-2A-derivative false-safe patterns)*.
- `no-service-role-in-jsx.yml`.

**Implicit Day 2A floor** (read from invariants — not literally on the floor list but tied to trust-boundary correctness):

- Migration `002_*.sql` with `enable + force RLS` and `revoke all from anon` on all three tables.
- `messages` SELECT policy joining `channel_members` (not `workspace_members`).
- `tests/rls/policy-shape.spec.ts` — proves the policy join shape.
- `tests/rls/channel-list-membership.spec.ts` workspace-only-member negative case — the data-leak proof.
- `tests/rls/all-tables-have-rls.spec.ts` — runtime RLS-on check; precondition for any policy claim.
- `no-raw-pg-client.yml` (OR-DB-3 invariant; week-1 architectural lock).
- `proxy.ts` `api404()` refactor — without this, `/api/*` routes are unreachable.
- The four ADRs — plan §220 names them as Day 2A deliverables; `realtime-test-lane.md` is also a Day 3 prereq (plan §271).

Do not invent new cuts. Do not silently defer floor items. Do not promote Day 2B items into Day 2A scope to "balance" a cut.

## Non-goals (Day 2A only)

- **No Day 2B work.** No `scripts/check-evidence.mjs`. No `scripts/run-claude-review.mjs`. No `scripts/recheck-precommit.sh`. No `scripts/check-workflow-hardening.mjs`. No `make governance-check` Makefile target. No `.claude/agents/authz-reviewer.md`. No `.claude/skills/vertical-slice/SKILL.md`. No `.claude/skills/authz-proof/SKILL.md`. No `.claude/settings.json` PreToolUse protected-file hook. No `.github/workflows/governance.yml`. No `evidence/fixtures/block-verdict-trust-boundary/`. No `.github/workflows/_fixtures/unsafe-pr-target.yml.fixture`. **Do not start Day 2B from this slice.**
- **No Day 3 realtime.** No Postgres Changes subscriptions. No `tests/realtime/*`. No `scripts/generate-access-matrix.mjs`. No publication tests. No JWT-revocation realtime test. No realtime Semgrep rules. The `realtime-test-lane.md` ADR is Day 2A; the implementation it enables is Day 3.
- **No search.** No `lib/search/**`. No search routes. No search schema.
- **No AI recap.** No `lib/recap/**`. No recap routes. No recap UI.
- **No DMs.** No threads. No reactions. No uploads. No notifications. No presence. No typing. No storage/uploads. No message DELETE. No message UPDATE. No account deletion. No data export. No MFA. No step-up auth. No member roster endpoint exposing emails. No Realtime Broadcast.
- **No new dependencies.** No request-schema libs (`zod`, `valibot`). No ORMs. No CSP libs. No HTTP-client libs. The Day-2A surface is small enough to assert by hand. If a dep is genuinely required, raise it to the user — do not add one silently. `pnpm install --frozen-lockfile` only; no `pnpm add` / `pnpm update`.
- **No client INSERT/UPDATE/DELETE policies.** Identity-table writes (`workspace_members`, `channel_members`) go through `lib/supabase/admin.ts` (service-role path) per CLAUDE.md §"Data model" + plan §69. **No client UPDATE/DELETE policies in week one.** Message INSERT is the only client-side write policy; message UPDATE / DELETE are intentionally absent.
- **No `SECURITY DEFINER` functions in app schemas.** Manual migration review per OR-DB-3. The Day 2A `002_*.sql` migration must not introduce any.
- **No `replica identity full` on `messages`.** OR-DB-1 + plan §69. The migration sets `replica identity default` explicitly (matches the default but surfaces intent for the Day-3 reviewer).
- **No fabricated evidence.** No fake SHA256s. No `git_sha` not equal to `git rev-parse HEAD` at evidence-check time. No `artifact_paths[]` entries pointing at missing files. No hand-written `claude-authz-review.json` or transcript files (the runner lands Day 2B; pre-Day-2B reviews are inline-only per CLAUDE.md §"Reviewer provenance"). **Do not create evidence manifests until implementation has real artifacts and hashes.**
- **No edits to Day 1A or Day 1B evidence runs.** No re-use of an existing `evidence/runs/day-1*/` directory. No rewrite of any past manifest, `git_sha`, or SHA256.
- **No commits, no PRs, no branch creation.** No `git push`, no `gh pr create`. No `pnpm install` without `--frozen-lockfile`.
- **No header changes from Day 1B.** The six required response headers (Cache-Control plus the five security headers) stay byte-for-byte identical. The `proxy.ts` refactor preserves them on the `/api/*` pass-through path; Day 1B specs continue to GREEN.
- **No new ADRs beyond the four named.** `docs/decisions/search-deferred.md` and `docs/decisions/recap-deferred.md` are Day 4 deliverables (plan §315). `docs/decisions/realtime.md` is Day 3 (plan §279).
- **No Playwright runner extension.** Playwright is wired to `next dev` only (`playwright.config.ts:41`). Day 2A specs use `node --test` or `node --conditions=react-server --test`, not Playwright. `test:e2e` is not modified.
- **No `pnpm test` / `vitest` / `jest` invention.** CLAUDE.md §"Commands" enumerates the allowed runners; no new runner is created. Day-2A test invocation extends the existing `node --test` invocation pattern.
- **No silent CSP relaxation.** If the new message UI fails to hydrate under `script-src 'self'`, escalate per Carry-forward #3. The CSP string is plan-locked.
- **No fabricated `unguarded-route-query.yml` fixture cases.** The plan enumerates four fixture patterns (plan §230-233). The Day 2A rule keeps those four verbatim AND adds exactly two Day-2A-derivative false-safe fixtures (`withSession`-only and `withWorkspaceGuard`-only — both required by the channel-vs-workspace invariant in CLAUDE.md §"Data model" + plan §80). Final positive fixture count: **6 = 4 plan + 2 derivative** (not five, not seven). The fixtures cite plan §230-233 in a header comment; the two derivative fixtures cite CLAUDE.md §"Data model" as their authority. No further fixtures.
- **No `app/api/[...slug]/route.ts` real catch-all route.** The catch-all is a Semgrep fixture pattern (#4 of the unguarded-route-query enumeration), not a production route. Day 2A does not introduce a catch-all under `app/api/`.

## Reviewer findings

### Previous reviewer PASS — SUPERSEDED

A first-round independent reviewer (general-purpose subagent, no prior conversation context) returned PASS on 15 questions. **That PASS is superseded by the second-round REQUEST CHANGES findings below, which surfaced three substantive gaps the first-round review missed (cross-workspace channel binding hole, Semgrep safe-pattern too weak, route-handler existence-probing) plus two scope tightenings (trust-boundary paths missing `app/w/**`; slop micro-fixes not yet applied). Treat the first-round PASS as stale.** It is retained here as audit trail only.

First-round confirmations that remained valid after the second round:
- All plan §211-237 build items expanded with file-anchored grounding (Must Ship #1-#9).
- All seven loophole-closer strings appear verbatim where the user specified.
- `messages` SELECT policy text joins `channel_members` (not `workspace_members`); negative-first TDD step 4 is load-bearing.
- Day 2 Stop Condition cleanly split (Day 2A slice green vs Day 2 full close).
- AGENTS.md `Codex-…` filename mismatch surfaced and ruled (substantively equivalent to CLAUDE.md).
- Cut discipline uses plan §425-432 verbatim.

### Second-round review — REQUEST CHANGES (six findings, all applied)

Second-round reviewer (fresh subagent on the same doc, no prior context). Surfaced six findings the first round missed or did not press on:

**Finding 1 — Slop WARN micro-fixes (three exact-text edits).** Applied:
- Carry-forwards #2 multiplier framing: corrected to "raising the Makefile's total `semgrep scan` count from 4 to 9" — the prior framing implied a multiplier against a baseline of 1, but Day 1A + Day 1B already established 4 invocations, so the accurate increment is 4→9.
- Must Ship intro item-count mismatch: corrected to "Items 1-9 are plan-authoritative; the trust-boundary-paths extension (item 10) and `proxy.ts` refactor (item 11) are Day 2A-derivative" — the prior intro miscounted the plan-authoritative items as 1-8, but item 9 (repo-law rules from plan §229-237) is itself plan-authoritative; only items 10 and 11 are Day 2A-derivative.
- TDD step 1 muddled trailing sentence: deleted. The deleted sentence asserted that, in the absence of the static SQL check, a runtime RLS check would still pass while the policy-shape check would surface a confusing error — the parenthetical undercut the premise (if RLS-on is already verified at runtime, the static check adds no signal); the prior sentence already carries the precondition point.

**Finding 2 — Trust-boundary path gap.** Applied: trust-boundary `globs` extension now adds BOTH `"app/api/**"` AND `"app/w/**"`. Day 2A creates `app/w/[workspaceSlug]/actions.ts` (Server Action with `messages` INSERT) AND modifies `app/w/[workspaceSlug]/page.tsx` (renders messages, composes guard chain) — both message paths. The broader `app/w/**` was chosen over narrower `app/w/**/actions.ts` + `app/w/**/page.tsx` so future workspace-shell files (`layout.tsx`, `loading.tsx`, additional Server Actions, client-component splits) inherit Day-2B paired-review coverage automatically.

**Finding 3 — Cross-workspace channel binding hole.** Applied: §Must Ship #3 `withChannelGuard` now requires THREE conditions in a single user-scoped query — `channels.id = channelId` AND `channels.workspace_id = workspace.id` AND `channel_members` row for `(channelId, user.id)`. Closes the confused-deputy where a workspaceA member who is also a `channel_members` row of `channelB`-in-workspaceB could bind `channelB` into a `/w/<workspaceA>/<channelB.id>` request context. Denial path collapses three deny reasons (not found, foreign workspace, not channel_member) into a single redirect target AND single log reason category; no admin probe (would leak existence). `tests/auth/guard-failure-modes.spec.ts` adds denial-B (cross-workspace) and denial-C (unknown channel) with byte-identical-shape assertions. Harness extension adds `channelB1` seed to support the test. TDD step 5 elevates denial-B to load-bearing.

**Finding 4 — Semgrep `unguarded-route-query.yml` safe pattern too weak.** Applied: the rule's "safe" antecedent is narrowed to `withChannelGuard` only (NOT `withSession`, NOT `withWorkspaceGuard`). Positive fixture count moves from 4 to 6: the 4 plan-enumerated patterns (plan §230-233) PLUS 2 Day-2A-derivative false-safe patterns (`withSession`-only path and `withWorkspaceGuard`-only path against any of messages/channels/channel_members). The derivative fixtures cite CLAUDE.md §"Data model" + plan §80 (workspace membership ≠ channel access) as their authority. Non-goals updated to reflect the 4+2=6 count.

**Finding 5 — `GET /api/messages` existence probing.** Applied: §Must Ship #6 `docs/api-contract.md` now declares exactly TWO wire-distinguishable response classes — `200 + messages[]` for the channel-member-in-bound-workspace case ONLY; `404 + {}` for every other case. The four inaccessible cases (unknown channel id, cross-workspace, workspace-only, non-workspace) all return byte-identical `404 + {}`. Choice rationale (404-for-all): matches `with-workspace-guard.ts:54-66` discipline (uniform redirect to `/`). User-scoped reads only; no admin probe. `tests/api/route-contract.spec.ts` updated to five actor/path cases with byte-identical wire-equality assertion across Cases B/C/D/E.

**Finding 6 — AI-slop-cleaner section placeholder.** Filled below.

### Fresh independent reviewer verdict (post-Findings-1-through-6 fixes)

A fresh independent reviewer (new subagent, no prior conversation context, explicitly instructed NOT to rely on the superseded first-round PASS) reviewed the doc after Findings 1-6 were applied. Verdict: **WARN**, converted to **PASS** after four mechanical stale-string fixes.

Q1 (each of Findings 1a/1b/1c/2/3/4/5/6 fixed): all PASS, each citing the section where the fix lives.
Q2 (new loopholes from the revisions): all PASS — harness extension safe against existing Day 1A specs; `proxy.ts` refactor preserves Day 1B header byte-equality; Server-Action 404 vs Route-Handler 404 surfaces internally consistent (each byte-collapsed within its surface); Semgrep narrowing won't false-fire on identity-only Server Actions like `signOutAction`; `app/w/**` over-cover is intentional and documented (pre-Day-2B harmless; Day 2B implication of paired-review on UI-only files acknowledged).
Q3 (planning-only scope preserved): PASS — every entry in the file map is Create/Modify/Verify with file path + purpose; no implementation code introduced.
Q4 (Day 2A vs Day 2B/Day 3 discipline preserved): PASS on all five sub-checks (cut order verbatim; Day 2B harness items enumerated and excluded; Day 3 realtime / search / recap excluded; four plan-named ADRs present; eight plan-named tests present).
Q5 (doc safe for Day 2A implementation): **WARN** — four stale-string artifacts in §Time budget and §Cut discipline floor list that an implementer pacing by the budget table could under-build against.
Q6 (additional issues): one — the §Day 2A floor line quoted the plan-floor minimum ("four fixture patterns") verbatim, which could mislead a cut-discipline-aware implementer into shipping only four (regressing Finding 4).

**Four mechanical fixes applied in response to the WARN:**

1. §Time budget Phase 3 row: added `channelB1` to the harness-extension list (was missing despite §Reconciliation #9 and §Sequencing Phase 3 already requiring it).
2. §Time budget Phase 5 row: route-contract spec actor-case count corrected upward — the prior row was stale from the pre-Finding-5 draft (which enumerated only 3 cases against a 200/403/404 distinction); after the existence-probing collapse, the spec has five actor/path cases (channel-member 200; workspace-only 404; cross-workspace 404; unknown 404; non-workspace 404) with byte-identical wire-equality assertion across the four 404 cases.
3. §Time budget Phase 7 row: positive-fixture count corrected from "4 positives" to "6 positives (4 plan-enumerated + 2 derivative false-safe: `withSession`-only, `withWorkspaceGuard`-only)" with the safe-antecedent narrowing noted (was stale from pre-Finding-4 draft).
4. §Day 2A floor entry: added an inline parenthetical clarifying that "four fixture patterns" is the plan-floor minimum (quoted verbatim from plan §443) and that Day 2A ships **six** per Must Ship #9 — preventing a cut-discipline-aware implementer from interpreting the floor as the ship target.

The reviewer's bottom-line summary explicitly stated that once those four micro-edits land, the verdict is a clean PASS. With all four mechanical fixes now applied, the WARN is resolved by reviewer-defined criterion — no second-round re-dispatch necessary (the fixes are exact-match-applied to the reviewer's recommended targets).

## AI-slop-cleaner findings

Two slop passes ran on this doc.

### Pass 1 — initial draft (review-only)

WARN-level findings (three; all later applied in the second-round review fixes):
1. Carry-forwards #2 multiplier framing — misleading given existing 4 Makefile invocations; corrected to the 4-to-9 count.
2. §Must Ship intro item-count mismatch — the prior intro miscounted plan-authoritative items as items 1 through 8, but the actual Must Ship list has 11 items and items 1 through 9 are plan-authoritative.
3. §TDD step 1 trailing sentence muddled — contradicted its own premise.

Preserve-decisions (intentionally retained, validated by Pass 2):
- "Resolves wording mismatches" reconciliation intro — Day 1B precedent.
- "load-bearing" phrasing — idiomatic engineer term, not AI-ese.
- All file-anchor citations (`proxy.ts:42-44`, `lib/auth/with-workspace-guard.ts:54, 66`, `tests/security/backdoor-production-blocked.spec.ts:26-39`, etc.) — receipts, not slop.
- Plan-locked items verbatim: RLS policy text, six required response headers (Day 1B carry-forward), CSP string (Day 1B carry-forward), four ADR names, eight test names, repo-law rule names.
- Seven loophole-closer phrases verbatim — user-required.
- §Day 2A Stop Condition slice-green vs Day-2-full split — load-bearing scope discipline.
- §TDD step 4 negative-first ordering rationale — load-bearing data-leak proof.
- Long §Non-goals list — each bullet prevents a concrete scope drift.
- Semgrep "pattern-inside" hand-wave — planning-doc-appropriate abstraction.

### Pass 2 — post-second-round-fixes (review + apply)

Verified all three Pass 1 WARN fixes applied correctly. No new WARN-level slop introduced by the substantive Finding-2/3/4/5 edits. New-content audit:

- §Reconciliation #9 (harness extension): four bullets now (added `channelB1` seed for cross-workspace test) — necessary for Finding 3 coverage; not slop.
- §Reconciliation #12 (trust-boundary `app/w/**` rationale): broader-glob rationale added — three sentences explaining the choice over narrower globs; preserved as load-bearing for future Day-2B paired-review coverage.
- §Must Ship #3 (cross-workspace binding): denial-collapse paragraph and admin-probe ban are load-bearing security detail; preserved.
- §Must Ship #4 (existence-probing collapse): user-scoped-reads-only constraint and 404-rationale are load-bearing; preserved.
- §Must Ship #9 (false-safe fixtures 5 and 6): citation to CLAUDE.md §"Data model" + plan §80 as derivative authority is load-bearing; preserved.
- §TDD steps 5 + 6 (load-bearing denial-B and Case-C false-pass guards): preserved.

No further WARNs. No removals beyond the three Pass-1 micro-edits. No retained-intentionally items demoted.
