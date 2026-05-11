# Day 1B — XSS / Cache / Headers

Source: `.planning/claude-code-slack-agent-gates-week1-grounded-20260509.md` §"Day 1B — XSS / Cache / Headers".
Budget: ~3h per plan §"Budget Summary".

This is a task slice. No Day 1B code is written here; implementation runs in a later session.

## Current repo reconciliation

Resolves wording mismatches between the plan and the current repo.

1. **`proxy.ts`, not `middleware.ts`.** Plan wording says `middleware.ts`. Next 16 deprecated `middleware.ts` in favor of `proxy.ts` with a `proxy` export; the migration already happened in Day 1A (see header comment at `proxy.ts:12-14`). Day 1B extends `proxy.ts`; no `middleware.ts` file is created.
2. **Matcher widening.** `proxy.ts:8-10` currently sets `matcher: ["/w/:path*"]`. Day 1B widens to `["/w/:path*", "/api/:path*"]` because the plan requires headers on both path scopes.
3. **Branch logic.** `proxy.ts` currently auth-redirects every matched request. With `/api/*` joining the matcher, the proxy must (a) always set the six required response headers (`Cache-Control` plus the five security headers) on `/w/*` and `/api/*` responses, and (b) auth-redirect only when `url.pathname.startsWith("/w/")`. `/api/*` requests must not be auth-redirected (no API routes exist Day 1B; Day 2A introduces them). Headers must also stick on the `NextResponse.redirect()` paths at `proxy.ts:26-29` and `proxy.ts:67-76`.
4. **Workspace page exports already correct.** `app/w/[workspaceSlug]/page.tsx:4-5` already declares `export const dynamic = "force-dynamic"` and `export const revalidate = 0`. Day 1B verifies presence; no edit needed.
5. **Pre-commit hook exists.** `scripts/precommit.sh` already runs one staged-file check (service-role). Day 1B adds a second block: grep staged `.tsx`/`.ts` for the React XSS-prone prop literal.
6. **Makefile `repo-law` target exists.** It currently runs one positive-fixture probe + one repo scan against `service-role-boundary.yml`. Day 1B extends the same target to also run a positive-fixture probe + repo scan against `dangerous-html.yml`. The repo-scan `--exclude` set already covers `evidence`, `node_modules`, `.next`, and the fixtures dir.
7. **Evidence isolation.** Day 1A's latest run is `evidence/runs/day-1a-final-13/` (manifest `git_sha 1bd45472…`). Day 1B writes to a new `evidence/runs/day-1b-<n>/` dir. Do not edit Day 1A artifacts or manifests; doing so invalidates Day 1A evidence.
8. **Test driver.** Playwright is wired to `next dev` only (`playwright.config.ts:41` and its block comment). The plan requires Day 1B tests against `pnpm build && pnpm start`. Day 1B tests therefore use `node --test`, not Playwright, and spawn `next start` on an ephemeral port using the existing pattern from `tests/security/backdoor-production-blocked.spec.ts:26-39` (`pickFreePort()` + PID-ancestry stale-server guard).
9. **Trust-boundary scope.** Every Day 1B touchpoint (`proxy.ts`, `semgrep/repo-law/**`, `tests/auth/**`, `tests/security/**`) sits in `evidence/trust-boundary-paths.json`. `scripts/precommit.sh` is not in that glob list but is governance-adjacent. Pre-Day-2B reviewer rule (`CLAUDE.md` §"Reviewer provenance"): read-only inline review only; **do not** fabricate `claude-authz-review.json` or transcripts — that runner lands Day 2B.

## Day 1B Must Ship

