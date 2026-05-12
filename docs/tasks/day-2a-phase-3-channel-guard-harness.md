# Day 2A — Phase 3: `withChannelGuard` HOF + harness extension + denial-shape proof

Source: `docs/tasks/day-2a-trust-boundary-data-path.md` (broad Day 2A doc) §"Phase 3", scoped down by Phase-2 and Phase-2.5 OMX-review outcomes. Phase 2.5 closed at HEAD `31e2ff8`; Phase 3 is the next named slice.

Status: **planning-only slice contract.** Phase 3 implementation is BLOCKED until this contract receives independent review PASS. Phase 4 (route handlers, server actions, proxy refactor) remains BLOCKED until Phase 3 implementation passes its own review.

## Stop Condition

Phase 3 has **three gates**. All must pass; none is sufficient alone.

- **Gate 0 — Slice-contract review.** This doc must be reviewed PASS against §"Independent Review Checklist" BEFORE implementation begins. Phase 3 implementation cannot start until Gate 0 closes.
- **Gate 1 — Data-layer tests.** `tests/auth/guard-failure-modes.spec.ts` and the re-run of Day-1A workspace-guard / RLS specs all pass under `node --conditions=react-server --test`, against the local stack with migrations 001 + 002 + 003 applied. **Gate 1 proves only fixture state, RLS behavior, and the SQL/RLS query shape's data-layer outputs.** It does **NOT** prove that `lib/auth/with-channel-guard.ts` issues that exact query shape, composes through `withWorkspaceGuard`, or implements any §A binding obligation. A guard that omits the `workspace_id` correlation, omits the membership predicate, distinguishes denial sub-cases via different log reasons, or imports the admin client could still pass every Gate-1 spec, because the spec issues its OWN query independent of the guard source.
- **Gate 2 — Source-review gate (load-bearing).** An independent review of the implemented `lib/auth/with-channel-guard.ts` source against the §"Layer 2 — Source Review Gate" checklist (SR-1 … SR-12). This gate is **load-bearing**: Phase 3 implementation cannot be GREEN unless every Gate-2 question returns PASS with cited file:line evidence.

Phase 3 implementation is GREEN when ALL of:

1. Gate 0 closed (this doc reviewed PASS).
2. `lib/auth/with-channel-guard.ts` exists, satisfies every §"Implementation Requirements" §A obligation.
3. `tests/lib/supabase-test-harness.ts` carries every §B addition; Day-1A actors / workspaces / specs preserved.
4. `tests/auth/guard-failure-modes.spec.ts` exists with every §C block.
5. **Gate 1 PASS** — every command in §"Validation Commands" exits per the criteria there.
6. **Gate 2 PASS** — every §"Layer 2 — Source Review Gate" question returns PASS.
7. No file outside the §"Surface Audit" write surface is modified.
8. Adversarial cases in §"Adversarial Proof Cases" are documented as RED-on-mutation in the closeout note.
9. No `git commit` performed without explicit authorization.

Phase 4 is BLOCKED until Phase 3 implementation Gate 2 closes.

## Current Repo State (verified 2026-05-12 at HEAD `31e2ff8`)

- Branch: `main`, synced with `origin/main`; no tracked diff at fix-time.
- HEAD commit: `31e2ff8 docs(day-2a-p2.5): Phase 2.5 slice contract + narrow truth-up`.
- Recent five commits (newest first):
  - `31e2ff8 docs(day-2a-p2.5): Phase 2.5 slice contract + narrow truth-up`
  - `86523d9 test(day-2a-p2,p2.5): exact-equality policy proofs + 5-table grant matrix`
  - `7f284cf feat(day-2a-p2.5): harden workspaces/workspace_members ACL via 003`
  - `8e9d88b feat(day-2a-p1): channels/channel_members/messages substrate with RLS`
  - `7b9eec1 Plan Day 2A trust boundary before implementation`
- `git status --porcelain` reports exactly one untracked file: `docs/tasks/day-2a-phase-3-channel-guard-harness.md` (this slice doc). No other untracked or modified files. The slice doc is itself a planning artifact, NOT a Phase-3 implementation deliverable; it may be amended in-place to record review-pass corrections (as this REQUEST-CHANGES pass did).
- Phase 3 implementation artifacts confirmed ABSENT on disk:
  - `lib/auth/with-channel-guard.ts`
  - `tests/auth/guard-failure-modes.spec.ts`
  - `app/api/messages/route.ts`
  - `app/w/[workspaceSlug]/actions.ts`
  - `app/w/[workspaceSlug]/[channelId]/page.tsx`
  - `app/api/` directory
  - `middleware.ts` (Day-1B routed cache/headers through `proxy.ts`, not `middleware.ts`; `middleware.ts` does not exist on disk)
- Existing trust-boundary artifacts (read-only for Phase 3):
  - `lib/auth/with-session.ts` (20 lines; `SessionContext = { user, supabase }`, redirects to `/login` on no user).
  - `lib/auth/with-workspace-guard.ts` (71 lines; pre-DB SLUG_RE check, workspace SELECT, distinguishes `db-error` log vs `not-found-or-not-member` log, BOTH redirect to `/`).
  - `lib/auth/redirect-allowlist.ts`, `lib/auth/site-origin.ts` (Day 1A; unused by Phase 3).
  - `lib/supabase/server.ts` (cookie-bound server client; `__Host-`/`__Secure-` prefix; 64 lines).
  - `supabase/migrations/001_workspace_identity.sql` — committed.
  - `supabase/migrations/002_channels_and_messages.sql` — committed; defines `channels`, `channel_members`, `messages`; RLS + force-RLS on all three; four policies (channels SELECT, channel_members SELECT, messages SELECT, messages INSERT); narrow grants to `authenticated` only.
  - `supabase/migrations/003_harden_workspace_acl.sql` — committed; revokes broad privileges from `authenticated`/`public` on `workspaces`/`workspace_members`, grants minimal `SELECT`.
  - `tests/lib/supabase-test-harness.ts` (118 lines; current shape: `member` / `nonMember` / `workspaceA` / `workspaceB` / `admin` / `anon`; NO channel/channel_members/messages seeds).
  - `tests/lib/test-target-guard.ts` (host allowlist + JWT ref/iss binding; OUT of Phase 3 scope).
  - `tests/auth/workspace-guard.spec.ts` (65 lines; tests data-layer behavior; comment line confirms `End-to-end behavior (signed-out redirect, signed-in member sees page, non-member denied) is covered by the Playwright e2e suite.`).
  - `tests/rls/workspace-select-membership.spec.ts`, `tests/rls/workspace-write-denial.spec.ts` (Day-1A multi-actor proofs).
  - `tests/rls/policy-shape.spec.ts`, `tests/rls/all-tables-have-rls.spec.ts`, `tests/rls/migration-rls-enabled.spec.ts` (Day-2A Phase-2/Phase-2.5 catalog/grant proofs).
  - `proxy.ts` (Day 1B cache + security headers; NOT edited in Phase 3).
- `app/` tree (Phase 3 read-only reference; NO new app routes added):
  - `app/auth/callback/route.ts`
  - `app/dev/test-signin/route.ts`
  - `app/layout.tsx`, `app/page.tsx`
  - `app/login/page.tsx`, `app/login/actions.ts`
  - `app/w/[workspaceSlug]/page.tsx`
- No `package.json` test runner script. Phase 3 validation uses `node --conditions=react-server --test <files>` directly, matching Phase-2 / Phase-2.5 precedent.

## Surface Audit

### Write surface (Phase 3 may Create or Modify ONLY these paths)

| Action  | Path | Purpose |
|---------|------|---------|
| Create  | `lib/auth/with-channel-guard.ts` | Channel-scoped HOF composing through `withWorkspaceGuard`. |
| Modify  | `tests/lib/supabase-test-harness.ts` | Additive extension: `workspaceOnlyMember`, `channelA1`, `channelB1`, two `channel_members` rows, seed message. Existing Day-1A surface preserved. |
| Create  | `tests/auth/guard-failure-modes.spec.ts` | Gate-1 spec. Proves fixture state + RLS + query-shape: the combined channel-membership lookup returns `{data: null, error: null}` for the three denial fixture scenarios (denial-A/B/C); the broken-guard simulation reveals the cross-workspace row when the `workspace_id` constraint is removed; the pre-DB UUID regex from §A.1 accepts canonical UUIDs and rejects malformed inputs. **Does NOT prove the guard source issues these queries — that is Gate 2.** |
| Modify  | `docs/tasks/day-2a-phase-3-channel-guard-harness.md` | This doc — implementation may amend in-place to record review-pass corrections but MUST NOT delete it, rewrite its scope, or treat it as an implementation deliverable. |

