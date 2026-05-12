# Day 2A — Phase 2: Runtime RLS + policy-shape proofs

Source: `docs/tasks/day-2a-trust-boundary-data-path.md` §"Phase 2 — Policy-shape tests" + §"Sequencing Phase 2".
Status: slice contract derived from the broad Day 2A doc plus current repo state at 2026-05-12.
Predecessor: Phase 1 (slice 1) — `supabase/migrations/002_channels_and_messages.sql` (OMX-reviewed at slice-1 close; subject to a forward-only edit during this slice if review revealed a defect, per §"If a test goes RED").

## Current repo state assumed

Verified at slice-doc authoring time:

- `main` was synced with `origin/main`; no tracked diff at authoring time.
- `supabase/migrations/002_channels_and_messages.sql` was on disk as the freshly OMX-reviewed Slice 1 output. While uncommitted, the file is forward-only-editable in place (forward-only-migrations is a week-1 invariant in `CLAUDE.md` §"Data model" and the broad Day 2A doc §"Locked Invariants"; the dedicated `docs/decisions/migrations.md` ADR is a Day-2A Phase-8 deliverable, not yet authored at this slice's authoring time). Once committed, only a new numbered migration can alter the file. The halt/escalate rule below assumes "uncommitted" as a precondition for case-3, not a snapshot of any specific point in time.
- `supabase/migrations/001_workspace_identity.sql` was already committed.
- `tests/lib/supabase-test-harness.ts` has the Day-1A shape (`member`, `nonMember`, `workspaceA`, `workspaceB`, `admin`, `anon`); **no channel / channel_members / messages seeding yet** — that lands in Phase 3.
- `tests/lib/test-target-guard.ts` refuses non-local Supabase targets via `SUPABASE_URL` host allowlist + service-role JWT `ref`/`iss` claim binding.
- Day 1A specs (`workspace-select-membership.spec.ts`, `workspace-write-denial.spec.ts`) rely on the existing harness shape and `H.admin.from(...)` calls.
- `package.json` defines `test:db = node --conditions=react-server --test tests/rls/workspace-select-membership.spec.ts tests/rls/workspace-write-denial.spec.ts tests/auth/workspace-guard.spec.ts`. Phase 2 specs will be invoked directly (file paths after `--test`), not via a new `package.json` script entry.
- `supabase/config.toml:13` exposes only `public, graphql_public` schemas via PostgREST. **`pg_catalog` is NOT reachable via `supabase-js.from(...)`** — Phase 2 reads need a different path.
- `psql 18.3` is on `PATH` at `/opt/homebrew/opt/libpq/bin/psql`.
- The local Supabase stack is **stopped** (`supabase status` reports the db container exited). The Phase 2 implementer must start the stack and apply migrations before running these tests.
- `pg` (node-postgres) is NOT a project dependency. Adding it is a `pnpm add` approval gate per CLAUDE.md §"Approval-required actions".

## Scope: Phase 2 ONLY

Implement two runtime DB-backed test files that prove, against the live local stack with migration 002 applied, that:

1. Every public table has `enable row level security` AND `force row level security` set at the catalog level.
2. The `channels`, `channel_members`, and `messages` policies have the correct shape — `auth.uid()` + `channel_members` substring in policy expressions; no UPDATE/DELETE/ALL policies.

**SUPERSEDED for production by Phase 2.5.** The substring contract above is the Phase 2 baseline. After Phase 2 closed OMX review with five blockers, the predicate-shape and grant assertions were tightened in `docs/tasks/day-2a-phase-2.5-blocker-fixes.md`: exact normalized `qual` / `with_check` equality replaces substring matches, and the grant matrix extends to all five app tables. Phase 2's stop condition is reachable only through Phase 2.5; read this doc as scope-history plus baseline assertions, then read the Phase 2.5 doc for the live contract.

No other code changes. No harness extension. No new dependencies. No migration edits unless tests reveal a real defect in Phase 1 (escalation path below).

## Allowed edits

Phase 2 baseline:

- Create `tests/rls/all-tables-have-rls.spec.ts`
- Create `tests/rls/policy-shape.spec.ts`

**Phase 2.5 supersession** (`docs/tasks/day-2a-phase-2.5-blocker-fixes.md` §"Allowed edits"): the Phase-2.5 implementation expands the surface to also include `supabase/migrations/003_harden_workspace_acl.sql` (Create), in-place tightening of both spec files above, narrow truth-up edits to this doc and `docs/tasks/day-2a-trust-boundary-data-path.md`, and a conditional forward-only edit to `supabase/migrations/002_channels_and_messages.sql` (only if Phase 2.5 work surfaces a Day-2A-table ACL/policy defect; halt-and-escalate path). The Phase 2.5 doc is authoritative for the live edit surface.

## Do not edit (out of slice)

- `supabase/migrations/**` — Slice 1's `002_*.sql` was OMX-reviewed. If Phase 2 reveals a real defect, halt and escalate per §"If a test goes RED" below; do not silently rewrite. As long as the migration is uncommitted, forward-only edits to it ARE technically legal (the forward-only-migrations invariant in `CLAUDE.md` §"Data model" permits in-place edits to an uncommitted migration); once committed, the only legal path is a new numbered migration. Either way, the OMX review is a soft contract — preserve the reviewed shape unless escalation authorizes a change.
- `tests/lib/**` — harness extension (channelA1, channelB1, workspaceOnlyMember, seed message) is **Phase 3** scope. These Phase 2 tests must work without those seeds.
- `tests/util/**`
- `tests/auth/**`, `tests/api/**`, `tests/security/**` — unrelated to Phase 2 surface.
- `lib/**`
- `app/**`
- `proxy.ts`, `middleware.ts`
- `Makefile`
- `package.json` — no new dev deps, no new scripts.
- `docs/decisions/**`
- `docs/api-contract.md`
- `semgrep/**`
- `evidence/**`

## Prerequisite: local Supabase stack running with migration 002 applied

The implementer must verify, before running these tests:

1. `supabase start` has succeeded. `supabase status` reports the db container running. `127.0.0.1:54322` (Postgres) is reachable.
2. Migration `002_channels_and_messages.sql` has been applied. The cheapest verification: a `supabase db reset` from a clean state re-applies `001_*.sql` then `002_*.sql`. Or `supabase migration up --local`. Catalog check: `psql ... -c "\dt public.*"` lists `workspaces`, `workspace_members`, `channels`, `channel_members`, `messages`.
3. The Phase 2 tests do **not** use `setupHarness()` — they need only catalog reads, not seeded users/workspaces. The `tests/lib/test-target-guard.ts` host-allowlist is therefore not consulted; the tests enforce locality independently in their own subprocess helper (see §"Decision").

If any prereq is missing, halt and report. Do not invent test data. Do not stub the DB. Do not skip the prereq.

## Decision: spawn `psql` as a subprocess (no shell)

Phase 2 needs to read `pg_class.relrowsecurity`, `pg_class.relforcerowsecurity`, and `pg_policies.{qual, with_check, cmd}`. Three paths considered:

| Option | Cost | Decision |
|---|---|---|
| **A. `pg` (node-postgres)** | `pnpm add pg` — approval-required per CLAUDE.md. Phase 7's planned `semgrep/repo-law/no-raw-pg-client.yml` will need `paths.exclude` for `tests/**`. Cleanest test code. | **Rejected** — escalation cost, deferred dep decision, future-rule coupling. |
| **B. Introspection views in a new `003_*.sql` migration** | Expands the PostgREST-exposed schema to leak `pg_class` / `pg_policies` contents to any authenticated user. Real info-disclosure expansion of the auth model (policy expressions reveal the auth shape). | **Rejected** — security regression for test convenience. |
| **C. Spawn `psql` as a subprocess** | No new deps. No new migrations. `psql 18.3` already on host PATH. Uses the local stack's well-known direct-Postgres port (`54322`) with well-known supabase-local creds (`postgres:postgres`). Locality enforced in the helper. | **Chosen.** |

**Implementation constraint (load-bearing):** the subprocess invocation MUST use the array-args / no-shell variant of Node's process-launching API. Pass the `psql` binary as the first argument and an array of `psql` arguments as the second; do not pass a single shell-interpreted string. This is structurally immune to command injection because no shell is involved. The contract: never construct a shell command line by string concatenation — always pass argv as a fixed array. SQL strings interpolated into the array are passed verbatim as the value of a `-c` argument, not parsed by a shell.

**Helper signature** (duplicated in each spec file — Phase 2 do-not-edit forbids extracting to `tests/lib/`; duplication is removable in Phase 3):

```
function psqlQuery(sql: string): string[][]
```

Returns rows as arrays of tab-separated string cells. Internally:

1. Resolves `dbUrl` from `process.env.DATABASE_URL`, defaulting to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
2. Parses `dbUrl` as a URL; **refuses** any host not in `{ "127.0.0.1", "localhost", "::1" }` with a clear thrown error before invoking the subprocess.
3. Invokes `psql` with argv `[ dbUrl, "-t", "-A", "-F", "\t", "-c", sql ]`. Flags: tuples-only, unaligned, tab field separator.
4. Splits stdout on newlines, drops the empty trailing line, splits each row on `\t`.
5. Non-zero subprocess exit propagates as a thrown `Error` (loud failure, never silent skip).

**Forward concern (logged, not fixed in Phase 2):** Phase 7's `semgrep/repo-law/no-raw-pg-client.yml` bans `pg` imports outside `lib/supabase/admin.ts`. A `psql` subprocess invocation is **not** a `pg` import — it is a `child_process` API call. The Phase 7 rule pattern (`import {Client, Pool} from 'pg'`, `require('pg')`, `new pg.Client(...)`) does not match subprocess spawning. No Phase 7 rule coupling.

**Forward concern (logged, not fixed in Phase 2):** if the Phase 3 harness extension exposes a typed catalog-read helper via `supabase-js` `.rpc()` against a future RPC function, the duplicated `psqlQuery` helpers can be deleted. Phase 2 does not block that future.

## Test file 1: `tests/rls/all-tables-have-rls.spec.ts`

**Purpose:** runtime proof that every public table has `relrowsecurity = true` AND `relforcerowsecurity = true` at the catalog level. Catches drift if a future migration creates a table without `enable + force RLS`.

**Pattern alignment:**
- Imports `node:test` (`test`), `node:assert/strict`, `node:child_process` (subprocess API in its no-shell variant), `node:url` (`URL`).
- Does **not** import the harness.
- Uses the `psqlQuery` helper defined above.

**Assertions:**

1. The query `SELECT c.relname, c.relrowsecurity::text, c.relforcerowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname` returns at least the five Day-2A tables: `workspaces`, `workspace_members`, `channels`, `channel_members`, `messages`. If any is missing, the test fails with a clear `missing public table: <name>` message.
2. For every returned row, `relrowsecurity` is `'t'` and `relforcerowsecurity` is `'t'`. If any row has either as `'f'`, fail with `table <name>: enable row level security is OFF` or `table <name>: force row level security is OFF`.
3. No assertion on row count upper bound — Supabase may add catalog tables in `public` over time (unlikely for week 1, but a strict equality would be brittle). Lower bound is the floor.

**False-pass guards:**
- The `enabled`/`forced` columns are projected via `case when X then 't' else 'f' end` in the SQL so the parsed values are `'t'` / `'f'` strings — explicit, not JavaScript booleans that could coerce unexpectedly through the tab-separated output. Note: `boolean::text` in Postgres 17 returns `'true'`/`'false'` (the canonical SQL textual form), not `'t'`/`'f'`; that's a `psql` *display* convention, not a cast result. The `case when` form makes the contract independent of `boolean::text` semantics.
- A non-zero subprocess exit (e.g., stack not running) propagates as a thrown `Error`. The test fails loudly with the underlying `psql` error message — never a silent skip.

## Test file 2: `tests/rls/policy-shape.spec.ts`

**Purpose:** runtime proof that the Day-2A policy expressions have the correct shape. Anchors substring assertions against `pg_policies` row content — not against raw migration SQL — so a regex matching the substring inside a comment is structurally impossible.

**Pattern alignment:** identical to Test 1 (top of file). The `psqlQuery` helper is duplicated, per §"Decision".

**Assertions, in order. Each predicate-shape assertion pins three things: the SOURCE table (`FROM channel_members cm`), the exact correlation predicate, and the exact user binding. Substring presence alone is insufficient — a bogus policy aliasing a different source table as `cm` would false-pass if only alias predicates were checked.**

**SUPERSEDED by Phase 2.5.** Assertions 1–4 below are the Phase-2 baseline (substring-presence). Phase 2.5 replaces them with exact normalized `qual` / `with_check` equality (Option A only) against canonical forms captured from the live local stack — see `docs/tasks/day-2a-phase-2.5-blocker-fixes.md` §Blocker 1 / §Blocker 2. Assertions 7–10 (grants matrix + negative privilege matrix) are Phase-2 baseline scoped to the three Day-2A tables; Phase 2.5 extends them to all five app tables (workspaces, workspace_members, channels, channel_members, messages) after migration 003 hardens the workspace-table ACLs.

1. **`channels` SELECT policy:** `pg_policies` row with `schemaname='public' AND tablename='channels' AND cmd='SELECT'` exists; its `qual` (after whitespace normalization) contains ALL of:
   - `FROM channel_members cm` (source table pinned)
   - `cm.channel_id = channels.id` (channel correlation)
   - `cm.user_id = auth.uid()` (user binding)
   AND contains NEITHER `workspace_members` NOR a top-level `\bOR\b` token.
2. **`channel_members` SELECT policy:** `pg_policies` row with `tablename='channel_members' AND cmd='SELECT'` exists; its `qual` contains `user_id = auth.uid()`. No subquery, no source-table assertion needed. Also contains NEITHER `workspace_members` NOR `\bOR\b`.
3. **`messages` SELECT policy:** `pg_policies` row with `tablename='messages' AND cmd='SELECT'` exists; its `qual` contains ALL of `FROM channel_members cm`, `cm.channel_id = messages.channel_id`, `cm.user_id = auth.uid()`; contains neither `workspace_members` nor `\bOR\b`. **This is the load-bearing channel-vs-workspace boundary assertion.**
4. **`messages` INSERT policy:** `pg_policies` row with `tablename='messages' AND cmd='INSERT'` exists; its `with_check` (NOT `qual` — INSERT-only policies have null `qual`) contains ALL of `FROM channel_members cm`, `user_id = auth.uid()` (author identity), `cm.channel_id = messages.channel_id`, `cm.user_id = auth.uid()` (membership user binding); contains neither `workspace_members` nor `\bOR\b`.
5. **Exact policy set on the three tables.** `pg_policies` rows for `tablename IN ('channels','channel_members','messages')` ORDER BY tablename, cmd, policyname deep-equal exactly four rows: `(channel_members, channel_members_select_self, SELECT, {authenticated})`, `(channels, channels_select_member_only, SELECT, {authenticated})`, `(messages, messages_insert_self_and_member, INSERT, {authenticated})`, `(messages, messages_select_channel_member, SELECT, {authenticated})`. Any extra policy — including a hidden permissive `cmd='ALL'` or a duplicate of an existing command — fails the test.
6. **No UPDATE / DELETE / ALL policies** on the three tables (defense-in-depth — the exact-set test above already rejects them; this surfaces the week-1 invariant directly).
7. **`authenticated` has exactly the minimal SQL grants**: deep-equal against `information_schema.role_table_grants` ordered by table_name, privilege_type: `(channel_members, SELECT)`, `(channels, SELECT)`, `(messages, INSERT)`, `(messages, SELECT)`. Any extra grant — UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER — fails the test.
8. **`anon` has zero SQL grants** on the three tables.
9. **`PUBLIC` has zero SQL grants** on the three tables. PUBLIC is the pseudo-role every role implicitly inherits; a leak to PUBLIC would propagate to authenticated AND anon simultaneously without surfacing in the per-role tests above. Migration 002 explicitly `revoke all ... from public` as defense-in-depth.
10. **No dangerous privileges leaked to anon, authenticated, or PUBLIC**: zero rows in `information_schema.role_table_grants` where `grantee IN ('anon','authenticated','PUBLIC','public')` AND `privilege_type IN ('UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')`. `service_role` is intentionally excluded (it holds these privileges as the trusted BYPASSRLS administrative role).

**False-pass guards (Phase-2 baseline — superseded by Phase 2.5):**
- Each assertion checks the row exists (`rows.length >= 1`) before substring-matching, so a missing policy fails with `<table> has no <cmd> policy` instead of a confusing "undefined doesn't include 'auth.uid()'".
- Substring matches are case-sensitive and use exact strings (`'auth.uid()'` includes the parens). PG's pg_node_tree text rep preserves the function-call form `auth.uid()`.
- For INSERT-policy `with_check` assertion: the row's `with_check` field is non-empty (post-whitespace-normalization) before substring-matching (INSERT policies have null `qual` and non-null `with_check`; we want the latter shape).
- The UPDATE/DELETE/ALL check is a positive enumeration query, not a derived "is anything missing." A new ALL policy added in any future migration immediately fires this test.
- `qual` and `with_check` are pretty-printed across newlines in PG's pg_node_tree text rep. The helper SQL applies `regexp_replace(col, '[[:space:]]+', ' ', 'g')` to normalize whitespace before returning, so substring assertions are immune to embedded newlines (which would otherwise truncate at the tab-line parser).

**Phase 2.5 superseding contract** (`docs/tasks/day-2a-phase-2.5-blocker-fixes.md`):
- The four predicate-shape assertions use exact normalized `qual` / `with_check` equality (Option A only). Substring-plus-structural-rejection (Option B) is explicitly rejected — it cannot reject tacked-on top-level AND clauses (F-2) or alternate broad EXISTS / UNION paths (F-3 / F-5).
- The top-level `messages.user_id = auth.uid()` author predicate is proven structurally distinct from the membership subquery's `cm.user_id = auth.uid()` by construction of the canonical with_check string.
- Grant matrix covers all five app tables, not just the three Day-2A tables.
- Helper tightening (Blocker 4): the duplicated `psqlQuery` guard checks local host AND port `54322` AND db `postgres`; empty port and empty pathname are rejected loudly.

## Validation

After both test files exist:

```bash
# Prereq verification (manual):
supabase status                # db container "Running"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\dt public.*"
# Expected: workspaces, workspace_members, channels, channel_members, messages

# Phase 2 specs:
node --test tests/rls/all-tables-have-rls.spec.ts tests/rls/policy-shape.spec.ts

# Whitespace / merge-marker check on working tree:
git diff --check

# Slice 1 regression (static SQL grep over migrations):
node --test tests/rls/migration-rls-enabled.spec.ts
```

Do **not** run, in Phase 2:

- The full Day 2A test sweep.
- `pnpm build`.
- `make repo-law`, `make fast-check`, `make tools-version-check`.
- Day 1B header specs (`tests/security/headers.spec.ts`, `tests/auth/cache-control.spec.ts`).
- Day 1A workspace specs (`tests/rls/workspace-select-membership.spec.ts`, `tests/rls/workspace-write-denial.spec.ts`) — those exercise the harness and may surface unrelated noise if env vars or stack state changed.
- Day 2B governance, Day 3 realtime, route handlers, browser flows.

Re-run the Day 1A regression suite only if Phase 2 surfaces something suspect.

## If a test goes RED

Strict order of investigation before any edit:

1. **Stack not running** → subprocess throws ENOENT or psql connection refused. Resolve via `supabase start`. Not a test bug.
2. **Migration 002 not applied** → catalog query returns < 5 tables, or no rows for `channels`/`messages`. Resolve via `supabase db reset` (re-applies 001+002 from disk). Not a test bug.
3. **Real defect in the migration** → a policy is missing `auth.uid()` substring, or `messages` SELECT joins `workspace_members` instead of `channel_members`, or a table is missing `force row level security`. **If the Phase 1 (Slice 1) migration is still uncommitted**, a forward-only in-place edit IS legal; once committed, the only legal path is a new numbered migration (`003_*.sql`). Either way, the OMX review is a soft contract — escalate to the user with the specific defect, the proposed fix, and the diff before editing 002. Do not silently rewrite.
4. **Real defect in the test** → assertion phrased against the wrong column name (e.g., `forcerls` vs `relforcerowsecurity`), wrong substring case, wrong SQL spelling. Fix the test file.

The "halt-and-escalate" path for case 3 is load-bearing: silently mutating an OMX-reviewed file would void the review and create a "phantom slice 1" condition where the committed-eventually state differs from what was reviewed.

## Stop condition

Phase 2 was BLOCKED at OMX review with five named blockers. **Phase 2's stop condition is reachable only through Phase 2.5** (`docs/tasks/day-2a-phase-2.5-blocker-fixes.md`); the bullets below describe the Phase-2 baseline criteria, but the live gate is Phase 2.5's stop condition.

Phase 2 (baseline, superseded) is GREEN when all of the following hold:

1. Both `tests/rls/all-tables-have-rls.spec.ts` and `tests/rls/policy-shape.spec.ts` exit 0 under `node --test`, against the local stack with migration 002 applied. **Phase 2.5 additionally requires migration 003 applied and the Option-A exact-equality contract.**
2. `git diff --check` exits 0.
3. `node --test tests/rls/migration-rls-enabled.spec.ts` continues to exit 0 (slice 1 static-grep regression).
4. No files outside the allowed-edits list are modified. **Phase 2.5's allowed-edit surface supersedes the Phase-2 list.**
5. No `pnpm add` / `pnpm install` / `git commit` performed.

## Stop after reporting

- Files changed.
- Commands run + exit status (including any prereq commands such as `supabase start` and `supabase db reset`).
- Slice verdict: **GREEN** / **PARTIAL** / **BLOCKED**.
- Whether prereq (start + apply) had to be performed, and the exact commands.
- Remaining next slice: **Phase 3** — `lib/auth/with-channel-guard.ts` + `tests/lib/supabase-test-harness.ts` extension (channelA1, workspaceOnlyMember, channelB1, seed message) + `tests/auth/guard-failure-modes.spec.ts` (denial-A/B/C byte-identical shape).
- **No commit unless explicitly authorized.**

## Non-goals (Phase 2 only)

- No Phase 3 `withChannelGuard`.
- No harness extension.
- No app code changes.
- No `proxy.ts` refactor.
- No new dependencies (no `pg`, no `zod`, no anything).
- No new migration (003+).
- No `package.json` script changes.
- No Makefile changes.
- No semgrep rule changes.
- No evidence files.
- No commits, no PRs, no branch creation.
- No Day 1A regression sweep unless Phase 2 surfaces something suspect.