1. `semgrep/repo-law/dangerous-html.yml` (repo-scoped rule) plus three fixture files in `semgrep/repo-law/fixtures/`: a self-firing fixture rule (`dangerous-html.yml`), a positive fixture (`dangerous-html.test.tsx`), and a negative fixture (`dangerous-html-safe.tsx`). Mirrors the `service-role-boundary` layout. Rule structure: `severity: ERROR`, `languages: [typescript, javascript]`, `pattern-either` covering the `__html` shape; `paths.exclude` covers `**/tests/**`, `**/semgrep/repo-law/fixtures/**`, `**/evidence/**`, `**/.claude/**`, `**/.planning/**`, `**/node_modules/**`, `**/.next/**`, `**/docs/**`.
2. Pre-commit regex hook in `scripts/precommit.sh` bans the React XSS-prone prop literal (`dangerouslySetInnerHTML`) in staged `.tsx`/`.ts` files. Same exclusion list as the Semgrep rule (`tests/`, `semgrep/repo-law/fixtures/`, `evidence/`, `docs/`). Reuses the existing `git diff --cached --name-only --diff-filter=ACMR` + extension filter pattern at `scripts/precommit.sh:7-19`.
3. `proxy.ts` extended:
   - `config.matcher` widens to `["/w/:path*", "/api/:path*"]`.
   - All matched responses receive `Cache-Control: no-store, private` and the five Day 1B security headers, exact values from plan:
     - `Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'`
     - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
     - `Referrer-Policy: strict-origin-when-cross-origin`
     - `X-Content-Type-Options: nosniff`
     - `X-Frame-Options: DENY`
   - Auth-redirect logic confined to `url.pathname.startsWith("/w/")`. `/api/*` passes through to Next routing (which will 404 in Day 1B since no api routes exist yet; the 404 response still carries the headers because proxy ran first).
   - Header attachment applies to: the success `NextResponse.next()` response, the unauthenticated redirect at `proxy.ts:67-76`, and the fail-closed (no-env) redirect at `proxy.ts:26-29`.
   - `/api/*` pass-through case (no auth redirect needed) must still return `NextResponse.next({ request })` with `securityHeaders(res)` applied. Do not return `undefined` from proxy on a matched `/api/*` request — that strips the proxy-set headers and silently regresses Stop Condition #4.
4. Verify (no edit) `app/w/[workspaceSlug]/page.tsx:4-5` retains `dynamic = "force-dynamic"` and `revalidate = 0`. Record the verification in the Day 1B work log.
5. `tests/auth/cache-control.spec.ts` — `node --test`, ephemeral-port `next start` lifecycle, fetches `/w/<seeded-slug>` against the spawned server, asserts `response.headers.get("cache-control") === "no-store, private"`. Reuses the `pickFreePort()` + PID-ancestry stale-server guard pattern from `tests/security/backdoor-production-blocked.spec.ts`.
6. `tests/security/headers.spec.ts` — same harness; iterates two path probes (`/w/<seeded-slug>` and `/api/healthz-not-real`), asserts all six required response headers present with exact plan values (`Cache-Control` plus the five security headers). The non-existent `/api/*` path is intentional: it proves headers are attached by the proxy independent of route resolution.
7. Day 1B evidence under `evidence/runs/day-1b-<n>/`:
   - `cache-control-headers.txt` — `curl -sI http://127.0.0.1:<port>/w/<seeded-slug>` output plus `exit=<code>` footer.
   - `security-headers.txt` — `curl -sI` outputs for both `/w/*` and `/api/*` plus exit codes.
   - `dangerous-html-precommit-rejected.txt` — captures `scripts/precommit.sh` rejecting a staged `.tsx` containing the banned literal, with the staged file cleanup verified.
   - `manifest.json` — `evidence/manifest.schema.json`-valid, `day: "1B"`, `git_sha` equals `git rev-parse HEAD` at close-out time (clean tree), every `artifact_paths[].sha256` matches file bytes.

## Day 1B Stop Condition

Mirrors plan §"Day 1B Stop Condition" 1:1.