That is the entire Phase 3 write surface. Four paths. No others.

### Read-only dependency surface (Phase 3 inspects, never edits)

Phase 3 reads each of these to preserve patterns, log shapes, error categories, fixture conventions, and the existing test runner pattern. Phase 3 implementation MUST NOT modify any of them.

- `CLAUDE.md`, `AGENTS.md` — security invariants, trust-boundary list, approval-required actions, harness timing.
- `.planning/claude-code-slack-agent-gates-week1-grounded-20260509.md` — Day-2A scope, cut order, floor list.
- `docs/tasks/day-2a-trust-boundary-data-path.md` — broad Day-2A doc; Phase 3 narrows from it.
- `docs/tasks/day-2a-phase-2-policy-shape-tests.md`, `docs/tasks/day-2a-phase-2.5-blocker-fixes.md` — predecessor slice contracts; precedent for `node --conditions=react-server --test`, "no harness extension yet" wording, untracked-file whitespace-check semantics.
- `lib/auth/with-session.ts` — pattern: HOF returning `Promise<T>`; `supabase.auth.getUser()` then `redirect("/login")` on no user; returns `SessionContext { user, supabase }`.
- `lib/auth/with-workspace-guard.ts` — pattern: HOF composes through `withSession`; pre-DB SLUG_RE; single supabase-js `maybeSingle` lookup; structured `logDeny`; distinct `db-error` (alert-class `console.error`, includes PostgREST `code`) vs `not-found-or-not-member` (`console.warn`); BOTH branches `redirect("/")`. Log fields exactly: `{component, reason, slug, user_id, code}`; NO emails / messages / details / hints / row contents.
- `lib/supabase/server.ts` — `createSupabaseServerClient` from `@supabase/ssr`; cookie-bound; `__Host-`/`__Secure-` prefix. The user-scoped client comes from here. **`lib/supabase/admin.ts` is explicitly OUT of Phase 3** (channel guard is pure user-scoped; no admin client import or transitive load).
- `supabase/migrations/001_workspace_identity.sql`, `002_channels_and_messages.sql`, `003_harden_workspace_acl.sql` — schema for `channels.id`, `channels.workspace_id`, `channels.name`, `channels.kind`, `channel_members.{channel_id, user_id, created_at}`, `messages.{id, channel_id, user_id, body, client_nonce, created_at}`. Indexes already in place: `channels.id` PK; `channel_members` composite PK `(channel_id, user_id)`; `channel_members_user_id_idx`; `messages_channel_id_created_at_idx`. ON DELETE CASCADE chain: `workspaces → channels → channel_members`; `workspaces → channels → messages`; `auth.users → channel_members`; `auth.users → messages`; `auth.users → workspace_members`. **No new migrations, columns, indexes, constraints, or schema artifacts required for Phase 3** (database-schema-designer + migration analytical-lens output).
- `tests/lib/supabase-test-harness.ts` — pattern: `setupHarness()` returns `Harness`; users created via `admin.auth.admin.createUser({email, password, email_confirm: true})` then `signInWithPassword`; workspaces and memberships inserted via admin client; `cleanup()` deletes `test-run-${runId}-%` workspaces (cascades to dependent rows) then deletes all created auth users.
- `tests/lib/test-target-guard.ts` — host allowlist + JWT ref/iss binding. NOT touched in Phase 3.
- `tests/auth/workspace-guard.spec.ts` — **load-bearing precedent.** Tests the data layer (`SLUG_RE` regex behavior + supabase-js SELECT-by-slug result per actor); does NOT invoke `withWorkspaceGuard()` directly; does NOT mock `redirect()`. Comment: *"End-to-end behavior (signed-out redirect, signed-in member sees page, non-member denied) is covered by the Playwright e2e suite."* Phase 3 inherits this precedent.
- `tests/rls/workspace-select-membership.spec.ts`, `tests/rls/workspace-write-denial.spec.ts` — Day-1A multi-actor RLS proofs using `setupHarness()`. Phase 3 harness extension MUST NOT change their semantics.

### Forbidden adjacent surface (Phase 3 MUST NOT touch)

Each path below is OUT of slice. If Phase 3 work appears to require any of these, halt and escalate per §"Cut / Escalate Rules"; do NOT silently expand.

- `app/api/**` — Phase 4 (route handlers).
- `app/w/**` — Phase 4 (server actions, channel page). **No new app route added in Phase 3.** No `app/w/[workspaceSlug]/[channelId]/page.tsx`; no `app/w/[workspaceSlug]/actions.ts`; no `app/w/[workspaceSlug]/[channelId]/actions.ts`.
- `app/api/` directory creation — Phase 4.
- `proxy.ts` — Day 1B locked; Phase 4 refactor candidate. Phase 3 does not edit.
- `middleware.ts` — does not exist; would be Day 1B scope if it did. Phase 3 does not create it.
- `tests/api/**` — Phase 4 (`route-contract.spec.ts`). Phase 3 does not create this directory.
- `tests/rls/channel-list-membership.spec.ts` — Phase 4 floor item.
- `tests/auth/server-action-csrf.spec.ts` — Phase 4 (cross-origin POST → 403).
- `tests/auth/magic-link-replay.spec.ts` — Phase 4 (token reused → second attempt denied).
- `tests/util/run-isolation.spec.ts` — Phase 4 cut candidate.
- `tests/realtime/**` — Day 3.
- `tests/security/**` — Day 1B locked; not extended in Phase 3.
- `tests/lib/test-target-guard.ts` — different lane.
- `semgrep/**` — Phase 7 governance scope (`unguarded-route-query.yml`, `admin-client-boundary.yml`, etc.).
- `Makefile` — no new targets; no `repo-law` / `fast-check` / `tools-version-check` / `governance-check` extension.
- `package.json` — no new deps; no new scripts. `pnpm install --frozen-lockfile` only.
- `pnpm-lock.yaml` — untouched.
- `evidence/**` — Day 2B scope. No manifest, no SHA256, no Claude-review JSON / transcript.
- `.github/**` — Day 2B + Day 5 scope.
- `.claude/**` — Day 2B harness scope (`vertical-slice` / `authz-proof` skills, `authz-reviewer` agent, PreToolUse hook). Phase 3 does not introduce any.
- `supabase/migrations/**` — no new migration; no `004_*.sql`; no edits to 001/002/003 (all committed; forward-only invariant).
- `lib/supabase/admin.ts` — channel guard is pure user-scoped; no admin-client import.
- `lib/supabase/server.ts` — consumed via `createSupabaseServerClient()` indirectly through `withSession`/`withWorkspaceGuard`; NOT edited.
- `lib/supabase/client.ts` — browser-side; not used by the guard.
- `lib/auth/with-session.ts`, `lib/auth/with-workspace-guard.ts`, `lib/auth/redirect-allowlist.ts`, `lib/auth/site-origin.ts` — Phase 3 composes through `withWorkspaceGuard` but does NOT modify any existing `lib/auth/*` file.
- `docs/decisions/**` — ADR scope (Day-2A Phase 8 surface).
- `.planning/**` — roadmap stability. Phase 3 does not touch the authoritative plan or any other planning artifact.
- Any commit / branch / push action. No `git commit`. No `git push`. No `gh pr create`.
- Any Phase 4 / Phase 5 / Phase 6 / Phase 7 / Phase 8 work.

### Surface audit — explicit notes (review-required clarifications)

Three notes are flagged for the independent reviewer because they intersect Phase 3 with adjacent scope.

1. **The broad Day-2A doc (`docs/tasks/day-2a-trust-boundary-data-path.md`) references `/w/<slug>/<channel-id>`-style guard testing.** The current app tree has NO such route (`app/w/[workspaceSlug]/[channelId]/page.tsx` is absent). Phase 3 explicitly does NOT create such a route — that is Phase 4 write surface. See §"Testing Approach Decision" for the chosen path. If review concludes a route is required, the slice is BLOCKED (not silently expanded).
2. **`tests/auth/guard-failure-modes.spec.ts` cannot test the guard's `redirect()` side-effect directly under the precedent set by `tests/auth/workspace-guard.spec.ts`.** `redirect()` from `next/navigation` is a control-flow throw that requires Next runtime + cookie context. Phase 3 inherits the existing data-layer-only test precedent; the runtime "redirect happens" assertion belongs to Day-4 Playwright e2e. See §"Testing Approach Decision" for the rejected alternatives.
3. **`AGENTS.md` (committed) references `.planning/Codex-slack-agent-gates-week1-grounded-20260509.md` but the planning doc on disk is `.planning/claude-code-slack-agent-gates-week1-grounded-20260509.md`.** This is a pre-existing AGENTS.md inconsistency (verbatim "Claude" → "Codex" substitution that broke the path). OUT of Phase 3 scope. Logged as Day-6+ follow-up; Phase 3 implementation MUST NOT edit `AGENTS.md`.

