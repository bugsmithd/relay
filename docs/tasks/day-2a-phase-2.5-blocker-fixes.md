# Day 2A — Phase 2.5: OMX blocker fixes (Phase 2 hardening slice)

Source: OMX review of Phase 2 (Phase 2 implementation is BLOCKED on review). Phase 2.5 is the named-blocker fix slice that must close OMX review BEFORE Phase 3 begins.
Status: planning-only slice contract derived from OMX-review blockers + current repo state at 2026-05-12.
Predecessor: Phase 2 — `tests/rls/all-tables-have-rls.spec.ts` + `tests/rls/policy-shape.spec.ts` (both uncommitted, OMX-blocked). Phase 1 — `supabase/migrations/002_channels_and_messages.sql` (uncommitted; subject to a forward-only in-place edit ONLY if Phase 2.5 work surfaces a Day-2A-table ACL/policy defect that 003 cannot cover, per §"Migration rules").

## Purpose

Close five OMX-named blockers that prevent Phase 2 from passing review:

1. **HIGH** — `messages` INSERT author check can false-pass under substring matching.
2. **HIGH** — Predicate-shape tests prove substrings, not exact predicates; broad extra logic slips through.
3. **HIGH** — Workspace tables (`workspaces`, `workspace_members`) still hold broad `authenticated` SQL grants (including TRUNCATE) per the live catalog, even though `001_*.sql` revoked only `anon`.
4. **MEDIUM** — Local-DB guard accepts any localhost DB; a wrong local Postgres on the same host produces misleading green.
5. **LOW** — `docs/tasks/day-2a-trust-boundary-data-path.md` and `docs/tasks/day-2a-phase-2-policy-shape-tests.md` carry stale substring-proof and ambiguous process wording.

Phase 2.5 is **proof-tightening + ACL-hardening + helper-tightening + doc-truth-up**. It is NOT a Phase 3 advance. It is NOT a refactor. It does NOT touch app code, guards, semgrep, evidence, or commit history.

## Current repo state (verified at slice-doc authoring time)

- Branch is `main`. Tracked working tree matches `origin/main`.
- `git ls-files supabase/migrations/` returns exactly `supabase/migrations/001_workspace_identity.sql` (committed in `e25de80 Day 1A: auth substrate, RLS substrate, gates, evidence`).
- `git ls-files tests/rls/` returns exactly `tests/rls/migration-rls-enabled.spec.ts`, `tests/rls/workspace-select-membership.spec.ts`, `tests/rls/workspace-write-denial.spec.ts` (all committed in `e25de80`).
- `git status --short` reports five untracked files: `docs/tasks/day-2a-phase-2-policy-shape-tests.md`, `docs/tasks/day-2a-phase-2.5-blocker-fixes.md` (this slice doc — a preexisting OMX-review artifact, NOT Phase 2.5 implementation output), `supabase/migrations/002_channels_and_messages.sql`, `tests/rls/all-tables-have-rls.spec.ts`, `tests/rls/policy-shape.spec.ts`. The Phase 2.5 implementation MAY modify this slice doc in-place to record review-pass corrections (as this REQUEST-CHANGES pass did), but the implementation MUST NOT delete it, rewrite its scope, or treat it as one of the six allowed-edit implementation paths.
- Phase 3 has NOT started. `lib/auth/with-channel-guard.ts` does NOT exist on disk.
- No `app/api/messages/route.ts`, no `app/w/[workspaceSlug]/actions.ts`, no `proxy.ts` refactor.
- `tests/lib/supabase-test-harness.ts` carries the Day-1A shape only (no `channelA1`, no `workspaceOnlyMember`, no `channelB1`); harness extension remains a Phase 3 deliverable.
- `tests/lib/test-target-guard.ts` enforces `SUPABASE_URL` host allowlist + service-role JWT `ref`/`iss` claim binding — that lane is unaffected by Phase 2.5.
- `psql 18.3` is on host PATH at `/opt/homebrew/opt/libpq/bin/psql`.
- `pg` (node-postgres) is NOT a dependency. Adding it remains a `pnpm add` approval gate (out of slice).
- `supabase/config.toml:13` exposes only `public, graphql_public` via PostgREST — `pg_catalog`/`pg_policies`/`information_schema` reads continue via the Phase 2 `psql` subprocess pathway.
- Migration 002 currently encodes (on disk, uncommitted) `revoke all on public.channels|channel_members|messages from authenticated, anon, public;` then `grant select on public.channels, public.channel_members to authenticated; grant select, insert on public.messages to authenticated;`. Day-2A-table ACL hardening is therefore already correct in 002.
- Migration 001 (committed) does NOT revoke broad privileges from `authenticated` or `public` on `workspaces` / `workspace_members`. The live catalog therefore exposes Supabase's default `ALL`-to-`authenticated` privileges on those two tables — TRUNCATE, REFERENCES, TRIGGER, UPDATE, DELETE included. This is the Blocker-3 surface.

## Exact blockers being fixed

### Blocker 1 (HIGH) — `messages` INSERT author check can false-pass

**Defect.** `tests/rls/policy-shape.spec.ts` (uncommitted) asserts the INSERT policy via:

```
p.withCheck.includes("user_id = auth.uid()")
```

That substring is non-unique inside `with_check`. The canonical `with_check` (from migration 002) reads (whitespace-normalized):

```
((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM channel_members cm WHERE ((cm.channel_id = messages.channel_id) AND (cm.user_id = auth.uid())))))
```

The substring `user_id = auth.uid()` appears TWICE in the canonical form:

- Once at the TOP level — `(user_id = auth.uid())` — pinning author identity.
- Once inside the membership subquery as `cm.user_id = auth.uid()` — pinning membership user binding.

A buggy migration that drops the top-level author predicate but keeps the membership subquery — e.g.,

```sql
with check (
  exists (
    select 1
    from public.channel_members cm
    where cm.channel_id = messages.channel_id
      and cm.user_id    = auth.uid()
  )
)
```

— would still satisfy `withCheck.includes("user_id = auth.uid()")` because `cm.user_id = auth.uid()` contains that substring. The author identity check would be GONE, allowing any channel member to forge messages attributed to another channel member, but Phase 2's test would GREEN.

**Fix obligation.** The Phase-2.5 INSERT-policy assertion MUST use Option A. Option A is **mandatory**. Substring-plus-structural-rejection is **not** sufficient proof for this slice.

- **Option A (MANDATORY) — Exact normalized `with_check` equality.** After whitespace normalization (the existing `regexp_replace(coalesce(with_check, ''), '[[:space:]]+', ' ', 'g')` in `getPolicy`), assert deep equality against the canonical form captured from the live local stack at implementation time. If the local-stack form is `((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM channel_members cm WHERE ((cm.channel_id = messages.channel_id) AND (cm.user_id = auth.uid())))))`, the assertion compares against that exact string. Any deviation — extra clause, missing clause, reordered AND chain, different parenthesization — fails.