1. `make repo-law` exits 0 with the new `dangerous-html.yml` positive fixture firing and the repo scan returning no findings.
2. A `git commit` (or staged `precommit.sh` invocation) on a `.tsx` file containing the banned literal is rejected; cleanup leaves no residue.
3. After `pnpm build && pnpm start`, `curl -sI http://127.0.0.1:<port>/w/<seeded-slug>` shows `Cache-Control: no-store, private` plus the five security headers verbatim (six required response headers total).
4. After `pnpm build && pnpm start`, `curl -sI http://127.0.0.1:<port>/api/<anything>` shows the same set of headers.
5. `node --test tests/auth/cache-control.spec.ts tests/security/headers.spec.ts` exits 0.
6. Day 1B `manifest.json` validates against `evidence/manifest.schema.json`; `manifest.git_sha === git rev-parse HEAD` with a clean working tree; every recorded SHA256 matches the artifact's bytes.

## TDD / false-pass ordering

Order is deliberate; out-of-order steps cause false-pass risk.

1. **Static-file gates first.** Land `dangerous-html.yml` + fixtures and the `precommit.sh` extension before touching `proxy.ts`. Verify `make repo-law` fires on the positive fixture and clears the repo scan. Verify precommit rejects a staged `.tsx` with the literal. Both gates are pure-file checks and isolate cleanly from any runtime.
2. **Tests before headers.** Write `tests/auth/cache-control.spec.ts` and `tests/security/headers.spec.ts` BEFORE editing `proxy.ts`. Run them. Required RED signature: `assert.equal(res.headers.get("cache-control"), "no-store, private")` (and the per-header equivalents in `headers.spec.ts`) fail because the live-server response returns `null` or the wrong value on `127.0.0.1:<port>`. If the failure is `fetch failed`, `ECONNREFUSED`, `child exited non-zero`, or any transport-layer error, the harness is broken — fix the harness; do NOT treat that as a real RED.
3. **Header implementation next.** Edit `proxy.ts`: widen matcher, add `securityHeaders(res)` helper, attach on success + redirect paths, gate auth-redirect to `/w/*`. Re-run both specs. Assert GREEN.
4. **Build lifecycle is the test harness's responsibility.** Each test run: `pnpm build` (fresh) → spawn `pnpm start` (or `pnpm exec next start`) on an ephemeral port → readiness probe → PID-ancestry check (reject any listener whose root ancestor is not the spec's spawned child) → `fetch()` assertions → kill child. **Never reuse a stale dev server.** This pattern is already in `tests/security/backdoor-production-blocked.spec.ts:16-40` — copy it, don't reinvent it.
5. **Evidence capture last.** Only after tests are GREEN: shell out `curl -sI` and `sh scripts/precommit.sh` against fresh staged files, redirect into the evidence dir, compute SHA256s, write `manifest.json`, AJV-validate, verify `git_sha` against `git rev-parse HEAD` with a clean tree.

## Time budget (~3h)

| Window | Work |
|---|---|
| 0:00–0:30 | `semgrep/repo-law/dangerous-html.yml`, positive + negative fixtures, Makefile `repo-law` extension. `make repo-law` exits 0. |
| 0:30–0:50 | `scripts/precommit.sh` extension. Ad-hoc proof: stage a `.tsx` with the literal → exit 1; unstage; verify clean working tree. |
| 0:50–1:20 | Write both spec files with stale-server guard reused. Run them. Confirm RED on missing headers, not on harness errors. |
| 1:20–1:50 | `proxy.ts` matcher widening + `securityHeaders()` helper + redirect-path header carry. Re-run both specs. GREEN. |
| 1:50–2:20 | Capture `cache-control-headers.txt`, `security-headers.txt`, `dangerous-html-precommit-rejected.txt`. Compute SHA256s. Write `manifest.json`. AJV-validate. Tie `git_sha` to clean HEAD. |
| 2:20–3:00 | Buffer for surprises (most likely: Next 16 inline-script interaction with `script-src 'self'` — see Risks). Final review. **No commit unless explicitly authorized.** This buffer is the **only** slack for the CSP/hydration risk; if `/w/<slug>` fails to hydrate under the new CSP, escalate to the user immediately instead of burning the buffer on framework debugging. |

