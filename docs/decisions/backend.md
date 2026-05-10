# Backend stack — time-bounded decision

Status: locked
Decided: 2026-05-09
Bound until: 2026-05-15 (end of week-1 demo)
Re-evaluation: 2026-05-15 retrospective; or earlier if a listed early-trigger fires.

## Decision

- **Database, auth, realtime:** Supabase (Postgres + GoTrue + Realtime Postgres Changes).
- **App server:** Next.js App Router. Server components, route handlers, and server actions are the only server code paths. No separate API service.
- **Service-role boundary:** `lib/supabase/admin.ts` only (`import "server-only"`).
- **Session:** cookie-based via `@supabase/ssr`. No JWT in `localStorage`.

## Open sub-decisions, with their own bounds

| Sub-decision | Default for week 1 | Decide by | Owner |
| --- | --- | --- | --- |
| Hosting | Vercel (path of least friction with `@supabase/ssr`) | Day 4 (before demo dry-run) | impl |
| Supabase tier | Free, dev project | Day 2 (when realtime-test-lane decided) | impl |
| Realtime test lane | Local Supabase stack vs nightly dev project | Day 2 (`docs/decisions/realtime-test-lane.md`) | impl |
| SMTP for magic links | Supabase default | Day 4 (before demo) per `OR-Auth-3` | impl |

If a sub-decision is not made by its bound, the week-1 default holds and re-evaluation moves to the post-demo retrospective.

## Bound rationale

Locking the backend choice for the full week prevents mid-week stack churn — the worst week-1 failure mode after data leakage. Six days is short enough that the cost of a wrong choice is bounded; long enough to ship the slice. The bound expires at demo so the post-demo retrospective gets a clean slate.

## Early-trigger conditions

Re-open this decision before 2026-05-15 only if one of these fires. Anything else waits for the retrospective.

1. **Day 1A reveals a Supabase RLS or Realtime constraint that blocks the message slice.** Example: Postgres Changes does not deliver INSERT events under the chosen RLS shape; documented workaround would exceed week-1 budget.
2. **Day 2A reveals that `@supabase/ssr` cookie-based session is incompatible with the Next.js App Router version being used.** Example: required cookie write outside a server action context that the SSR helper does not support.
3. **Bundle-leak scan or `no-service-role-in-jsx` rule cannot be made to pass without rewriting Supabase client integration.**
4. **Service-role JWT shape lacks the project/issuer/ref claim that seed safety depends on (`OR-Auth-2`)** and no equivalent claim is available.
5. **A specific demo-blocking constraint named by the client.**

If a trigger fires, the implementer pauses, writes a one-page replacement proposal, and pings the user. Do not silently switch.

## Rejected alternatives

| Alternative | Why rejected for week 1 |
| --- | --- |
| Custom Node API (Express/Hono/Fastify) backed by self-hosted Postgres | Doubles the surface to gate (RLS *and* a separate API authz layer); week-1 budget cannot cover both. |
| Separate Express/NestJS API in front of Supabase | Adds a guard layer the plan does not gate. RLS + Next.js server guards is the simplest sufficient pair. |
| Firebase / Convex / PlanetScale + Auth0 | None ship row-level authorization plus realtime in one piece; week-1 trust-substrate proof cost is higher. |
| Edge runtime only (Cloudflare Workers, no Node server) | Some Supabase auth helpers and Semgrep CI tooling assume Node runtime; switching is unbudgeted. |
| Postgres without RLS, app-layer authz only | Worst-case data leak posture; explicitly rejected by the trust-boundary architecture. |

## Out-of-scope sub-decisions (week one)

- Multi-region / read replicas.
- Connection pooling beyond Supabase default (PgBouncer).
- Background job runner (no queues in scope).
- Event log / audit log store.
- Observability stack beyond Vercel/Supabase defaults.

## Constraints this decision imposes on the plan

- Bundle-leak scanner targets `.next/static` (Next.js standalone build assumption).
- Realtime authorization is by RLS + signed-in JWT, not Supabase Realtime channel-level authorization.
- Migrations live in `supabase/migrations/` and apply via Supabase CLI.
- Server-side DB access goes through `supabase-js`, not raw `pg` (`OR-DB-3` and Day 2 `no-raw-pg-client.yml`).

## References

- Plan: `claude-code-slack-agent-gates-week1-grounded-20260509.md`
- Operator runbook items: `OR-Auth-2`, `OR-Auth-3`, `OR-DB-3`.
- Trust-boundary path classification covers `lib/supabase/admin.ts`, `lib/auth/**`, `supabase/migrations/**`.