## Implementation Requirements

### A. `lib/auth/with-channel-guard.ts` (CREATE)

#### Public shape

```ts
import { redirect } from "next/navigation";
import {
  withWorkspaceGuard,
  type WorkspaceContext,
} from "@/lib/auth/with-workspace-guard";

export type ChannelContext = WorkspaceContext & {
  channel: {
    id: string;
    name: string;
    kind: string;
    workspace_id: string;
  };
};

export async function withChannelGuard<T>(
  workspaceSlug: string,
  channelId: string,
  fn: (ctx: ChannelContext) => Promise<T>,
): Promise<T> { /* ... */ }
```

#### Behavior obligations (binding)

A.1. **Pre-DB UUID-shape check.** Before any database query, reject `channelId` that does not match the canonical lowercase-hex UUID shape:

```
/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
```

On failure, log the unified-deny shape (see §A.7) and `redirect("/")`. Invalid UUID strings MUST NOT reach Postgres.

A.2. **Composition through `withWorkspaceGuard`.** The HOF MUST call `withWorkspaceGuard(workspaceSlug, async (workspaceCtx) => { ... })`. Inside that callback the workspace is already validated (member + slug shape) and `workspaceCtx.supabase` is the user-scoped client. Phase 3 MUST NOT bypass `withWorkspaceGuard` and re-implement workspace validation. Phase 3 MUST NOT call `withSession` directly; `withWorkspaceGuard` already composes through it.

A.3. **No admin / service-role client.** The guard uses `workspaceCtx.supabase` (user-scoped, RLS-bound) only. **Phase 3 MUST NOT import `@/lib/supabase/admin` directly, transitively, or via dynamic import.** Independent review verifies by grep for `"@/lib/supabase/admin"`, `'admin.ts'`, `from\\(.*admin`, `createAdminClient`, and `SUPABASE_SERVICE_ROLE` — all expected absent from the new file.

A.4. **Single combined channel-membership lookup.** The guard performs ONE supabase-js call (one PostgREST round-trip) that simultaneously binds all three predicates:

- `channels.id = channelId`
- `channels.workspace_id = workspaceCtx.workspace.id`
- existence of `channel_members(channel_id = channelId AND user_id = workspaceCtx.user.id)`

Implementation choice (pick the one verified against the live local stack):

- **Choice-1 — nested `select` with inner-join semantics:**

  ```ts
  const { data, error } = await workspaceCtx.supabase
    .from("channels")
    .select("id, name, kind, workspace_id, channel_members!inner(user_id)")
    .eq("id", channelId)
    .eq("workspace_id", workspaceCtx.workspace.id)
    .eq("channel_members.user_id", workspaceCtx.user.id)
    .maybeSingle();
  ```

  The `!inner` is load-bearing: with default left-join semantics a non-matching membership leaves the channel row intact and the guard would false-pass on membership. The implementer verifies `!inner` filter pushdown against the live Supabase PostgREST version before settling on Choice-1.

- **Choice-2 — single PostgREST request with the membership inlined via a left join + post-fetch presence check:**

  Acceptable only if Choice-1 cannot be verified. The implementation MUST collapse "channel row returned but `channel_members` array empty" into the SAME denial branch as "channel row absent" (unified deny — §A.5). The contract is one round-trip; two-step lookups are FORBIDDEN (they widen the timing-leak surface and create distinguishable per-step log lines).

A.5. **Unified denial collapse.** All of the following MUST collapse to the SAME deny path — same log reason, same redirect target, no test-surface side-channel:

- `channelId` fails the UUID-shape regex (§A.1).
- Channel does not exist.
- Channel exists but `channels.workspace_id !== workspaceCtx.workspace.id` (cross-workspace channel).
- Channel exists in the correct workspace, but user has no `channel_members` row.

Unified deny reason (log field `reason`): **`"not-found-or-not-bound-or-not-member"`**.
Unified deny target: **`redirect("/")`**.

A.6. **Distinct `db-error` branch for RLS/PostgREST errors.** If the supabase-js call returns a non-null `error`, the guard MUST log with `reason: "db-error"`, `console.error` level, including the PostgREST `code` ONLY (no `message`, `details`, `hint`, or row contents). After logging, redirect to the same target (`/`). The redirect target is identical to the unified deny; the distinction is in the log stream only. A test cannot tell `db-error` from `not-found-or-not-bound-or-not-member` from the redirect alone.

A.7. **Log shape (binding).** Both log lines MUST be a single JSON line via `console.warn` (unified deny) or `console.error` (db-error), with EXACTLY these fields and NO others:

- `component: "with-channel-guard"`
- `reason: "not-found-or-not-bound-or-not-member" | "db-error"`
- `slug: <workspaceSlug>` (already validated by `withWorkspaceGuard`'s SLUG_RE before this point)
- `channel_id: <channelId>` (caller's input — known to the caller; logging it is normal access-control audit, not a leak)
- `user_id: <workspaceCtx.user.id>`
- `code: <error.code | null>` (PostgREST/Postgres code string only on db-error; `null` on unified deny)

NEVER log: email, channel name, channel kind, `error.message`, `error.details`, `error.hint`, row contents, JWT, cookie values, or any field not in the list above. The `logDeny` helper SHOULD mirror the existing one in `lib/auth/with-workspace-guard.ts` (same shape, same `JSON.stringify` pattern); copying it into the new file is acceptable for week 1. Extracting to `lib/auth/log-deny.ts` is a Day-6+ follow-up — out of Phase 3.

A.8. **No 500 path.** The guard MUST NOT throw uncaught. If the supabase-js call rejects (thrown rejection, not just `{error}`), the guard catches, logs `reason: "db-error"` with `code: null`, and `redirect("/")`. A 500 from this guard is a regression.

A.9. **No top-level `try/catch` swallow.** A pattern that catches all errors and returns `null` (or hides the failure) is forbidden. Failure flows through the explicit deny branches (with structured log) and `redirect()`.

A.10. **No new dependencies.** No `pnpm add`. No `zod`, no `uuid`, no validation library. The UUID regex is inline. If the implementer believes a dependency is necessary, halt and escalate (slice-doc revision path).

A.11. **Pattern alignment with `lib/auth/with-workspace-guard.ts`.** The new file's `logDeny`/`logDbError` helper SHOULD mirror the existing one's shape, indentation, and JSON-line stringification. Reuse-by-copy is acceptable for week 1; extraction is Day-6+.

#### What the file MUST NOT do

- Read `SUPABASE_SERVICE_ROLE`.
- Import `@/lib/supabase/admin`.
- Use raw `pg` (node-postgres).
- Use `SECURITY DEFINER` Postgres functions or create / modify any RLS policy.
- Call Postgres directly via `psql` subprocess.
- Use `redirect()` outside the explicit deny branches.
- Vary the `redirect()` target across denial sub-conditions.
- Log channel name, error.message, error.details, error.hint, or email.
- Return distinguishable error codes / objects to the caller.
- Accept an `options` argument that could weaken the contract.

### B. `tests/lib/supabase-test-harness.ts` (MODIFY — additive extension only)

#### Required additions

Each item below preserves all existing Day-1A actors and workspaces unchanged.

B.1. **New actor: `workspaceOnlyMember`.** Created via the existing `makeUser` helper with email `seedEmail("wsonly", runId)`. Signed in via `signInWithPassword`. Added to `workspace_members(workspaceA, workspaceOnlyMember.userId)`. **NOT added to ANY `channel_members` row.**

B.2. **New channel: `channelA1`.** `channels` row with `workspace_id = workspaceA.id`, `name = "general-A-${runId}"`, `kind = "private"`. Inserted via `admin.from("channels").insert(...).select().single()`.

B.3. **`channel_members(channelA1, member.userId)`.** Inserted via admin client. Phase 3 MUST NOT add `workspaceOnlyMember` to `channelA1`.

B.4. **New channel: `channelB1`.** `channels` row with `workspace_id = workspaceB.id`, `name = "general-B-${runId}"`, `kind = "private"`.

B.5. **`channel_members(channelB1, member.userId)`.** **Load-bearing cross-workspace fixture.** Without this row, denial-B collapses to denial-C (channel exists but user is not a member); with this row plus the workspace_id mismatch, denial-B exercises the channel-vs-workspace correlation predicate distinctly.

B.6. **Seed message (Phase 4+ read fixture only).** `messages` row in `channelA1`, authored by `member.userId`, body `"seed message ${runId}"`. Inserted via the admin (service-role) client. **Service role is BYPASSRLS, so this insertion does NOT prove the `messages` INSERT policy semantics** — those are proven structurally by the Phase-2.5 `tests/rls/policy-shape.spec.ts` catalog assertions (Option A exact-equality on `with_check` per Phase 2.5 §Blocker 1) and will be exercised at runtime by Phase 4+ user-scoped message-send paths. The seed exists ONLY as a read fixture for Phase-4+ code (e.g., a channel-page render that asserts a seeded message is visible to channel members). Phase 3 itself does NOT consume this row in any spec.

#### Required exports (additive)

The `Harness` type gains:

```ts
workspaceOnlyMember: Actor;
channelA1: { id: string; workspace_id: string; name: string; kind: string };
channelB1: { id: string; workspace_id: string; name: string; kind: string };
seedMessage: { id: string; channel_id: string; user_id: string };
```

Existing fields preserved unchanged: `runId, admin, anon, member, nonMember, workspaceA, workspaceB, cleanup`.

#### Required cleanup obligations

Extended `cleanup()` MUST:

1. Delete `messages` rows for the seed message (or rely on cascade from channel deletion — see step 2).
2. Delete `channels` rows for `channelA1` AND `channelB1`. The FK on `channels.workspace_id` is `ON DELETE CASCADE` (migration 002), and `channel_members.channel_id` + `messages.channel_id` are also `ON DELETE CASCADE`, so workspace deletion cascades to channels → channel_members + messages.
3. Delete workspaces (existing `like("slug", "test-run-${runId}-%")` filter). Cascade reaches channels + channel_members + messages.
4. Delete `workspaceOnlyMember` via `admin.auth.admin.deleteUser` in addition to `member` and `nonMember`.

Cleanup MUST remain idempotent — deleting workspaces first (which cascades) and then attempting to delete channels MUST NOT raise. The existing `admin.from("workspaces").delete().like("slug", ...)` pattern already cascades the full chain; preserve that idiom.

#### What the harness extension MUST NOT do

- Add `workspaceOnlyMember` to any `channel_members` row.
- Add `nonMember` to any `workspace_members` or `channel_members` row.
- Remove, rename, or change the shape of `member`, `nonMember`, `workspaceA`, `workspaceB`, `admin`, `anon`.
- Change the slug shape of either workspace (Day-1A tests filter by `like("slug", "test-run-${runId}-%")`).
- Change the `seedEmail()` helper or the email shape used by `member` / `nonMember`.
- Introduce a new file under `tests/lib/` (e.g., `tests/lib/channel-fixtures.ts`). Phase 3 intentionally keeps additions in-file; an extraction is Day-6+.
- Add direct INSERTs to `channel_members` / `messages` using a user-scoped client. ALL Phase 3 harness writes go through the `admin` (service-role) client.
- Add `workspaceA` to `workspaceB`'s membership or vice versa.

### C. `tests/auth/guard-failure-modes.spec.ts` (CREATE)

#### Imports / pattern

```ts
import { test, after, before } from "node:test";
import { strict as assert } from "node:assert";
import { setupHarness, type Harness } from "../lib/supabase-test-harness.ts";

let H: Harness;
before(async () => { H = await setupHarness(); });
after(async () => { if (H) await H.cleanup(); });
```

No imports of `next/navigation`, `next/headers`, `@/lib/auth/with-channel-guard`, or `@/lib/supabase/server`. Per the precedent set by `tests/auth/workspace-guard.spec.ts`, the spec exercises the data-layer pattern that backs the guard; the runtime `redirect()` assertion belongs to Day-4 Playwright e2e.

#### Required blocks (eight)

##### Block 1 — `withSession` denial: anon (unauthenticated)

Use `H.anon` (no JWT). Attempt the workspace-lookup chain the channel guard would issue:

```ts
const { data, error } = await H.anon
  .from("workspaces")
  .select("id")
  .eq("slug", H.workspaceA.slug)
  .maybeSingle();
assert.equal(data, null);
assert.notEqual(error, null);
```

Proves `withSession`'s `/login` redirect is reachable: anon cannot get past `workspaces` SELECT (migration 001 + migration 003 revoke from anon AND restrict `authenticated` to `SELECT`-only) into the channel branch.

##### Block 2 — `withWorkspaceGuard` denial: signed-in non-member

Use `H.nonMember.client`. Same workspace lookup:

```ts
const { data, error } = await H.nonMember.client
  .from("workspaces")
  .select("id")
  .eq("slug", H.workspaceA.slug)
  .maybeSingle();
assert.equal(data, null);
assert.equal(error, null);  // RLS returns zero rows, not a DB error
```

Mirrors the existing `tests/auth/workspace-guard.spec.ts` "non-member" case; proves the workspace-level deny lands before the channel branch can fire.

##### Block 3 — `withChannelGuard` denial-A: workspace-only member, not a channel member

```ts
const denialA = await H.workspaceOnlyMember.client
  .from("channels")
  .select("id, name, kind, workspace_id, channel_members!inner(user_id)")
  .eq("id", H.channelA1.id)
  .eq("workspace_id", H.workspaceA.id)
  .eq("channel_members.user_id", H.workspaceOnlyMember.userId)
  .maybeSingle();
assert.equal(denialA.data, null);
assert.equal(denialA.error, null);
```

##### Block 4 — `withChannelGuard` denial-B: cross-workspace channel member (LOAD-BEARING)

Step 1 — workspace lookup succeeds (`member` IS in `workspaceA`):

```ts
const ws = await H.member.client
  .from("workspaces")
  .select("id")
  .eq("slug", H.workspaceA.slug)
  .maybeSingle();
assert.equal(ws.data?.id, H.workspaceA.id);
```

Step 2 — combined channel lookup pins `workspace_id` to `workspaceA`, but `channelB1.workspace_id = workspaceB.id`:

```ts
const denialB = await H.member.client
  .from("channels")
  .select("id, name, kind, workspace_id, channel_members!inner(user_id)")
  .eq("id", H.channelB1.id)
  .eq("workspace_id", H.workspaceA.id)        // load-bearing constraint
  .eq("channel_members.user_id", H.member.userId)
  .maybeSingle();
assert.equal(denialB.data, null);
assert.equal(denialB.error, null);
```

Step 3 — negative-control "broken-guard simulation" — same query WITHOUT the workspace_id constraint MUST return the cross-workspace row:

```ts
const brokenGuard = await H.member.client
  .from("channels")
  .select("id, workspace_id, channel_members!inner(user_id)")
  .eq("id", H.channelB1.id)
  // NOTE: no .eq("workspace_id", ...) — proves the constraint is necessary
  .eq("channel_members.user_id", H.member.userId)
  .maybeSingle();
assert.notEqual(brokenGuard.data, null,
  "broken-guard simulation: without workspace_id, member sees channelB1 — " +
  "this is the regression the workspace_id constraint catches");
assert.equal(brokenGuard.data?.workspace_id, H.workspaceB.id,
  "broken-guard simulation returned the cross-workspace row");
```

If the harness ever stops cross-binding `member → channelB1`, step 3 fails — the test correctly RED's because denial-B is no longer load-bearing.

##### Block 5 — `withChannelGuard` denial-C: unknown channel id

```ts
const unknownChannelId = crypto.randomUUID();
const denialC = await H.member.client
  .from("channels")
  .select("id, workspace_id, channel_members!inner(user_id)")
  .eq("id", unknownChannelId)
  .eq("workspace_id", H.workspaceA.id)
  .eq("channel_members.user_id", H.member.userId)
  .maybeSingle();
assert.equal(denialC.data, null);
assert.equal(denialC.error, null);
```

##### Block 6 — Same-shape denial across A/B/C

```ts
for (const [label, result] of [
  ["denial-A", denialA],
  ["denial-B", denialB],
  ["denial-C", denialC],
] as const) {
  assert.equal(result.data, null, `${label}: data must be null`);
  assert.equal(result.error, null, `${label}: error must be null (RLS, not DB error)`);
}
```

The observable at the data-layer surface is `{data: null, error: null}` for all three. **This spec proves only that the fixture state plus a correctly-formed query shape yield identical data-layer outputs across A/B/C.** It does NOT prove that the guard collapses these three sub-conditions into the same log line + same `redirect("/")` target — that is verified by the §"Layer 2 — Source Review Gate" questions SR-5, SR-6, and SR-8 reading the guard source. End-to-end runtime side-effect identity is additionally verified by Day-4 Playwright e2e.

##### Block 7 — Pre-DB UUID-shape rejection (the guard's regex contract)

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
for (const bad of [
  "",
  "not-a-uuid",
  "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",   // uppercase — canonical is lowercase
  "00000000-0000-0000-0000-00000000000",    // 11 trailing hex chars
  "00000000-0000-0000-0000-0000000000000",  // 13 trailing hex chars
  "00000000-0000-0000-0000-00000000000g",   // non-hex char
  "00000000_0000_0000_0000_000000000000",   // wrong separator
  "../etc/passwd",
]) {
  assert.equal(UUID_RE.test(bad), false,
    `${JSON.stringify(bad)} must be rejected by guard's pre-DB UUID check`);
}
for (const good of [
  "00000000-0000-0000-0000-000000000000",
  crypto.randomUUID().toLowerCase(),
]) {
  assert.equal(UUID_RE.test(good), true,
    `${JSON.stringify(good)} must be accepted`);
}
```

##### Block 8 — No-500 contract (negative inspection)

Data-layer queries used in Blocks 3/4/5 MUST NOT throw under normal RLS denial. The supabase-js client returns `{data, error}` for both the empty-row case (RLS-filtered) and the permission-denied case (anon). A thrown rejection would propagate through `await` and fail the surrounding test before reaching `assert.equal(...)`. Block 8 documents this as an explicit assertion-by-presence: each preceding block's `await` is a no-throw guarantee.

The "guard catches thrown rejection and logs db-error" obligation (§A.8) is verified by independent review reading the guard source, NOT by fault injection in this spec. **A Day-6+ follow-up is logged: add a module-mock fault-injection test exercising the catch-around-query branch.**

#### What the test file MUST NOT do

- Mock `next/navigation`'s `redirect`.
- Mock `next/headers`'s `cookies`.
- Mock `@/lib/supabase/server`'s `createSupabaseServerClient`.
- Import or invoke `withChannelGuard` directly.
- Touch any file under `app/`.
- Add a new route file as a test fixture.
- Use `psql` subprocess (channel-guard proofs are supabase-js + RLS, not catalog).
- Create new test fixtures outside `tests/auth/guard-failure-modes.spec.ts`.
- Add a new file under `tests/lib/`.

## Layer 2 — Source Review Gate (load-bearing)

**Purpose.** The Gate-1 spec in §C proves only fixture / RLS / query-shape properties. It does NOT prove `lib/auth/with-channel-guard.ts` issues that query shape, composes through `withWorkspaceGuard`, or sanitizes its log lines. Gate 2 closes that gap by reading the implemented guard source and answering concrete binding questions. **Phase 3 implementation cannot be GREEN unless every Gate-2 question returns PASS with cited file:line evidence.**

**Scope.** Source review of `lib/auth/with-channel-guard.ts` ONLY. Harness-extension review (Gate 1 fixture correctness) is implicit in the Gate-1 spec passing; slice-contract review is Gate 0. Gate 2 does not duplicate either.

**Provenance.** Until Day 2B lands `scripts/run-claude-review.mjs` + `scripts/check-evidence.mjs`, Gate 2 is a read-only inline review (concrete file paths + line numbers + evidence quotes) per CLAUDE.md §"Reviewer provenance" — NOT a `claude-authz-review.json` artifact. From Day 2B onward, Gate 2 reviews go through the runner.

**Required PASS questions.** Each maps 1:1 to a §A behavioral obligation. The reviewer cites file:line.

- **SR-1 — UUID pre-check before DB access.** Does the guard reject any `channelId` not matching `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` BEFORE issuing any `await supabase.from(...)` call? Cite the regex location and the early-return path. (Maps to §A.1.)
- **SR-2 — Composition through `withWorkspaceGuard`.** Does the guard call `withWorkspaceGuard(workspaceSlug, async (workspaceCtx) => { ... })` and use `workspaceCtx.supabase` / `workspaceCtx.user` / `workspaceCtx.workspace.id` exclusively? Does it AVOID calling `withSession` directly, AVOID re-implementing workspace lookup, AVOID re-running SLUG_RE? Cite the call site. (Maps to §A.2.)
- **SR-3 — Combined channel-membership lookup binds all three predicates.** Does the single supabase-js call simultaneously bind ALL THREE of (a) `channels.id = channelId`, (b) `channels.workspace_id = workspaceCtx.workspace.id`, (c) existence of `channel_members(channel_id = channelId AND user_id = workspaceCtx.user.id)` — in ONE PostgREST round-trip (not two sequential lookups)? Cite the full `.from("channels")...` chain. (Maps to §A.4.)
- **SR-4 — Inner-join semantics (no left-join false-pass).** If Choice-1, is the embedded `channel_members!inner(user_id)` present (NOT `channel_members(user_id)`)? If Choice-2, does the post-fetch presence check collapse the empty-`channel_members` branch into the unified deny? Cite the join shape. (Maps to §A.4.)
- **SR-5 — Unified denial collapse.** Do ALL four sub-conditions (UUID-shape fail; channel absent; cross-workspace channel; non-member) converge on the SAME `console.warn`-level log with `reason: "not-found-or-not-bound-or-not-member"` AND the SAME `redirect("/")` call? Cite the single deny branch and the single redirect call shared across sub-conditions. (Maps to §A.5.)
- **SR-6 — `db-error` distinct in log stream only.** When the supabase-js call returns non-null `error`, does the guard log `reason: "db-error"` at `console.error` level with `code: error.code` only, then `redirect("/")` to the SAME target as the unified deny? Cite the branch. (Maps to §A.6.)
- **SR-7 — No admin / service-role path.** Does `grep -F '"@/lib/supabase/admin"'`, `grep -F "'admin.ts'"`, `grep -F "createAdminClient"`, and `grep -F "SUPABASE_SERVICE_ROLE"` over `lib/auth/with-channel-guard.ts` return zero matches? Does the import list contain ONLY `next/navigation` + `@/lib/auth/with-workspace-guard` (plus optional `@supabase/supabase-js` `User` type)? Cite the full import list. (Maps to §A.3.)
- **SR-8 — Log shape excludes secret-class fields.** Does the `JSON.stringify` payload on both log lines contain EXACTLY the six fields in §A.7 (`component`, `reason`, `slug`, `channel_id`, `user_id`, `code`) and NO others? The payload MUST NOT contain `error.message`, `error.details`, `error.hint`, channel name, channel kind, email, JWT, or cookie value. Cite the log-object literal. (Maps to §A.7.)
- **SR-9 — No uncaught rejection / 500 path.** If the supabase-js call rejects (thrown rejection, not just `{error}`), is it converted to a `db-error` log + `redirect("/")` (not an uncaught throw to the caller)? Cite the catch path or the equivalent error-propagation handling. (Maps to §A.8.)
- **SR-10 — No top-level `try/catch` swallow.** Is there NO pattern that catches all errors and returns `null` / hides the failure silently? Confirm the deny branches are the only non-success exit paths. (Maps to §A.9.)
- **SR-11 — No new dependencies.** Does `package.json` show no diff at Phase 3 close? Does the new file import only project-local + `next/navigation` symbols already in use by other guards? (Maps to §A.10.)
- **SR-12 — Pattern alignment with existing guards.** Does the `logDeny` / `logDbError` helper in the new file mirror `lib/auth/with-workspace-guard.ts`'s shape (component string, JSON line via `console.warn`/`console.error` split) without divergence? Cite the side-by-side comparison. (Maps to §A.11.)

**Gate-2 verdict.** PASS only if every question above returns PASS with cited evidence. Any single question returning WARN or BLOCK halts Phase 3 implementation; resolution is implementation revision (not slice-doc revision) unless review concludes the contract itself is unimplementable.

**Independence from Gate 1.** Gate-2 questions are answered by reading source, not by running tests. A guard that passes every Gate-1 spec but fails any Gate-2 question is NOT GREEN. A guard that satisfies every Gate-2 question but fails a Gate-1 spec is also NOT GREEN. Both gates load-bear.

## Testing Approach Decision

**Decision.** Phase 3 splits coverage across two gates. **Gate 1** — `tests/auth/guard-failure-modes.spec.ts` — exercises the DATA-LAYER LOOKUP PATTERN that `withChannelGuard` will rely on, against fixture + RLS state. The Gate-1 spec proves only that the fixture state and a correctly-formed query shape yield `{data: null, error: null}` for the three denial sub-conditions. **It does NOT prove `with-channel-guard.ts` issues that query shape, composes through `withWorkspaceGuard`, or sanitizes its log lines.** Those properties are covered by **Gate 2** — the §"Layer 2 — Source Review Gate" — which reads the implemented guard source and answers concrete binding questions (SR-1 … SR-12).

Phase 3 implementation requires BOTH gates to pass; neither is sufficient alone.

### Rationale

1. **Precedent.** `tests/auth/workspace-guard.spec.ts` tests the data layer and explicitly comments: *"End-to-end behavior (signed-out redirect, signed-in member sees page, non-member denied) is covered by the Playwright e2e suite."* Phase 3 inherits this precedent for Gate 1.
2. **No `redirect()` testability in week 1.** Testing `redirect()` directly requires module-mocking `next/navigation` AND `next/headers` AND injecting a fake cookie store yielding the test actor's JWT — infrastructure that does not exist in week 1 and is not in the Phase 3 write surface.
3. **No route creation.** Creating `app/w/[workspaceSlug]/[channelId]/page.tsx` or `app/api/messages/route.ts` to test the guard pulls Phase 4 forward, violating cut order.
4. **Coverage split.**
   - **Gate 1 catches:** fixture drift (denial-A/B/C harness state); broken cross-workspace cross-binding (Block 4 step 3 negative-control); incorrect RLS or migration state (rows visible when they should not be, or vice versa); pre-DB UUID regex shape mismatch (Block 7 — pure-regex assertion that does NOT depend on the guard).
   - **Gate 2 catches (read-source):** guard omitting the `workspace_id` correlation (SR-3); guard omitting the membership predicate (SR-3 + SR-4); guard using a two-step lookup (SR-3); guard importing the admin client (SR-7); guard logging raw `error.message` / `details` / `hint` (SR-8); guard varying redirect target / log reason across deny sub-conditions (SR-5 + SR-6); guard skipping the UUID pre-check (SR-1); guard bypassing `withWorkspaceGuard` (SR-2); guard producing a 500 on supabase-js rejection (SR-9); guard adding a new dependency (SR-11).
   - **Day-4 e2e (out-of-Phase-3) catches:** runtime "redirect happens" assertion at the route layer; observable HTTP-level identity of deny shape across A/B/C; cookie-bound auth context behavior end-to-end.

### Rejected alternatives

- **Reject — Create a Next route to invoke the guard.** Pulls Phase 4 forward.
- **Reject — Mock `next/navigation` and `next/headers` in the test file.** Infrastructure not in week 1; adds a new abstraction layer the slice intentionally avoids. Logged as Day-6+ follow-up.
- **Reject — `node:test` `mock.module(...)` (Node ≥ 20.6).** Available, but not used by any existing Phase-2 / Phase-2.5 spec; introducing it here is novel infrastructure outside the slice's write surface. Logged as Day-6+ follow-up.

### Blocker condition

If independent review concludes the data-layer approach is insufficient AND no allowed-surface alternative exists, **Phase 3 is BLOCKED**. Escalate to the user with the specific gap and proposed surface expansion (necessarily a slice-doc revision, not silent expansion).

## Adversarial Proof Cases

Each case names the gate that catches it and the evidence path. Items 1–2 explicitly attribute catches to Gate 2 (source review), because Gate 1 issues its own test query — independent of the guard source — and therefore CANNOT catch a guard that issues a different (broken) query.

1. **Guard forgets `channels.workspace_id = workspaceCtx.workspace.id`.** **Caught by Gate 2 / SR-3** (source review reads the guard's supabase-js chain and verifies `.eq("workspace_id", workspaceCtx.workspace.id)` is present). Gate-1 Block 4 step 3 (the broken-guard negative-control) does NOT catch the guard's omission; it only proves the constraint is SEMANTICALLY NECESSARY by showing that a query WITHOUT the constraint reveals the cross-workspace row.
2. **Guard forgets channel membership predicate (or uses `!left` instead of `!inner`).** **Caught by Gate 2 / SR-3 + SR-4** (source review verifies both the membership predicate and the `!inner` keyword). Gate-1 Block 3 proves the fixture state: `workspaceOnlyMember` is in `workspaceA` but NOT in `channelA1`'s `channel_members`, so a correctly-formed query returns null. If the guard omits the membership predicate at the source level, Gate 1 cannot detect that — the spec issues its own query, not the guard's.
3. **Guard uses admin / service-role lookup to distinguish unknown vs inaccessible.** **Caught by Gate 2 / SR-7** (greps the guard source for `@/lib/supabase/admin`, `SUPABASE_SERVICE_ROLE`, `createAdminClient`, `from\\(.*admin` — all expected absent). Day-1A bundle-leak scanner (`scripts/check-bundle-leak.mjs`) provides an additional belt-and-suspenders signal on `.next/static`.
4. **Guard returns different redirect target / status / log reason for unknown vs foreign-workspace vs non-member.** **Caught by Gate 2 / SR-5 + SR-6** (source review reads the guard and verifies one shared `redirect("/")` call across deny sub-conditions, and one shared `reason` string on the warn path). Gate-1 Block 6 cannot catch this — its assertion is at the data-layer surface where all three denial sub-conditions trivially return `{null, null}`. Day-4 e2e additionally covers the runtime-observable assertion.
5. **Guard logs raw Supabase `error.message`, `error.details`, `error.hint`, or row contents (e.g., channel.name).** **Caught by Gate 2 / SR-8** (source review verifies the `JSON.stringify` payload contains EXACTLY the six fields in §A.7).
6. **Invalid UUID reaches the DB.** **Caught by Gate 2 / SR-1** (source review verifies the UUID regex is checked BEFORE any `await supabase.from(...)` call). Gate-1 Block 7 asserts the regex SHAPE against the same input set the guard is required to use; combined with SR-1's "regex check happens before DB access" attestation, the contract is complete.
7. **Harness accidentally adds `workspaceOnlyMember` to `channel_members(channelA1, ...)`.** **Caught by Gate 1 / Block 3** — `assert.equal(denialA.data, null)` RED's because the `!inner` join matches the now-present row. This is a fixture-state regression, NOT a guard-binding regression.
8. **Harness forgets the `member → channelB1` row.** **Caught by Gate 1 / Block 4 step 3** — `assert.notEqual(brokenGuard.data, null, ...)` RED's because without the cross-workspace channel membership, the broken-guard simulation returns null and denial-B is no longer load-bearing. This is a fixture-state regression.
9. **Test only asserts redirect target / HTTP status, not data-layer same-shape.** **Caught by Gate 0** (slice-contract review) — violates §"Testing Approach Decision"; the spec under review must observe at the data-layer surface.
10. **Test passes on 500 (uncaught throw from supabase-js).** **Caught by Gate 1 + Gate 2 / SR-9.** Any `assert.equal(...error, null)` in Blocks 3/4/5 would NOT hold under an uncaught throw — `await` on the supabase-js call would propagate the rejection and fail the surrounding test before reaching `assert`. The guard-source "catch around query" obligation is additionally attested by Gate 2 / SR-9.
11. **Existing Day-1A workspace-guard or RLS tests break because the harness extension touched existing fixtures.** **Caught by Gate 1** — `node --conditions=react-server --test tests/auth/workspace-guard.spec.ts tests/rls/workspace-select-membership.spec.ts tests/rls/workspace-write-denial.spec.ts` exits non-zero. Required Phase-3 validation (§"Validation Commands").
12. **Existing Day-2A Phase-2 / Phase-2.5 policy-shape proofs break because Phase 3's row inserts change the catalog.** **Out-of-band: catalog-only.** `tests/rls/all-tables-have-rls.spec.ts` and `tests/rls/policy-shape.spec.ts` query `pg_class` / `pg_policies` / `information_schema.role_table_grants` — independent of row content. Harness row-level seeds do NOT affect their output. Re-running is OPTIONAL; if RED, that's a real signal (e.g., implementer accidentally landed a 004 migration in violation of §"Surface Audit").

## Validation Commands

Only commands that already exist in the repo, plus the new Phase-3 spec file. **No invented runners** (no `pnpm test`, `vitest`, `jest`, `npm run *`).

### Pre-requisite (manual, preserved from Phase 2 §"Prerequisite")

```bash
supabase start                                                   # local stack
supabase db reset                                                # re-applies 001 + 002 + 003 in order
supabase status                                                  # db container "Running"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\dt public.*"
# Expected: workspaces, workspace_members, channels, channel_members, messages
```

`supabase db reset` is approval-required per CLAUDE.md §"Approval-required actions" against any non-local project. Against the local stack (project ref matching the dev allowlist) it is the canonical reset path; implementer confirms locality before running.

### Phase 3 stop-condition commands

```bash
# New Phase-3 spec — exercises the data-layer pattern the guard uses:
node --conditions=react-server --test tests/auth/guard-failure-modes.spec.ts

# Existing Day-1A workspace-guard spec — must continue passing post-harness-extension:
node --conditions=react-server --test tests/auth/workspace-guard.spec.ts

# Existing Day-1A RLS specs — must continue passing post-harness-extension:
node --conditions=react-server --test \
  tests/rls/workspace-select-membership.spec.ts \
  tests/rls/workspace-write-denial.spec.ts

# Optional re-run only if the harness extension is suspected to interact with channel-table
# catalog/grant assertions (it should not — these specs query catalog, not row content):
node --conditions=react-server --test tests/rls/policy-shape.spec.ts

# Tracked-file whitespace check:
git diff --check                          # exit 0 expected

# Untracked-file whitespace — per Phase-2.5 §"Validation commands" semantics:
#   - Exit 0 OR 1 AND no stderr "whitespace error" / "trailing whitespace" /
#     "space before tab" / "indent with non-tab" diagnostic = PASS.
#   - Exit ≥ 2 OR any whitespace diagnostic on stderr = FAIL.
# After Phase 3 implementation, the new/modified untracked files in scope:
git diff --no-index --check /dev/null lib/auth/with-channel-guard.ts
git diff --no-index --check /dev/null tests/auth/guard-failure-modes.spec.ts
# tests/lib/supabase-test-harness.ts is committed; its whitespace is covered by
# `git diff --check` (it's modified, not untracked).
# docs/tasks/day-2a-phase-3-channel-guard-harness.md is untracked initially;
# whitespace check per the same semantics:
git diff --no-index --check /dev/null docs/tasks/day-2a-phase-3-channel-guard-harness.md
```

### Commands that MUST NOT run in Phase 3

Per CLAUDE.md §"Approval-required actions" + Phase-2.5 §"Validation commands":

- `pnpm build` — not required; Phase 3 is logical-layer + tests only.
- `pnpm install --frozen-lockfile` — no dependency change.
- `pnpm add` / `pnpm update` / any non-frozen install.
- `make repo-law` / `make fast-check` / `make tools-version-check` / `make governance-check` — Day 2B+ scope.
- `pnpm tsx scripts/seed.ts` / `pnpm tsx scripts/seed-cleanup.mjs` against any non-local project.
- `node scripts/check-bundle-leak.mjs` — Day-1A bundle-leak; not a Phase-3 gate.
- Day-1B header specs (`tests/security/headers.spec.ts`, `tests/auth/cache-control.spec.ts`).
- Day-3 realtime specs (do not exist yet).
- Phase-4 specs (`tests/rls/channel-list-membership.spec.ts`, `tests/auth/server-action-csrf.spec.ts`, `tests/auth/magic-link-replay.spec.ts`, `tests/util/run-isolation.spec.ts`) — none exist yet; Phase 3 does NOT create them.
- `git commit` of any kind without explicit authorization.
- `git push` / `gh pr create` / branch creation.
- `vercel` / `netlify` / any deploy command.

## Cut / Escalate Rules

Phase 3 implementation enters HALTED state (NOT GREEN, NOT PARTIAL) on any of:

1. **Testing requires creating an `app/**` route.** Pulls Phase 4 forward. Halt; the contract explicitly forbids this surface.
2. **`withChannelGuard` cannot be implemented without invoking Phase-4 artifacts.** Halt; surface the missing dependency.
3. **Harness extension breaks any Day-1A test.** Re-run is non-negotiable. If any of `workspace-guard.spec.ts`, `workspace-select-membership.spec.ts`, `workspace-write-denial.spec.ts` RED's, halt; do NOT edit the spec to "fix" it — the harness change is wrong.
4. **Service-role / admin client appears necessary for the guard.** Halt; contract forbids. Escalate for slice-doc revision.
5. **Denial shape cannot be made uniform at the data layer.** E.g., one denial path produces a non-null `error` instead of `null`. Halt; contract requires unified deny.
6. **Cross-workspace denial-B cannot be made load-bearing.** If review concludes the constraint is structurally unreachable in production data semantics, halt; slice-doc revision may be required.
7. **Any new migration appears necessary.** Halt; contract forbids `supabase/migrations/**` edits.
8. **The `!inner` PostgREST pattern does not behave as documented against the live local stack.** Phase 3 MAY switch to Choice-2 (§A.4). If neither choice works, halt and escalate.
9. **Any forbidden-adjacent-surface edit appears necessary.** Halt; surface the path and necessity; resolution is slice-doc revision.

Phase 3 is **BLOCKED** (not HALTED) if independent review concludes the slice contract itself is unimplementable. Resolution: revise this doc.

Phase 3 is **PARTIAL** if any of: not all three Phase-3 artifacts land; not all Gate-1 validation commands pass; any Gate-2 question returns WARN or BLOCK with unresolved evidence. Partial is NOT a ship state. Surface the gap; do NOT commit.

Note on Gate 2 outcomes: a Gate-2 WARN/BLOCK is resolved by implementation revision (read source → identify divergence from §A → fix `lib/auth/with-channel-guard.ts`), not by editing this slice contract. The contract is the binding spec; revising it to accept a non-conforming guard would void Gate 0. If review concludes the contract itself cannot be satisfied (e.g., `!inner` semantics genuinely unworkable AND Choice-2 also fails), then and only then is the slice doc revised under a new Gate-0 cycle.

## Independent Review Checklist (Gate 0 — slice-contract review)

This checklist is **Gate 0** — review of THIS slice contract before Phase 3 implementation begins. It is distinct from **Gate 2** (§"Layer 2 — Source Review Gate"), which runs against the implemented `lib/auth/with-channel-guard.ts` source AFTER Phase 3 implementation. The questions below evaluate the contract; the SR-1 … SR-12 questions in §"Layer 2 — Source Review Gate" evaluate the guard source.

Each lane has concrete questions. The reviewer answers each with PASS / WARN / BLOCK + evidence.

### `$analyze` lens (read-only repo grounding)

- Q1. Are the file paths in §"Current Repo State" actually present (or absent) as claimed at HEAD `31e2ff8`? Verify by `ls` / `find`.
- Q2. Does `tests/auth/workspace-guard.spec.ts` actually carry the comment about Playwright e2e? Quote the line.
- Q3. Do `lib/auth/with-session.ts` and `lib/auth/with-workspace-guard.ts` expose the types this doc references (`SessionContext`, `WorkspaceContext`)? Verify by reading the files.
- Q4. Does `tests/lib/supabase-test-harness.ts` currently carry only the Day-1A shape (no channel / message seeds)?
- Q5. Are `supabase/migrations/001/002/003` actually committed? Verify by `git log` against those paths.

### `security-review` lens (RLS / authz / trust-boundary)

- Q6. Does the unified-denial collapse in §A.5 close every distinguishable side-channel: redirect target, HTTP status (implied), log reason on the warn path, log fields? Identify any field omitted that could leak.
- Q7. Does the log shape in §A.7 exclude every secret-class field: email, JWT, cookie, `error.message`, `error.details`, `error.hint`, row contents (channel.name, channel.kind)?
- Q8. Does the no-admin-client constraint in §A.3 + adversarial case #3 close every transitive import path? Re-export, dynamic import, conditional import — anything missed?
- Q9. Is the pre-DB UUID-shape regex sufficient? Does it permit any malformed-but-Postgres-castable UUID form that could exercise an unexpected catalog path?
- Q10. Is logging `channel_id` an audit trail or a leak? (Expected: audit — caller's input.)
- Q11. Is the cross-workspace denial-B a real authz boundary in production, or only an artifact of the harness fixture?

### `database-schema-designer` lens (formal skill availability is harness-dependent; not loaded as a Skill in this session — applied as named analytical lens)

- Q12. Does Phase 3 require any new table, column, constraint, index, view, function, trigger, or schema-level grant? Expected: **no.** If yes, BLOCK.
- Q13. Are existing indexes (`channels.id` PK, `channel_members` PK `(channel_id, user_id)`, `channel_members_user_id_idx`) sufficient for the guard's single combined query to plan as index-bound, not sequential? Identify any expected sequential scan.
- Q14. Does the seed message in §B.6 require any schema change (e.g., `client_nonce` use)? Expected: **no** — `client_nonce` is nullable; the seed inserts `body` only.
- Q15. Does the `!inner` join via PostgREST require any view, RPC, or schema artifact? Expected: **no** — PostgREST feature against existing tables.

### `migration` lens (formal skill availability is harness-dependent; not loaded as a Skill in this session — applied as named analytical lens)

- Q16. Does Phase 3 add a new migration file? Expected: **no.** If yes, BLOCK.
- Q17. Does Phase 3 modify migration 001, 002, or 003? All three are committed; forward-only binds. Expected: **no.** If yes, BLOCK.
- Q18. Does the harness extension implicitly depend on a yet-unwritten migration (new column, new policy)? Expected: **no.**
- Q19. Is the `ON DELETE CASCADE` chain sufficient to make the extended cleanup idempotent and complete (no orphan rows)? Trace the chain: workspaces → channels → channel_members; workspaces → channels → messages; auth.users → workspace_members; auth.users → channel_members; auth.users → messages.
- Q20. Does Phase 3 require a `004_*.sql`? Expected: **no.** If yes, BLOCK.

### `qa-test-planner` lens (formal skill availability is harness-dependent; not loaded as a Skill in this session — applied as named analytical lens)

- Q21. Are denial-A, denial-B, denial-C mutually distinct failure modes (each exercising a different guard constraint)? Can any be reduced to another without changing guard behavior?
- Q22. Is denial-B's load-bearing negative-control (Block 4 step 3) sufficient to catch a regression that omits the `workspace_id` constraint?
- Q23. Could any Gate-1 block pass against a trivially false-positive implementation (e.g., a guard that always denies)? Does any block ALSO assert the accept-path? (Expected: no — Gate 1 does not assert the runtime accept-path. The accept-path is covered by Day-4 e2e at runtime, and by Gate 2 source review at the binding level — SR-2 verifies the guard composes through `withWorkspaceGuard` rather than always denying, SR-3 verifies the lookup is correctly formed, and SR-5/SR-6 verify only the deny branches call `redirect()`. Reviewer notes acceptability of the Gate-1 + Gate-2 + Day-4 split.)
- Q24. Does the harness extension preserve all Day-1A test invariants? Trace each Day-1A assertion against the extended fixture.
- Q25. Is the same-shape denial assertion in Block 6 byte-identical at the data-layer surface, or does any field (e.g., a partial channel row) leak through one of A/B/C?
- Q26. Is the pre-DB UUID regex test (Block 7) sufficient against the regex specified in §A.1? Does it cover both positive and negative inputs?

### `code-review` (Relay-local `$code-review` skill)

- Q27. Does the guard signature in §A match the existing `withSession` / `withWorkspaceGuard` pattern? Identify any deviation.
- Q28. Is composition through `withWorkspaceGuard` (per §A.2) actually possible given the existing `WorkspaceContext` shape? Verify by reading `lib/auth/with-workspace-guard.ts`.
- Q29. Is the `logDeny` helper duplication acceptable for week 1, or should it be extracted? (Expected: duplication acceptable; extraction is Day-6+.)
- Q30. Are the validation commands sufficient to catch every §A obligation? Identify any obligation not exercised by the test or by review.

### `$ai-slop-cleaner` lens (planning lens)

- Q31. Does the doc add any abstraction layer beyond week-1 requirements (fluent assertion DSL, guard-builder, fixture factory)? Expected: **no.**
- Q32. Does the doc retain fallback-like logic (e.g., "retry the lookup without `workspace_id`")? Expected: **no.**
- Q33. Are any of the additions over-specified for what Phase 3 needs (e.g., the seed message in §B.6)? Identify what could be cut without losing safety.
- Q34. Does the doc carry stale wording from Phase 2 / Phase 2.5 contracts that no longer applies?

### `$caveman-review` lens (final readiness, terse)

- Q35. Three sentences max: READY, PARTIAL, or BLOCKED for implementation? State verdict + one-line rationale.

## Skill Coverage Matrix

| Skill / lens | Availability | Planning question answered | Result | Residual risk |
|---|---|---|---|---|
| `superpowers:using-superpowers` | loaded | Protocol for invoking superpowers in this session. | Loaded via session-start system reminder; used for skill discovery. | None. |
| `superpowers:writing-plans` | loaded | Structure for a multi-step implementation plan. | Applied — explicit §A/§B/§C tasks; exact file paths; no placeholders; validation commands; stop conditions. | None. |
| `superpowers:test-driven-development` | loaded | RED-GREEN protocol for the new spec. | Applied — every Block in §C is phrased as an observable assertion BEFORE the guard exists. Block 7 is a pure-regex test writeable with zero infrastructure. The guard is implemented to make these RED tests GREEN. | None — the implementer follows RED-GREEN per the skill during execution. |
| `superpowers:requesting-code-review` | loaded | What review surface needs carving for this slice. | Applied — §"Independent Review Checklist" gives concrete questions to each reviewer lane. | None. |
| `$analyze` (Relay-local) | loaded | Is current repo state as the doc claims? | Applied — §"Current Repo State" pins HEAD, file presence/absence, line counts, commit shas. Re-verifiable by `git status` + `ls`. | None. |
| `security-review` | loaded | What auth / RLS / trust-boundary risks does Phase 3 carry? | Applied — unified-denial collapse (§A.5), log shape (§A.7), no-admin-client (§A.3), pre-DB UUID rejection (§A.1), no-500 contract (§A.8). | Day-6+ follow-up: fault-injection coverage of the catch-around-query branch (§C Block 8). |
| `database-schema-designer` | **formal skill availability is harness-dependent; not loaded as a Skill in this session — applied as named analytical lens** | Does Phase 3 require any schema/table/index/constraint/migration change? | **No** — verified by Q12–Q15. The guard reads existing schema; the harness extension uses existing columns + cascade semantics. | None. |
| `migration` | **formal skill availability is harness-dependent; not loaded as a Skill in this session — applied as named analytical lens** | Does Phase 3 require a new migration or edits to 001/002/003? | **No** — verified by Q16–Q20. All three migrations are committed and forward-only-locked. Cascade chain is sufficient for cleanup idempotence. | None. |
| `qa-test-planner` | **formal skill availability is harness-dependent; not loaded as a Skill in this session — applied as named analytical lens** | Are guard-failure tests load-bearing, adversarial, same-shape, and resistant to false-positive implementations? | **Yes** — verified by Q21–Q26. Denial-A/B/C are mutually distinct. The broken-guard negative-control proves denial-B is load-bearing. Accept-path is intentionally OUT (Day-4 e2e + Gate 2). | Day-4 e2e MUST exist to close the runtime accept-path gap. Gate 2 source review covers the binding-level accept-path attestation. Logged as a Day-4 dependency. |
| `$ai-slop-cleaner` (Relay-local, planning lens) | loaded | Does the doc add abstraction, fallback logic, or overclaim? | No new abstraction (composition only). No fallback (unified deny). No overclaim (accept-path explicitly out-of-scope). Stale wording check passed. | None. |
| `$caveman-review` | loaded | Final terse readiness check. | **READY** — see §"Implementation Handoff". | None. |

## Implementation Handoff

**PENDING — do not implement until this slice doc receives Gate 0 review PASS.**

Next prompt type: **independent slice-contract review** against §"Independent Review Checklist (Gate 0 — slice-contract review)". The reviewer answers each question with PASS / WARN / BLOCK + evidence. Implementation is unblocked only when every Gate-0 question returns PASS (or WARN with documented rationale that does NOT change the contract).

**After Gate 0 closes**, the Phase 3 implementation proceeds against §"Implementation Requirements" §A / §B / §C. Implementation completion requires BOTH:

- **Gate 1 PASS** — every command in §"Validation Commands" exits per the criteria there.
- **Gate 2 PASS** — every SR-1 … SR-12 question in §"Layer 2 — Source Review Gate" returns PASS with cited file:line evidence.

Neither gate alone is sufficient. Phase 4 remains BLOCKED until Phase 3 implementation Gate 2 closes.