If Day 1B overruns: Day 1B has no entries in plan §"Cut order if scope slips" (lines 425-432) and is not on the floor list (lines 433-450). Cut nothing from Day 1B without raising the overrun to the user. Do not invent cuts.

## Exact file map

| Action | Path | Purpose |
|---|---|---|
| Create | `semgrep/repo-law/dangerous-html.yml` | Repo-scoped rule with `paths.exclude` (`**/docs/**`, `**/tests/**`, `**/semgrep/repo-law/fixtures/**`, `**/evidence/**`, `**/.claude/**`, `**/.planning/**`, `**/node_modules/**`, `**/.next/**`). Rule-internal exclusions apply at scan-evaluation time, so the `Makefile` repo-law block inherits them and does **not** need a new `--exclude docs` flag (which would also silently exempt docs from future rules — bad). |
| Create | `semgrep/repo-law/fixtures/dangerous-html.yml` | Self-firing fixture rule (no `paths.exclude`). |
| Create | `semgrep/repo-law/fixtures/dangerous-html.test.tsx` | Positive fixture: one usage of the banned prop with an `__html` payload. |
| Create | `semgrep/repo-law/fixtures/dangerous-html-safe.tsx` | Negative fixture: same JSX shape without the dangerous prop. Must not trip the fixture rule. |
| Modify | `Makefile` | Extend `repo-law` target: positive-fixture probe + repo scan for `dangerous-html.yml` appended after the `service-role-boundary` block. Reuse the same fail-on-skip semantics and `--exclude` set. |
| Modify | `scripts/precommit.sh` | Append a second block after the existing service-role check. Grep staged `.tsx`/`.ts` for the banned literal. Exclude the same paths as the Semgrep rule. Exit 1 with a clear stderr message on match. |
| Modify | `proxy.ts` | Widen `config.matcher`. Add `securityHeaders(res)` helper. Attach headers on success response, unauthenticated redirect, and fail-closed redirect. Gate auth-redirect to `/w/*`. |
| Verify | `app/w/[workspaceSlug]/page.tsx` | Confirm `dynamic = "force-dynamic"` and `revalidate = 0` at lines 4–5. No edit. |
| Create | `tests/auth/cache-control.spec.ts` | `node --test`. Build + ephemeral-port `next start`. Assert `cache-control: no-store, private` on `/w/<seeded-slug>`. |
| Create | `tests/security/headers.spec.ts` | `node --test`. Same harness. Assert all six required response headers verbatim on `/w/<seeded-slug>` and `/api/<anything>` (`Cache-Control` plus the five security headers). |
| Create | `evidence/runs/day-1b-<n>/cache-control-headers.txt` | Curl headers + exit code. |
| Create | `evidence/runs/day-1b-<n>/security-headers.txt` | Curl headers for both paths + exit codes. |
| Create | `evidence/runs/day-1b-<n>/dangerous-html-precommit-rejected.txt` | Pre-commit rejection capture + exit code. |
| Create | `evidence/runs/day-1b-<n>/manifest.json` | `day: "1B"`, real `git_sha`, AJV-valid, SHA256 per artifact. |

## Validation commands

Only commands that already exist post-Day-1A or that this slice creates. No new project scripts.

```
make repo-law
sh scripts/precommit.sh                            # via staged-file proof
pnpm install --frozen-lockfile
pnpm build
pnpm exec next start -p <ephemeral>                # spawned inside specs
node --test tests/auth/cache-control.spec.ts
node --test tests/security/headers.spec.ts
curl -sI http://127.0.0.1:<port>/w/<seeded-slug>
curl -sI http://127.0.0.1:<port>/api/<anything>
pnpm exec ajv validate --spec=draft2020 -s evidence/manifest.schema.json -d evidence/runs/day-1b-<n>/manifest.json
git rev-parse HEAD                                 # tied to manifest.git_sha at close-out
```