- **Option B (NOT PERMITTED for this slice — explanatory note only)** — A structural top-level-vs-subquery split (strip the membership subquery, assert top-level predicate distinctly, assert subquery shape separately) was considered. It is **not** an allowed implementation path for Phase 2.5. Reason: with substring presence checks remaining, an adversarial migration adding a tacked-on top-level AND clause (see F-2) can satisfy the structural assertions yet broaden the predicate. Exact normalized `with_check` equality (Option A) is the only assertion shape this slice accepts. Documented here so a future slice considering structural-only proofs has the rejection rationale; do not implement it in Phase 2.5.

Option A also requires:
- The membership subquery contained inside the canonical `with_check` form MUST prove `cm.channel_id = messages.channel_id` (channel correlation) AND `cm.user_id = auth.uid()` (membership user binding) — by virtue of the exact-equality assertion against the canonical form, both predicates are pinned.
- The top-level author predicate `user_id = auth.uid()` MUST appear **outside** the EXISTS subquery in the canonical form — by virtue of the exact-equality assertion, it is observably distinct from the membership user binding.

### Blocker 2 (HIGH) — Predicate-shape tests prove substrings, not exact predicates

**Defect.** The four predicate-shape tests in `policy-shape.spec.ts` (channels SELECT, channel_members SELECT, messages SELECT, messages INSERT) check `includes("…")` for three or four required substrings plus `!includes("workspace_members")` plus `!/\bOR\b/i`. None of those checks reject EXTRA broad logic that ANDs with the required predicate.

**False-pass adversarial migrations that Phase 2 GREENs and Phase 2.5 MUST RED.** Each example below has the required substrings, no `OR`, no `workspace_members`, yet broadens or invalidates the authorization contract:

- **B-1 — Extra true-AND clause:**
  ```sql
  using (
    exists (select 1 from public.channel_members cm where cm.channel_id = channels.id and cm.user_id = auth.uid())
    AND (1 = 1)
  )
  ```
  Effectively unchanged authz, but proves the test ignores any extra top-level AND clause. A future migration could land a non-trivial extra clause this way.
- **B-2 — Extra AND clause that leaks rows:**
  ```sql
  using (
    exists (select 1 from public.channel_members cm where cm.channel_id = channels.id and cm.user_id = auth.uid())
    AND (channels.kind <> 'never-matches-any-real-kind')
  )
  ```
  No `OR`, no `workspace_members`, contains the required substrings — passes Phase 2. Authz is still tied to channel membership in this exact example, but the construction proves the assertion does not reject arbitrary tacked-on predicates.
- **B-3 — `UNION ALL` widening the EXISTS subquery:**
  ```sql
  using (
    exists (
      select 1 from public.channel_members cm
      where cm.channel_id = channels.id and cm.user_id = auth.uid()
      union all
      select 1 from public.channel_members cm
      where cm.channel_id = channels.id  -- MISSING user_id filter
    )
  )
  ```
  Required substrings present. No `OR`. No `workspace_members`. The `UNION ALL` second leg returns rows for ANY user once a single channel member exists — every authenticated user gains SELECT on every channel that has at least one member. Phase 2 GREENs; Phase 2.5 MUST RED.
- **B-4 — Set-operation alternate path (INTERSECT, EXCEPT analogues):** any `(EXCEPT|INTERSECT|UNION)( ALL)?` token inside the policy expression breaks the "AND-only chain of locked predicates" model the policy contract assumes.

**Fix obligation.** Each predicate-shape assertion MUST use Option A. Option A is **mandatory**. Substring-plus-structural-rejection is **not** sufficient proof for this slice.

- **Option A (MANDATORY) — Exact normalized `qual`/`with_check` equality** against the canonical form captured from the live local stack. Captured forms for the four policies, suggested anchors (implementer verifies against the live stack and adjusts ONLY for `psql`-display drift, never to widen the predicate):

  ```
  channels.channels_select_member_only.qual:
    (EXISTS ( SELECT 1 FROM channel_members cm WHERE ((cm.channel_id = channels.id) AND (cm.user_id = auth.uid()))))

  channel_members.channel_members_select_self.qual:
    (user_id = auth.uid())

  messages.messages_select_channel_member.qual:
    (EXISTS ( SELECT 1 FROM channel_members cm WHERE ((cm.channel_id = messages.channel_id) AND (cm.user_id = auth.uid()))))

  messages.messages_insert_self_and_member.with_check:
    ((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM channel_members cm WHERE ((cm.channel_id = messages.channel_id) AND (cm.user_id = auth.uid())))))
  ```

- **Option B (NOT PERMITTED for this slice — explanatory note only)** — A structural rejection model (set-operation token ban + EXISTS-count ceiling + SELECT-count ceiling + retained substring checks) was considered. It is **not** an allowed implementation path for Phase 2.5. Reason: such a model does not reject F-2 (tacked-on top-level `AND (1 = 1)` clause); the predicate would still satisfy every structural check while broadening the policy. Exact normalized `qual`/`with_check` equality (Option A) is the only assertion shape this slice accepts. Documented here so a future slice considering structural-only proofs has the rejection rationale; do not implement it in Phase 2.5.

Option A also retains, by construction:
- **The exact allowed policy set assertion** — the existing `deepStrictEqual` against the four-row expected set MUST continue to pass against the canonical state. Phase 2.5 does NOT loosen the exact-policy-set check; it tightens the per-policy predicate-shape check to exact-form equality.
- **`workspace_members` / `OR` token bans** in `assertNoForbiddenTokens` remain in place as defense-in-depth visibility for future readers; the exact-equality assertion already subsumes them.

### Blocker 3 (HIGH) — Workspace tables still hold broad `authenticated` SQL grants

**Defect.** Migration `001_workspace_identity.sql` (committed in `e25de80`) executes only `revoke all on public.workspaces from anon; revoke all on public.workspace_members from anon;`. It does NOT revoke broad privileges from `authenticated` or `public`. Supabase's default project grants `ALL` privileges on `public.*` to `authenticated`. The live catalog therefore exposes — on top of `relrowsecurity = true` — the following privileges to `authenticated` on `workspaces` and `workspace_members`:

- `SELECT` — needed (gated by RLS).
- `INSERT`, `UPDATE`, `DELETE` — NOT needed; RLS blocks the row writes, but the operation is attempted and observable; defense-in-depth violation.
- `TRUNCATE` — **bypasses RLS entirely** (CLAUDE.md §"Data model" footnote on TRUNCATE; migration 002 §line 41-49 already names this risk for Day-2A tables). An authenticated user with TRUNCATE on `workspaces` can DROP every row regardless of RLS.
- `REFERENCES`, `TRIGGER` — secondary risk surfaces (FK-creation reveals row existence; trigger creation can intercept writes).