## Risks (for the implementation session, not for this planning slice)

- **Next 16 + `script-src 'self'`.** Next App Router serves RSC payloads via inline `<script>` tags. The plan-specified CSP excludes `'unsafe-inline'` from `script-src`. If the workspace page fails to hydrate under the new CSP, the choice is to (a) fix the framework usage (typically nonces) or (b) raise the conflict with the user. **Do not silently relax the CSP** — that is a plan amendment, not an implementation discovery.
- **`/api/*` 404 header carry.** Proxy runs before route resolution. The 404 response should inherit headers attached by the proxy. If a Next 16 release path bypasses the proxy on 404, the headers test will catch it. Mitigation: explicitly attach headers on the returned `NextResponse` rather than relying on `NextResponse.next({ request })` carry-through behavior.
- **Build lifecycle inside test.** `pnpm build` is slow and stateful. Specs assume `.next/` exists at run time. The closeout harness must run `pnpm build` before invoking the specs, matching `backdoor-production-blocked.spec.ts`'s pre-requisite comment.
- **Pre-commit hook scope.** The new regex must match only `.tsx`/`.ts` (plan wording). Negative case to verify: a `.md` file containing the literal must not trip the hook (this very task doc mentions the literal and must remain commit-able). The Semgrep rule's `paths.exclude` covers `**/docs/**` for the same reason.
- **`proxy.ts` is on the trust-boundary list** (`evidence/trust-boundary-paths.json:15`). Day 1B precedes the Day-2B runner (`scripts/run-claude-review.mjs`), so Day 1B `proxy.ts` edits get inline read-only review per `CLAUDE.md` §"Reviewer provenance" — **not** a fabricated `claude-authz-review.json`. Day 2B+ edits to `proxy.ts` will require the paired JSON + transcript via the real runner; this slice produces neither.

## Non-goals (Day 1B only)

- No Day 2 work: no `channels`/`channel_members`/`messages` migration, no `with-channel-guard`, no message routes, no Server Action origin enforcement (Day 2A).
- No Day 2B work: no `.claude/agents/`, no `.claude/skills/` for the repo, no `scripts/run-claude-review.mjs`, no `scripts/check-evidence.mjs`, no `scripts/recheck-precommit.sh`, no `scripts/check-workflow-hardening.mjs`, no `governance-check` Makefile target.
- No new dependencies (no `helmet`, no CSP helper libs). Headers are set via the raw `NextResponse` headers API.
- No headers beyond the six listed. No `Permissions-Policy`. No COOP/COEP/CORP. No `Cross-Origin-*` family. No `X-XSS-Protection` (deprecated).
- No CSP `report-uri` / `report-to`. No Sentry CSP reporting. No nonce or hash sources in `script-src`.
- No headers for `/`, `/login`, `/auth/*`. Plan-specified matcher covers `/w/*` and `/api/*` only.
- No edits to Day 1A evidence. No reuse of a Day 1A run directory. No rewrite of `evidence/runs/day-1a-*` manifests, `git_sha` fields, or SHA256s.
- No fabricated SHA256s. No fake `git_sha`. No manifest entries pointing at missing files. No Claude review JSON or transcripts (the runner lands Day 2B; pre-Day-2B reviews are inline-only per `CLAUDE.md` §"Reviewer provenance").
- No commits, no PRs, no branch creation. No `pnpm install` without `--frozen-lockfile`. No dependency adds.

## Reviewer findings

Independent reviewer (general-purpose subagent, no prior conversation context). Confirmed every Must Ship item and every Stop Condition is present, scope discipline holds, evidence truth holds, and current-repo reconciliation is grounded.

**Verdict: PASS**, with four documentation-hardening clarifications (no missing scope, no wrong technical decisions).

**Gaps closed in this revision:**

- Added explicit `paths.exclude` note in the `dangerous-html.yml` file-map row clarifying that the rule's internal exclusions are honored at scan-evaluation time and that `Makefile` does not need a new `--exclude docs` flag (which would over-exempt future rules).
- Added an `/api/*` pass-through sub-bullet under Must Ship #3 mandating `NextResponse.next({ request })` with `securityHeaders(res)` applied, prohibiting bare `undefined` returns that would strip proxy-set headers.
- Hardened the RED signature in TDD step 2 with a concrete `assert.equal(...)` example and an explicit list of transport-layer failures that must be treated as harness bugs, not real REDs.
- Added a Risks bullet acknowledging `proxy.ts` sits in `evidence/trust-boundary-paths.json:15` and invoking the pre-Day-2B inline-review rule for Day 1B `proxy.ts` edits.
- Tightened the buffer window in the time budget to require immediate escalation (not silent burn) if Next 16 hydration fails under `script-src 'self'`.

**Suggestions rejected as out-of-scope:**

- Pre-flighting CSP nonces / `strict-dynamic`. Plan fixes the CSP string verbatim; introducing nonces is a plan amendment, not implementation freedom.
- Adding `Permissions-Policy`, COOP/COEP/CORP, `Cross-Origin-*`, or `X-XSS-Protection`. Plan does not name them; Non-goals already excludes them.
- Adding CSP `report-uri` / Sentry CSP reporting. Same reasoning.
- Wiring Day 1B tests via Playwright. Playwright is `next dev`-only per its config block comment; plan requires prod-build headers, so `node --test` is the only correct choice.
- Editing the existing Day 1A `service-role-boundary` block in the Makefile to merge with the new `dangerous-html` block. The file-map says "appended after," which preserves diff localization.
- Reusing a Day 1A run directory or amending a Day 1A manifest. Forbidden under Non-goals and the evidence-truth invariant.
- Auto-redirecting `/api/*` on auth like `/w/*`. No API routes exist Day 1B (Day 2A introduces them); plan applies only headers to `/api/*` in Day 1B.

## AI-slop-cleaner findings

Slop-pass on writing style, not content. Doc was already grounded in file/line anchors, exact header values, and concrete assertion examples; cleanup was minimal.

**Simplified:**

- Removed "Findings from a read-only sweep before drafting;" preamble from the §"Current repo reconciliation" intro — process-narration the reader doesn't need.
- Tightened §intro: "This file is a task slice. Implementation lands in a later session; no Day 1B code is to be written from this slice itself." → "This is a task slice. No Day 1B code is written here; implementation runs in a later session." Cuts the recursive "from this slice itself" tail.
- Dropped "concretely:" filler from the RED-signature sentence in TDD step 2; the concrete assertion already lands the point.

**Removed:**

- Nothing structural. Stop Condition, Must Ship, file map, time budget, validation commands, risks, non-goals, and reviewer findings all retained verbatim per cleaner contract.

**Retained intentionally:**

- The single-sentence §"Day 1B Stop Condition" intro ("Mirrors plan §"Day 1B Stop Condition" 1:1.") — anchors the audit trail.
- The "Order is deliberate; out-of-order steps cause false-pass risk." line in §TDD — explains WHY the ordering exists; one short sentence buys discipline.
- The long Non-goals list — each bullet is a real cut that prevents scope drift; compressing would invite re-litigation during implementation.
- Reviewer findings section in full — needed as an audit trail for the planning slice.
- The "(see header comment at `proxy.ts:12-14`)" and similar inline anchor citations — these are line-number receipts, not slop.
- "governance-adjacent" phrasing in §reconciliation item 9 — slightly AI-ese, but it accurately marks `scripts/precommit.sh`'s ambiguous status (governance-relevant but not on the trust-boundary glob list); a more concise replacement would lose the distinction.