This is the same defense-in-depth gap migration 002 already closed for `channels` / `channel_members` / `messages`. It is open for `workspaces` / `workspace_members`.

**Fix obligation — migration.** Add a NEW forward-only migration `supabase/migrations/003_harden_workspace_acl.sql`. It MUST:

- Revoke ALL privileges from `authenticated` AND `public` on `public.workspaces` AND `public.workspace_members`:
  ```sql
  revoke all on public.workspaces        from authenticated;
  revoke all on public.workspaces        from public;
  revoke all on public.workspace_members from authenticated;
  revoke all on public.workspace_members from public;
  ```
  (Note: 001 already revoked from `anon`; 003 does not duplicate that revoke — re-revoking is idempotent but adds noise. If the implementer chooses to re-revoke `anon` defensively, that is acceptable.)
- Grant only the minimal SELECT privilege to `authenticated` on each:
  ```sql
  grant select on public.workspaces        to authenticated;
  grant select on public.workspace_members to authenticated;
  ```
- NOT grant `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` / `REFERENCES` / `TRIGGER` to `authenticated`, `anon`, or `PUBLIC`.
- NOT touch `001_*.sql` — 001 is committed; forward-only invariant (CLAUDE.md §"Data model" + OR-DB-2) makes in-place edits illegal. The forward-only-edit-while-uncommitted carve-out from CLAUDE.md does NOT apply to 001 because 001 is committed in `e25de80`.
- NOT touch `002_*.sql` for workspace-table ACL — `002` already correctly hardens Day-2A tables; workspace-table hardening belongs in `003` so 002's OMX-reviewed shape stays intact.
- NOT introduce `SECURITY DEFINER` functions, broad `to public` grants, or `replica identity full`.
- NOT add a new policy. RLS policies on `workspaces` / `workspace_members` are already correct (from 001); Phase 2.5 is an ACL hardening, not a policy change.

**Fix obligation — tests.** Extend `tests/rls/policy-shape.spec.ts` so the existing grant-matrix assertions cover ALL FIVE app tables, not just the three Day-2A tables. Concretely, the three existing grant tests — `authenticated has only the minimal SQL grants on Day-2A tables`, `anon has zero SQL grants on Day-2A tables`, `PUBLIC has zero SQL grants on Day-2A tables`, and the negative-privilege-matrix test `no UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER granted to anon, authenticated, or PUBLIC` — MUST be extended to include `workspaces` and `workspace_members` in their `table_name IN (…)` filters, AND their expected-grant arrays MUST include the new workspace rows.

Expected `authenticated` grant set across all five tables after 003 applies (ordered by table_name, privilege_type):
```
(channel_members, SELECT)
(channels,        SELECT)
(messages,        INSERT)
(messages,        SELECT)
(workspace_members, SELECT)
(workspaces,        SELECT)
```

Expected `anon` grant rows across all five tables: zero.
Expected `PUBLIC` (and lowercase `public`) grant rows across all five tables: zero.
Expected dangerous-privilege rows (UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER granted to anon/authenticated/PUBLIC/public) across all five tables: zero. `service_role` remains intentionally excluded as the trusted BYPASSRLS administrative role.

**Note (intentional scope.)** Phase 2.5 does NOT also extend the policy-shape predicate assertions to `workspaces` / `workspace_members` SELECT policies (those exist in 001 and are not in scope for OMX Blocker 2). If the implementer notices a defect in the 001 policies during Phase 2.5 work, halt and escalate per §"If a test goes RED"; do NOT silently rewrite 001 or add a 004 migration to "fix" it within this slice.

### Blocker 4 (MEDIUM) — Local-DB guard allows any localhost DB

**Defect.** The `psqlQuery` helper duplicated in `tests/rls/all-tables-have-rls.spec.ts:21-37` AND `tests/rls/policy-shape.spec.ts:26-42` checks ONLY the host:

```
if (!LOCAL_HOSTS.has(host)) {
  throw new Error(`Refuse to run psql against non-local host: ${host}`);
}
```

`LOCAL_HOSTS = { "127.0.0.1", "localhost", "::1" }`. A wrong local Postgres on `127.0.0.1:5432/some_other_db` — a developer's personal/work DB on the same machine — passes the guard. If `DATABASE_URL` is accidentally set to that DB, the tests run against the wrong target and may produce misleading green (the wrong DB happens to lack the expected policies, or — worse — happens to have policies that incidentally match).

**Fix obligation — helper tightening (duplicated identically in both spec files, per Phase 2's no-harness-extension decision).** The guard MUST check ALL THREE of: host AND port AND database name.

- **Host:** accept `127.0.0.1`, `localhost`, and bracket-normalized `::1` (matches the existing set; the existing bracket-stripping at `replace(/^\[|\]$/g, "")` remains correct).
- **Port:** accept ONLY `54322` (the Supabase-local direct-Postgres port; `54321` is PostgREST/Kong, not directly queryable by `psql`). Reject every other port, INCLUDING the empty port (default Postgres `5432` when the URL omits a port).
- **Database name:** accept ONLY `postgres` (the Supabase-local default DB name). Reject every other DB name.

**Rejection examples Phase 2.5 MUST throw on** (each is a positive false-pass test for the guard):

- `postgresql://postgres:postgres@127.0.0.1:5432/postgres` — wrong port; throw.
- `postgresql://postgres:postgres@127.0.0.1:54322/notpostgres` — wrong DB; throw.
- `postgresql://postgres:postgres@127.0.0.1/postgres` — implicit default port 5432; throw.
- `postgresql://postgres:postgres@evil.host:54322/postgres` — non-local host; throw (already rejected today; assertion remains).
- `postgresql://postgres:postgres@localhost:54322/template1` — wrong DB; throw.
- `postgresql://postgres:postgres@[::1]:5432/postgres` — wrong port; throw (bracketed-IPv6 form continues to be host-stripped to `::1` then matched against LOCAL_HOSTS, but the port check now fires).

**Accepted examples Phase 2.5 MUST permit:**

- `postgresql://postgres:postgres@127.0.0.1:54322/postgres` — canonical.
- `postgresql://postgres:postgres@localhost:54322/postgres` — host alias.
- `postgresql://postgres:postgres@[::1]:54322/postgres` — IPv6 form, bracket-stripped.

**Override discipline.** Do NOT introduce a new `ALLOW_INSECURE_DATABASE_URL=1`-style escape hatch. The existing `DATABASE_URL` env-var override is retained — the helper accepts a `DATABASE_URL` value provided it passes host+port+db validation. There is no other repo pattern for overriding test-target validation today, and Phase 2.5 will not add one. If the implementer believes an override is needed (it should not be), halt and escalate before adding one.

**URL-parse robustness.** Parse with `new URL(dbUrl)`:
- `url.hostname` — host check (existing bracket-strip stays).
- `url.port` — port check. **Empty-string port (no port supplied) MUST be rejected**, not silently defaulted; the implementer must not call `Number(url.port || "5432")`-style fallback.
- `url.pathname` — DB-name check. WHATWG URL parses `postgresql://h:p@host:port/dbname` such that `pathname === "/dbname"`. Strip the leading `/` and compare against the literal `"postgres"`. **Empty `pathname` (no DB-name supplied) MUST be rejected.**
- A malformed URL (`new URL` throws) MUST propagate as a clear error, not silently default.

The guard MUST throw with a clear, specific message that names the offending field (e.g., `Refuse to run psql against non-local host: <host>`, `Refuse to run psql against non-Supabase-local port: <port>`, `Refuse to run psql against non-default database: <db>`). No silent skip.

### Blocker 5 (LOW) — Docs stale / ambiguous

**Defect.** Two doc files describe the Phase 2 proof contract with the weaker substring-only model. After Phase 2.5, those descriptions are factually wrong.

**Files in scope (BOTH must be edited; NOTHING ELSE):**

- `docs/tasks/day-2a-trust-boundary-data-path.md`
- `docs/tasks/day-2a-phase-2-policy-shape-tests.md`

**Required edits — narrow truth-up, NOT a rewrite.** Each edit MUST be the minimum text change that brings the doc in line with the Phase 2.5 contract.

In `docs/tasks/day-2a-trust-boundary-data-path.md`:
- §Must Ship #8 `tests/rls/policy-shape.spec.ts` bullet currently says `qual` "contains the substring `auth.uid()` AND the substring `channel_members`". Update to reference the Phase 2.5 contract: **exact normalized `qual` / `with_check` equality (Option A only)** against the canonical form captured from the live local stack, for all four predicate assertions. Substring-only and substring-plus-structural-rejection proofs are explicitly rejected; see Phase 2.5 §Blocker 1 / §Blocker 2. Cite this Phase 2.5 doc.
- §Stop Condition #4 currently lists the substring-claim bullets. Update to the Phase 2.5 contract.
- §TDD/false-pass step 3 currently says "anchor assertions against `pg_policies` row content, not raw migration SQL" — that sentence stays. ADD a sub-bullet noting that substring-presence alone is insufficient and the Phase 2.5 contract requires **exact normalized `qual` / `with_check` equality (Option A only)**; substring-plus-structural-rejection is explicitly rejected.
- §"Day 2A sequencing" Phase 2 sentence "expected GREEN against the Phase-1 migration. If RED, the Phase 1 migration is wrong" — preserve halt/escalate rule. ADD a Phase-2.5 row to the sequencing table that sits between Phase 2 and Phase 3; reference this doc for scope.

In `docs/tasks/day-2a-phase-2-policy-shape-tests.md`:
- §"Scope: Phase 2 ONLY" sentence "the correct shape — `auth.uid()` + `channel_members` substring" — update wording to acknowledge Phase 2.5's tightening; the original Phase 2 substring contract is the BASELINE that Phase 2.5 supersedes for the four predicate assertions and the four grant assertions.
- §"Test file 2 — `tests/rls/policy-shape.spec.ts`" Assertion list — annotate (do NOT rewrite) the four predicate assertions (channels SELECT, channel_members SELECT, messages SELECT, messages INSERT) and the three grant assertions and the negative-privilege-matrix assertion with a Phase-2.5 superseded-by note pointing to this doc.
- §"False-pass guards" — add a Phase-2.5 note that the listed guards are the Phase-2 baseline; the Phase-2.5 contract supersedes them with **exact normalized `qual` / `with_check` equality (Option A only)** for the four predicate assertions, AND the extended five-table grant matrix per §Blocker 3 of this Phase 2.5 doc. Substring-plus-structural-rejection is explicitly rejected.
- §"Allowed edits" — annotate that Phase 2.5 expands the allowed edit surface to include `supabase/migrations/003_harden_workspace_acl.sql` AND (conditionally) `supabase/migrations/002_channels_and_messages.sql` AND both spec files AND both doc files. The Phase-2 allowed-edit list is the baseline; Phase 2.5 supersedes it for blocker-fix work.
- §"Stop condition" — clarify that Phase 2 was BLOCKED at OMX review; Phase 2.5 is the named-blocker fix slice and Phase 2's stop condition is reachable only through Phase 2.5.
- Halt/escalate rule (§"If a test goes RED") MUST be preserved verbatim — Phase 2.5 inherits it and does NOT relax it.

**Do NOT edit** (preserves planning-only roadmap stability — Phase 2.5 is not a roadmap rewrite):

- `.planning/claude-code-slack-agent-gates-week1-grounded-20260509.md`
- `AGENTS.md`
- `CLAUDE.md`
- `docs/decisions/**`
- `README.md`
- Any other doc file under `docs/tasks/**` besides the two named above.

## Allowed edits (Phase 2.5 implementation surface)

The Phase 2.5 implementation that this slice contract gates is permitted to Create or Modify ONLY:

| Action  | Path | Purpose |
|---------|------|---------|
| Create  | `supabase/migrations/003_harden_workspace_acl.sql` | Blocker 3 — revoke broad privileges from `authenticated` AND `public` on `workspaces` / `workspace_members`, grant minimal `SELECT` to `authenticated`. Forward-only. |
| Modify  | `tests/rls/policy-shape.spec.ts` | Blockers 1 + 2 + 3 + 4 — exact normalized `qual` / `with_check` equality (Option A only) for the four predicate assertions, grant matrix extended to all five app tables, duplicated `psqlQuery` local-DB guard tightened in-place. |
| Modify  | `tests/rls/all-tables-have-rls.spec.ts` | Blocker 4 ONLY — tighten the duplicated `psqlQuery` local-DB guard. No assertion changes; the all-five-tables enumeration assertion is unchanged. |
| Modify  | `supabase/migrations/002_channels_and_messages.sql` | **Conditional, halt-and-escalate path.** Only if Phase 2.5 work surfaces a real ACL or policy defect in a Day-2A table (channels / channel_members / messages) that 003 cannot reach. Edit is legal because 002 is still uncommitted (CLAUDE.md §"Data model" forward-only-edit-while-uncommitted carve-out) — but the OMX review of Phase 1 is a soft contract; escalate to the user with defect + proposed diff before editing. |
| Modify  | `docs/tasks/day-2a-trust-boundary-data-path.md` | Blocker 5 — narrow truth-up edits per §"Blocker 5" obligations. |
| Modify  | `docs/tasks/day-2a-phase-2-policy-shape-tests.md` | Blocker 5 — narrow truth-up edits per §"Blocker 5" obligations. |

That is the exhaustive Phase 2.5 implementation surface. Six paths.

## Forbidden edits (Phase 2.5)

NOT permitted under any condition. Each is OUT of slice; if Phase 2.5 work appears to require any of these, halt and escalate.

- `supabase/migrations/001_workspace_identity.sql` — committed in `e25de80`. Forward-only invariant + plan §"Locked Invariants" §"Data Model" forbid in-place edits to committed migrations.
- `supabase/migrations/004_*.sql` or later — Phase 2.5 needs exactly one new migration (003).
- `lib/auth/with-channel-guard.ts` — Phase 3 deliverable. Does not exist on disk. Phase 2.5 does not create it.
- `lib/auth/**` — Phase 3 scope.
- `lib/supabase/admin.ts` — trust-boundary, Day 1A scope.
- `lib/supabase/**` — Day 1A scope.
- `app/**` — Phase 4+ scope.
- `proxy.ts` — Phase 4 refactor (carry-forward Finding 4 of the broad Day 2A doc).
- `middleware.ts` — Day 1B locked.
- `tests/lib/supabase-test-harness.ts` — Phase 3 harness-extension scope (channelA1, workspaceOnlyMember, channelB1, seed message).
- `tests/lib/test-target-guard.ts` — different lane (supabase-js target validation). Untouched.
- `tests/auth/**`, `tests/api/**`, `tests/security/**`, `tests/realtime/**`, `tests/util/**` — unrelated to Phase 2.5 surface.
- `tests/rls/migration-rls-enabled.spec.ts` — committed, static-SQL-grep. Phase 2.5 does NOT modify it; the new 003 migration is automatically swept up by the existing glob `supabase/migrations/**.sql`. **Verify by running the existing spec post-003 (no test changes required).**
- `tests/rls/workspace-select-membership.spec.ts`, `tests/rls/workspace-write-denial.spec.ts` — committed, Day 1A. Untouched. Phase 2.5 does NOT introduce write-denial coverage for `workspaces` / `workspace_members` via supabase-js; the SQL-grant matrix in `policy-shape.spec.ts` is the Phase 2.5 mechanism. (If `workspace-write-denial.spec.ts` results change post-003 because of the tighter grants, that is a Day-1A-spec breakage — halt and escalate; do NOT edit either spec to "fix" it.)
- `semgrep/**` — Phase 7 scope. Including `no-raw-pg-client.yml` (Phase 7 floor) which would interact with the `psql` subprocess helper (it would NOT — `psql` is a child-process spawn, not a `pg` import, per Phase 2 §"Forward concern"). Phase 2.5 introduces no Semgrep work.
- `evidence/**` — Day 2B scope. No manifest creation. No fixture files. No SHA256 work. No `claude-authz-review.json` / transcript fabrication.
- `Makefile` — no new targets, no extension of `repo-law`, `fast-check`, `tools-version-check`, or `governance-check` blocks.
- `package.json` — no new dependencies (no `pg`, no `zod`, no helpers). No new scripts. No script-arg changes. `pnpm install --frozen-lockfile` only; no `pnpm add`/`pnpm update`.
- `.npmrc`, `.gitignore`, `.editorconfig`, top-level config files — untouched.
- `.github/workflows/**` — Day 2B + 5 scope.
- `.claude/**` — Day 2B harness scope (PreToolUse hook, skills, agents). Phase 2.5 does not introduce any.
- `docs/decisions/**` — Day 2A Phase 8 ADR scope. Phase 2.5 doesn't add or edit an ADR.
- Any file under `docs/` besides the two named in §"Blocker 5".
- Any `.planning/**` file — roadmap stability.
- Any commit, branch, or push action. No `git commit`. No `git push`. No `gh pr create`.
- Any `pnpm build`, `pnpm install`, `make repo-law`, or Day-1B/Day-2B harness command. Phase 2.5's surface does not require them.
- Phase 3 work of any kind (channel-guard HOF, harness extension, guard-failure-modes spec, route-contract spec, server-action CSRF spec, magic-link replay spec, run-isolation spec, channel-list-membership spec).

## Migration rules

- `001_workspace_identity.sql` is **COMMITTED** in `e25de80`. Forward-only invariant + plan §"Data Model" forbid in-place edits to committed migrations. To alter 001's grants, the only legal mechanism is a NEW numbered migration.
- `002_channels_and_messages.sql` is **UNCOMMITTED** (`git status` reports `??`). Per CLAUDE.md §"Data model", forward-only-edit-while-uncommitted IS legal — but 002 was OMX-reviewed at Phase 1 close. Treat the review as a soft contract: preserve the reviewed shape unless Phase 2.5 work surfaces a real Day-2A-table defect AND escalation explicitly authorizes a change. The default Phase 2.5 stance is: do NOT touch 002.
- `003_harden_workspace_acl.sql` is **NEW**, forward-only, and is the only Phase-2.5 migration. It MUST NOT replicate or interact with 001's policies; it adjusts grants only.
- The `003` migration MUST apply cleanly via `supabase db reset` (which re-applies 001 + 002 + 003 in order). No reordering of existing files.
- The `003` migration MUST NOT introduce: `SECURITY DEFINER` functions, `grant ... to anon`, broad `to public` grants, `replica identity full`, new policies on `workspaces` / `workspace_members`, new tables, new extensions, ALTER on existing policies, DROP statements.
- A second new migration (`004_*.sql` or later) within Phase 2.5 is **forbidden**. If two distinct blocker-3 corrections cannot fit in a single 003, halt and escalate.
- Migration numbering remains numeric monotonic per plan §"Day 2A sequencing" Phase 8 / `docs/decisions/migrations.md` (a Day-2A Phase 8 ADR not yet written — Phase 2.5 does not write ADRs).

## Test / proof obligations

For each blocker, the Phase-2.5 implementation MUST satisfy ALL of the following:

**Blocker 1 — `messages` INSERT author check.**
- Option A (exact normalized `with_check` equality) is **MANDATORY**. Option B (structural top-level-vs-subquery split) is NOT permitted for this slice.
- The exact-equality assertion pins both the top-level author predicate `user_id = auth.uid()` AND the membership subquery's `cm.user_id = auth.uid()` AND the channel correlation `cm.channel_id = messages.channel_id` AND the source-table pin `FROM channel_members cm` — by construction of the canonical form. No additional substring assertions are required to satisfy the contract.
- Existing `assertNoForbiddenTokens` (no `workspace_members`, no `\bOR\b`) RETAINED as defense-in-depth visibility.

**Blocker 2 — Predicate-shape tightening (all four predicate assertions: channels SELECT, channel_members SELECT, messages SELECT, messages INSERT).**
- Option A (exact normalized `qual`/`with_check` equality against the canonical form captured from the live local stack) is **MANDATORY**. Option B (structural extra-logic rejection) is NOT permitted for this slice.
- The exact-equality assertion pins source-table, correlation, user-binding, parenthesization, and the absence of broad extra logic — by construction.
- `workspace_members` and `\bOR\b` token bans RETAINED as defense-in-depth visibility.
- Exact-policy-set assertion (`deepStrictEqual` against the four-row expected set) RETAINED unchanged.
- No-UPDATE/DELETE/ALL-on-Day-2A-tables assertion RETAINED unchanged.

**Blocker 3 — Workspace ACL hardening + extended grant matrix.**
- `003_harden_workspace_acl.sql` applies cleanly via `supabase db reset`.
- `authenticated` grants on the five app tables, ordered by table_name then privilege_type, deep-equal exactly:
  ```
  (channel_members, SELECT), (channels, SELECT), (messages, INSERT), (messages, SELECT), (workspace_members, SELECT), (workspaces, SELECT)
  ```
- `anon` grants on the five tables: zero rows.
- `PUBLIC` + lowercase `public` grants on the five tables: zero rows.
- No `UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` granted to `anon`/`authenticated`/`PUBLIC`/`public` on any of the five tables. `service_role` continues to be intentionally excluded from this check.

**Blocker 4 — Local-DB guard tightening (duplicated in both spec files).**
- Host check: `127.0.0.1` OR `localhost` OR bracket-normalized `::1` ONLY.
- Port check: `54322` ONLY. Empty port (no port supplied) rejected. Any other numeric port rejected.
- DB-name check: pathname stripped of leading `/`, compared against literal `"postgres"`. Empty pathname rejected. Any other DB name rejected.
- Each rejection throws with a clear field-naming message.
- No new override mechanism added.

**Blocker 5 — Doc truth-up.**
- Both doc files reflect the Phase-2.5 contract.
- Phase-2 halt/escalate rule preserved verbatim in `day-2a-phase-2-policy-shape-tests.md`.
- No edits outside the two doc files.

## False-pass examples that must fail after the fix

The following adversarial migration / helper-config variations PASS Phase 2 today. After Phase 2.5 implementation lands, each MUST RED. The implementer is encouraged (not required) to mutation-test by transiently applying one of these to the local stack and confirming the test RED's before reverting — but documented adversarial cases (this section) are sufficient evidence by inspection.

**Adversarial migrations against `messages` INSERT (Blocker 1):**

- **F-1.** Drop the top-level author predicate, keep the membership subquery:
  ```sql
  with check (
    exists (
      select 1 from public.channel_members cm
      where cm.channel_id = messages.channel_id
        and cm.user_id = auth.uid()
    )
  )
  ```
  Phase 2 GREENs (the subquery's `cm.user_id = auth.uid()` satisfies the substring check). Phase 2.5 MUST RED — Option A (mandatory, exact normalized `with_check` equality) fails on whole-string mismatch.

**Adversarial migrations against any SELECT-policy predicate (Blocker 2; example uses `channels` SELECT):**

- **F-2.** Add a tacked-on AND clause:
  ```sql
  using (
    exists (select 1 from public.channel_members cm where cm.channel_id = channels.id and cm.user_id = auth.uid())
    and (1 = 1)
  )
  ```
  Phase 2 GREENs. Phase 2.5 MUST RED — Option A (exact normalized `qual` equality) fails on whole-string mismatch. **This is the case that makes Option A mandatory and rules Option B out**: a substring-plus-structural-rejection model does not catch the tacked-on `AND (1 = 1)` (no set-op token, no extra EXISTS, no extra SELECT, no `OR`, no `workspace_members`). Only exact normalized predicate equality rejects F-2.
- **F-3.** UNION ALL widening the EXISTS subquery (the high-impact adversarial — relaxes authorization):
  ```sql
  using (
    exists (
      select 1 from public.channel_members cm
      where cm.channel_id = channels.id and cm.user_id = auth.uid()
      union all
      select 1 from public.channel_members cm
      where cm.channel_id = channels.id
    )
  )
  ```
  Phase 2 GREENs. Phase 2.5 MUST RED — Option A (mandatory) fails on whole-string mismatch.
- **F-4.** INTERSECT / EXCEPT alternatives — same structure with `intersect` or `except` in place of `union all`. Option A fails on whole-string mismatch.
- **F-5.** A non-trivial extra EXISTS path that does NOT reference `workspace_members`:
  ```sql
  using (
    exists (select 1 from public.channel_members cm where cm.channel_id = channels.id and cm.user_id = auth.uid())
    and exists (select 1 from public.channels c where c.id = channels.id)
  )
  ```
  Phase 2 GREENs (no OR, no workspace_members, all required substrings present). Phase 2.5 MUST RED — Option A fails on whole-string mismatch.

**Adversarial migrations against workspace-table grants (Blocker 3):**

- **F-6.** 003 omitted entirely. The Phase 2 grant-matrix test currently runs only against the three Day-2A tables (channels / channel_members / messages) and passes. After the Phase 2.5 extension, the extended grant-matrix test queries ALL FIVE tables and RED's on `(workspaces, INSERT)`, `(workspaces, UPDATE)`, `(workspaces, DELETE)`, `(workspaces, TRUNCATE)`, `(workspaces, REFERENCES)`, `(workspaces, TRIGGER)`, plus the corresponding `workspace_members` rows.
- **F-7.** 003 revokes from `authenticated` but forgets to revoke from `public`. The negative-privilege-matrix assertion REDs on `(PUBLIC, workspaces, …)` rows (or `(public, workspaces, …)` — both casings checked).
- **F-8.** 003 revokes from `authenticated` and `public`, but grants `INSERT` to `authenticated` "for application convenience". The `authenticated`-grant deep-equal RED's because the expected set does NOT include `(workspaces, INSERT)`.

**Adversarial local-DB guard inputs (Blocker 4):**

- **F-9.** `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres` runs the tests against the developer's personal Postgres on default port 5432. Phase 2's guard passes (host is `127.0.0.1`). Phase 2.5 throws on the port check.
- **F-10.** `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/template1` — wrong DB. Phase 2 passes; Phase 2.5 throws on the DB-name check.
- **F-11.** `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1/postgres` — no port specified (`url.port === ""`). Phase 2 passes (host check only); Phase 2.5 throws on the empty-port branch of the port check.

## Validation commands

Only commands that already exist post-Day-1B or that this slice's implementation creates. **No invented runners** (no `pnpm test`, `vitest`, `jest`, `npm run *`).

Pre-requisite (manual, per Phase 2 §"Prerequisite"):

```
supabase start                                                   # local stack
supabase db reset                                                # re-applies 001 + 002 + 003 in order
supabase status                                                  # db container "Running" expected
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\dt public.*"
# Expected output includes: workspaces, workspace_members, channels, channel_members, messages
```

Phase 2.5 stop-condition commands:

```
# Slice 1 static SQL grep (committed spec); 003 added to migrations/, swept up by the existing glob:
node --test tests/rls/migration-rls-enabled.spec.ts

# Phase 2 + 2.5 runtime specs (both now tightened):
node --conditions=react-server --test tests/rls/all-tables-have-rls.spec.ts
node --conditions=react-server --test tests/rls/policy-shape.spec.ts

# Working-tree whitespace check (tracked files only). PASS iff exit code 0:
git diff --check

# Untracked-file whitespace check. PASS-criteria for each command below:
#   - Exit code 1 IS expected (the file differs from /dev/null because /dev/null is empty).
#   - PASS iff exit code is 0 OR 1, AND stderr contains NO `whitespace error` or
#     `trailing whitespace` diagnostic lines.
#   - FAIL iff exit code >= 2, OR a whitespace diagnostic appears on stderr.
# Concretely, the implementer captures stderr and greps for `whitespace` / `trailing` /
# `space before tab` / `indent with non-tab` substrings; absence == PASS.
# Each untracked file in scope after Phase 2.5 implementation:
git diff --no-index --check /dev/null supabase/migrations/002_channels_and_messages.sql
git diff --no-index --check /dev/null supabase/migrations/003_harden_workspace_acl.sql
git diff --no-index --check /dev/null tests/rls/all-tables-have-rls.spec.ts
git diff --no-index --check /dev/null tests/rls/policy-shape.spec.ts
git diff --no-index --check /dev/null docs/tasks/day-2a-phase-2-policy-shape-tests.md
git diff --no-index --check /dev/null docs/tasks/day-2a-phase-2.5-blocker-fixes.md
# Note: docs/tasks/day-2a-trust-boundary-data-path.md is already committed; its whitespace
# is covered by `git diff --check` above.
```

Do **not** run, in Phase 2.5:

- `pnpm build`.
- `pnpm install --frozen-lockfile` (no dependency change).
- `make repo-law`, `make fast-check`, `make tools-version-check`, `make governance-check`.
- Day 1B header specs (`tests/security/headers.spec.ts`, `tests/auth/cache-control.spec.ts`).
- Day 1A workspace specs (`tests/rls/workspace-select-membership.spec.ts`, `tests/rls/workspace-write-denial.spec.ts`) — these exercise the supabase-js test harness, which is unrelated to the Phase 2.5 surface AND requires harness setup outside Phase 2.5 scope. **However**: if the implementer observes that the tightened workspace ACLs in 003 break either of these Day-1A specs (e.g., the harness relies on `authenticated` holding INSERT on `workspaces`), that is a real signal — halt and escalate; do NOT edit either Day-1A spec.
- Any Phase 3, 4, 5, 6, 7, 8 commands.

## Review gates before completion

Phase 2.5 implementation must clear ALL of the following before being marked READY-FOR-OMX-REVIEW. Failing any single gate → BLOCKED, not READY.

1. **Migration applies cleanly.** `supabase db reset` exits 0; 001 + 002 + 003 apply in order with no errors.
2. **Migration-RLS static check passes.** `node --test tests/rls/migration-rls-enabled.spec.ts` exits 0 (003 is swept up by the existing migration glob with no spec change).
3. **All-tables-have-RLS passes.** `node --conditions=react-server --test tests/rls/all-tables-have-rls.spec.ts` exits 0. Assertion set is unchanged (Blocker 4 only tightens the duplicated `psqlQuery` helper in-place; no assertion edits required, no helper move, no deduplication — duplication-across-spec-files is intentional per Phase 2 §"Decision" and §"Slop-cleaner boundary").
4. **Policy-shape passes with tightened assertions.**
   `node --conditions=react-server --test tests/rls/policy-shape.spec.ts` exits 0 with:
   - All four predicate-shape assertions tightened per Blocker 1 + 2 obligations.
   - Grant matrix extended to all five app tables.
   - Helper tightened per Blocker 4.
5. **Adversarial guarantees by inspection.** The implementer documents in the closeout note that each F-1 through F-11 example fails as required.
6. **No forbidden edits.** `git status --short` plus `git diff` show changes ONLY to the six paths in §"Allowed edits". No new file outside that set. No deleted files. No edit to `001_*.sql`. No edit to harness, app code, semgrep, Makefile, package.json, evidence, .planning, .claude.
7. **Working tree clean of whitespace defects.** `git diff --check` exits 0. Per-untracked-file `git diff --no-index --check /dev/null <untracked>` exits with code 0 OR 1 AND emits no `whitespace error` / `trailing whitespace` / `space before tab` / `indent with non-tab` diagnostic on stderr. Exit 1 alone is expected (file content differs from `/dev/null`); only stderr diagnostics or exit ≥ 2 count as FAIL. See §"Validation commands" for the explicit pass criterion.
8. **No commits performed.** `git log --oneline -5` is unchanged from the slice-doc authoring snapshot (`7b9eec1 Plan Day 2A trust boundary before implementation` HEAD).
9. **OMX-blocker named.** The closeout note explicitly enumerates: the captured canonical predicate forms used by Option A for the four policies (verbatim, post-normalization, as encoded in the spec); whether 002 was edited (yes/no; if yes, with escalation paper-trail); and any deviation from the Phase 2.5 contract.
10. **Halt/escalate paths respected.** If the implementer hit any of: (a) need to edit 001, (b) need to edit Day-1A specs, (c) need to add 004 or any extra migration, (d) need a new dependency, (e) need an override knob — the implementation MUST be in HALTED state, not GREEN. There is no green path through any of those signals.

## Slop-cleaner boundary (planning lens only)

Phase 2.5 work is anti-slop in posture — exact-form proofs, explicit ACL hardening, named adversarial cases. The `ai-slop-cleaner` skill is invoked HERE as a **planning lens** to identify stale wording, overclaims, fallback-like test logic, and misleading comments — NOT as a license to refactor.

**What the slop-cleaner lens IS used for in Phase 2.5:**

- **Stale doc wording (Blocker 5).** Phase 2's docs describe substring proofs as sufficient; that wording is factually stale post-Phase-2.5. The truth-up edits in §"Blocker 5" remove the staleness, no more.
- **Overclaim audit.** If any new comment or assertion overstates what is proven (e.g., "this predicate prevents all cross-workspace access" when in fact the predicate proves only the channel-membership shape), flag and tighten the wording.
- **Misleading comments.** If a comment in the tightened tests claims "the policy is locked" when only the substring is locked, flag and fix.
- **Fallback-like logic detection.** If the implementer is tempted to add a "fallback for slightly different psql output format" branch, flag — it would mask a real shape change. Prefer loud failure.

**What the slop-cleaner lens is NOT permitted to do in Phase 2.5:**

- Refactor the `psqlQuery` duplication. Per Phase 2 §"Decision", the duplication is intentional; Phase 3 removes it. Phase 2.5 preserves it.
- Consolidate the two spec files into one.
- Rename existing helpers (`getPolicy`, `assertNoForbiddenTokens`, etc.).
- Move helpers into `tests/lib/`. Phase 2's no-harness-extension rule binds Phase 2.5.
- Delete existing comments unless factually wrong.
- Delete existing assertions even if "redundant with the exact-set check" — the existing `no UPDATE / DELETE / ALL policies` test was retained explicitly as defense-in-depth visibility. Phase 2.5 keeps it.
- Reformat `psql`-args, reorder imports, or "clean up" indentation.
- Introduce a new abstraction layer (e.g., a fluent assertion DSL for policy shapes).
- Touch `001_*.sql`, app code, guards, semgrep, evidence, .planning, .claude, Makefile, package.json — already forbidden in §"Forbidden edits", restated here because slop-clean impulses tend to extend reach.

If a slop concern surfaces outside the above-permitted scope, the correct disposition is to LOG it (in the closeout note) as a Day-6+ follow-up, NOT to fix it in Phase 2.5. Plan §"Mode: execution, not planning" + CLAUDE.md "Code Change Rules" (Don't add abstractions beyond what the task requires) bind.

## Stop condition

Phase 2.5 is **GREEN** (ready for OMX review) when ALL of:

1. `supabase db reset` exits 0; 001 + 002 + 003 apply.
2. `node --test tests/rls/migration-rls-enabled.spec.ts` exits 0.
3. `node --conditions=react-server --test tests/rls/all-tables-have-rls.spec.ts` exits 0.
4. `node --conditions=react-server --test tests/rls/policy-shape.spec.ts` exits 0 with all Phase-2.5 tightenings active.
5. `git diff --check` exits 0. Per-untracked-file `git diff --no-index --check /dev/null <untracked>` exits with code 0 OR 1 AND emits no whitespace diagnostic on stderr (exit 1 alone is the expected baseline because the file differs from `/dev/null` — see §"Validation commands" for the pass criterion).
6. Files changed: ONLY the six paths in §"Allowed edits". Verified by `git status --short` post-implementation against the slice-doc-time baseline.
7. Adversarial F-1 through F-11 examples documented as RED-on-mutation in the closeout note.
8. Halt/escalate rule respected — no out-of-slice work, no commits.

Phase 2.5 is **BLOCKED** if any of: 001 was edited; a 004+ migration was added; a forbidden edit landed; an adversarial example does not RED; halt/escalate was triggered without resolution; a dependency was added; an override knob was introduced; or any commit landed.

Phase 2.5 is **PARTIAL** if some blockers cleared but not all five. Partial is not a ship state. Surface the gap to OMX.

## Explicit gating statement

**Phase 3 remains BLOCKED until Phase 2.5 passes OMX review.** This includes:

- `lib/auth/with-channel-guard.ts` — not created in Phase 2.5.
- `tests/lib/supabase-test-harness.ts` extension (channelA1, workspaceOnlyMember, channelB1, seed message) — not started in Phase 2.5.
- `tests/auth/guard-failure-modes.spec.ts` (denial-A, denial-B cross-workspace, denial-C unknown channel) — not started in Phase 2.5.

If Phase 2.5 implementation work appears to require any Phase 3 artifact, halt and escalate. Do NOT pull Phase 3 forward.

## Reviewer findings (slice-doc self-review)

This doc was self-reviewed under the named lenses before being marked READY-FOR-IMPLEMENTATION:

- **security-review lens** (RLS/authz/ACL leakage): Verified each blocker addresses a real authz or defense-in-depth surface (Blocker 3 TRUNCATE bypass is the load-bearing security finding; Blockers 1+2 are proof-tightening preventing future regressions; Blocker 4 is misleading-green prevention).
- **schema / migration-discipline lens** (forward-only / monotone numbering / no SECURITY DEFINER / no broad public grants): 003 is forward-only, monotonically numbered, additive-only, no SECURITY DEFINER, no public/anon grants, no broad authenticated grants.
- **test-engineering lens** (false-pass risk; negative-actor coverage; mutation testing): Eleven named adversarial F-1..F-11 examples. Each blocker has a mutation-testable shape. Option A (exact normalized `qual` / `with_check` equality) is the mandated proof for Blockers 1+2; Option B is explicitly rejected with F-2 as the rule-out case.
- **ai-slop-cleaner lens** (planning lens): Stale wording named for truth-up; refactor temptation explicitly fenced off. The lens did not surface uncited claims or fallback-like logic in this slice doc.
- **caveman-review lens** (final readiness): see Verdict below.

Self-review verdict on the slice doc itself: **READY** (no open ambiguities). The one operationally-open item below is a capture-from-live-stack step the implementer performs at execution time, not a slice-doc ambiguity:

- The exact captured normalized predicate forms for Option A MUST be re-verified against the live local stack at implementation time — the four forms in §"Blocker 2 Option A" are best-effort anchors derived from migration 002's SQL text; PG's pg_node_tree text rep may differ in minor spacing/parenthesization. The implementer captures the live form, encodes it, and confirms it matches the migration's intended semantics — NOT the other way around (do not adjust 002 to match a captured form).

Option A is **mandatory** for Blockers 1 and 2. Option B (substring + structural rejection) is **not** an allowed implementation path for this slice; it is documented in §Blocker 1 / §Blocker 2 only as the explicitly-rejected alternative.

## Non-goals (Phase 2.5 only)

- No Phase 3 channel-guard work.
- No harness extension.
- No app code.
- No proxy refactor.
- No new dependencies.
- No second new migration (004+).
- No SECURITY DEFINER, no public/anon grants, no `replica identity full`.
- No policy ADDITIONS to `workspaces` / `workspace_members` (only grant adjustments via 003).
- No edits to Day-1A specs or Day-1A migration.
- No edits to harness, lib/, app/, proxy.ts, middleware.ts, semgrep/, evidence/, Makefile, package.json, .claude/, .github/, .planning/.
- No commits, branches, PRs, pushes.
- No `make` / `pnpm build` / `pnpm install`.
- No evidence files, no SHA256s, no manifests, no Claude-review JSON / transcript.
- No new ADRs.
- No expansion to Day-6+ follow-ups.
- No "while we're here" cleanup of the existing tests' style/structure.
- No Phase 2 stop-condition cosmetic re-write; only the substantive truth-up edits named in §"Blocker 5".

## Final caveman-review verdict

Phase 2 blocked. Five blockers. Three HIGH (substring slip, predicate substring, workspace ACL). One MEDIUM (host-only guard). One LOW (stale docs). Phase 2.5 fixes them.

Migration 003 hardens workspace ACL. Five-table grant matrix. Exact normalized predicate equality (Option A mandatory). Tightened duplicated psqlQuery helper in-place.

Six implementation files. No commits. No Phase 3. No new deps.

Option A mandatory. Option B explicitly disallowed. F-2 (tacked-on AND clause) is the case that rules Option B out.

Whitespace check semantics fixed: exit 0 or 1 with no stderr diagnostic = PASS.

Slice-doc itself acknowledged as 5th untracked review artifact, not Phase-2.5 implementation output.

Verdict: **READY** for implementation.

Next prompt type: **implementation** (execute Phase 2.5 against this slice contract).
