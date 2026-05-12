// Runtime proof of the Day-2A authorization contract for channels /
// channel_members / messages (plus the workspaces / workspace_members ACL
// hardening from migration 003). Phase 2.5 tightening:
//
//   1. Policy SHAPE — each policy's predicate (qual or with_check) is
//      asserted via EXACT NORMALIZED EQUALITY against the canonical form
//      captured from the live local stack. Substring-only and substring-
//      plus-structural-rejection proofs are explicitly rejected (see
//      docs/tasks/day-2a-phase-2.5-blocker-fixes.md §Blocker 1 / §Blocker 2).
//      Substring presence cannot rule out tacked-on top-level AND clauses
//      (F-2) or alternate broad EXISTS / UNION paths (F-3 / F-5); exact
//      whole-string equality does.
//
//   2. Policy SET — exactly the four expected policies exist on the three
//      Day-2A tables (by tablename, policyname, cmd, roles). No extras.
//
//   3. SQL-level GRANTS — `authenticated` has only the minimal grants RLS
//      would have allowed across ALL FIVE app tables (workspaces,
//      workspace_members, channels, channel_members, messages). No
//      UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER. TRUNCATE in particular
//      bypasses RLS entirely, so the revoke is load-bearing. Migration 003
//      closes this on the workspace tables; 002 already closed it on the
//      Day-2A tables.
//
// Anchored against pg_policies and information_schema.role_table_grants
// row content, not raw migration SQL. A substring matched inside an SQL
// comment is structurally impossible.
//
// See docs/tasks/day-2a-phase-2.5-blocker-fixes.md.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";

const DEFAULT_LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
// Supabase-local direct-Postgres port and DB name. 54321 is PostgREST/Kong
// and is not directly queryable by psql. A wrong local Postgres on the
// same host (e.g., 5432/some_other_db) would otherwise produce misleading
// green if DATABASE_URL pointed at it.
const LOCAL_PORT = "54322";
const LOCAL_DB = "postgres";

function psqlQuery(sql: string): string[][] {
  const dbUrl = process.env.DATABASE_URL ?? DEFAULT_LOCAL_DB_URL;
  const url = new URL(dbUrl);
  // WHATWG URL parses postgresql://...@[::1]:... to hostname "[::1]"
  // (with brackets). Strip the brackets so the local-host allowlist
  // accepts both forms.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refuse to run psql against non-local host: ${host}`);
  }
  // url.port is empty string when the URL omits a port — reject loudly
  // rather than silently defaulting to 5432.
  if (url.port !== LOCAL_PORT) {
    throw new Error(
      `Refuse to run psql against non-Supabase-local port: ${url.port || "(empty)"}`,
    );
  }
  // url.pathname is "/<dbname>" or "/" — strip the leading slash and
  // refuse anything that is not the Supabase-local default DB.
  const db = url.pathname.replace(/^\//, "");
  if (db !== LOCAL_DB) {
    throw new Error(
      `Refuse to run psql against non-default database: ${db || "(empty)"}`,
    );
  }
  const out = execFileSync("psql", [dbUrl, "-t", "-A", "-F", "\t", "-c", sql], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.split("\t"));
}

// getPolicy interpolates tablename + cmd directly into the SQL `-c`
// argument. Today every call site uses a hardcoded literal, but the
// allowlists below close the door on a future caller passing dynamic
// input — without an allowlist, a non-literal argument would be SQL-
// injected straight into the query psql executes.
const POLICY_ALLOWED_TABLES = new Set(["channels", "channel_members", "messages"]);
const POLICY_ALLOWED_CMDS = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"]);

function getPolicy(
  tablename: string,
  cmd: string,
): { qual: string; withCheck: string } | null {
  if (!POLICY_ALLOWED_TABLES.has(tablename)) {
    throw new Error(`getPolicy: unknown tablename ${tablename}`);
  }
  if (!POLICY_ALLOWED_CMDS.has(cmd)) {
    throw new Error(`getPolicy: unknown cmd ${cmd}`);
  }
  // pg_policies.qual and with_check are stored as pg_node_tree text reps
  // that are pretty-printed across newlines. Normalize whitespace inside
  // the SQL (POSIX [[:space:]]+) so substring assertions are immune to
  // embedded newlines.
  const rows = psqlQuery(
    "SELECT policyname, " +
      "regexp_replace(coalesce(qual, ''), '[[:space:]]+', ' ', 'g'), " +
      "regexp_replace(coalesce(with_check, ''), '[[:space:]]+', ' ', 'g') " +
      "FROM pg_policies " +
      `WHERE schemaname = 'public' AND tablename = '${tablename}' AND cmd = '${cmd}'`,
  );
  if (rows.length === 0) return null;
  // Fail loudly so each predicate-shape test stands on its own and isn't
  // silently passing against rows[0] of a duplicated-policy table. The
  // exact-set deep-equal test below is a backstop, but per-test soundness
  // is the cleaner guarantee.
  assert.equal(
    rows.length,
    1,
    `getPolicy: expected exactly 1 ${cmd} policy on ${tablename}, got ${rows.length}: ${JSON.stringify(rows)}`,
  );
  const [, qual, withCheck] = rows[0];
  return { qual: qual ?? "", withCheck: withCheck ?? "" };
}

function assertNoForbiddenTokens(expr: string, where: string): void {
  // Phase 2.5: these token bans are subsumed by the exact-equality
  // assertions but retained as defense-in-depth visibility for future
  // readers. If exact-equality somehow drifts to a substring check, these
  // bans catch the most obvious regressions on their own.
  assert.ok(
    !expr.includes("workspace_members"),
    `${where}: must NOT reference workspace_members: ${expr}`,
  );
  // \bOR\b with case-insensitive flag catches a top-level disjunction
  // (e.g. ` OR EXISTS(...)`) while not matching substrings like ORDER
  // or EXTRACTOR. The locked policies are pure AND chains; any OR is
  // a regression.
  assert.ok(
    !/\bOR\b/i.test(expr),
    `${where}: must have no OR path: ${expr}`,
  );
}

// Canonical normalized forms captured from the live local stack at Phase
// 2.5 implementation time (post-002 db reset). These are the source of
// truth for the Option-A exact-equality assertions. Any drift between
// these literals and the live `pg_policies` content means either the
// migration changed or the policy is being interpreted differently by
// Postgres — both are signals the implementer must investigate, not
// silence. See docs/tasks/day-2a-phase-2.5-blocker-fixes.md §Blocker 2.
const CANONICAL_QUAL_CHANNELS_SELECT =
  "(EXISTS ( SELECT 1 FROM channel_members cm WHERE ((cm.channel_id = channels.id) AND (cm.user_id = auth.uid()))))";
const CANONICAL_QUAL_CHANNEL_MEMBERS_SELECT =
  "(user_id = auth.uid())";
const CANONICAL_QUAL_MESSAGES_SELECT =
  "(EXISTS ( SELECT 1 FROM channel_members cm WHERE ((cm.channel_id = messages.channel_id) AND (cm.user_id = auth.uid()))))";
const CANONICAL_WITH_CHECK_MESSAGES_INSERT =
  "((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM channel_members cm WHERE ((cm.channel_id = messages.channel_id) AND (cm.user_id = auth.uid())))))";

test("channels SELECT policy: exact normalized qual equality (Option A)", () => {
  const p = getPolicy("channels", "SELECT");
  assert.ok(p, "channels has no SELECT policy");
  assert.equal(
    p.qual,
    CANONICAL_QUAL_CHANNELS_SELECT,
    `channels SELECT qual drift:\n got: ${p.qual}\n exp: ${CANONICAL_QUAL_CHANNELS_SELECT}`,
  );
  assertNoForbiddenTokens(p.qual, "channels SELECT qual");
});

test("channel_members SELECT policy: exact normalized qual equality (Option A)", () => {
  const p = getPolicy("channel_members", "SELECT");
  assert.ok(p, "channel_members has no SELECT policy");
  assert.equal(
    p.qual,
    CANONICAL_QUAL_CHANNEL_MEMBERS_SELECT,
    `channel_members SELECT qual drift:\n got: ${p.qual}\n exp: ${CANONICAL_QUAL_CHANNEL_MEMBERS_SELECT}`,
  );
  assertNoForbiddenTokens(p.qual, "channel_members SELECT qual");
});

test("messages SELECT policy: exact normalized qual equality (Option A)", () => {
  const p = getPolicy("messages", "SELECT");
  assert.ok(p, "messages has no SELECT policy");
  assert.equal(
    p.qual,
    CANONICAL_QUAL_MESSAGES_SELECT,
    `messages SELECT qual drift:\n got: ${p.qual}\n exp: ${CANONICAL_QUAL_MESSAGES_SELECT}`,
  );
  assertNoForbiddenTokens(p.qual, "messages SELECT qual");
});

test("messages INSERT policy: exact normalized with_check equality (Option A)", () => {
  const p = getPolicy("messages", "INSERT");
  assert.ok(p, "messages has no INSERT policy");
  // Top-level author predicate `user_id = auth.uid()` appears OUTSIDE the
  // membership EXISTS subquery in the canonical form, observably distinct
  // from the subquery's `cm.user_id = auth.uid()` (membership user
  // binding). Exact-equality pins both predicates simultaneously — a
  // buggy migration that drops the top-level author predicate but keeps
  // the membership subquery (Phase 2.5 §Blocker 1 / F-1) fails on
  // whole-string mismatch.
  assert.equal(
    p.withCheck,
    CANONICAL_WITH_CHECK_MESSAGES_INSERT,
    `messages INSERT with_check drift:\n got: ${p.withCheck}\n exp: ${CANONICAL_WITH_CHECK_MESSAGES_INSERT}`,
  );
  assertNoForbiddenTokens(p.withCheck, "messages INSERT with_check");
});

test("exactly the expected set of policies on the three Day-2A tables", () => {
  const rows = psqlQuery(
    "SELECT tablename, policyname, cmd, roles::text FROM pg_policies " +
      "WHERE schemaname = 'public' " +
      "AND tablename IN ('channels','channel_members','messages') " +
      "ORDER BY tablename, cmd, policyname",
  );
  const expected = [
    ["channel_members", "channel_members_select_self", "SELECT", "{authenticated}"],
    ["channels", "channels_select_member_only", "SELECT", "{authenticated}"],
    ["messages", "messages_insert_self_and_member", "INSERT", "{authenticated}"],
    ["messages", "messages_select_channel_member", "SELECT", "{authenticated}"],
  ];
  assert.deepStrictEqual(
    rows,
    expected,
    `policy set drift: got=${JSON.stringify(rows)} expected=${JSON.stringify(expected)}`,
  );
});

test("no UPDATE / DELETE / ALL policies on channels, channel_members, or messages", () => {
  // Redundant with the exact-set test above (any UPDATE/DELETE/ALL row
  // would fail that one too) but kept as defense-in-depth: a future
  // reviewer reading just this test sees the week-1 invariant directly.
  const rows = psqlQuery(
    "SELECT tablename, cmd FROM pg_policies " +
      "WHERE schemaname = 'public' " +
      "AND tablename IN ('channels','channel_members','messages') " +
      "AND cmd IN ('UPDATE','DELETE','ALL')",
  );
  assert.equal(
    rows.length,
    0,
    `found UPDATE/DELETE/ALL policies (week-1 forbids these): ${JSON.stringify(rows)}`,
  );
});

test("authenticated has only the minimal SQL grants on all five app tables", () => {
  // RLS gates rows; SQL-level GRANT/REVOKE gates whether the operation
  // is even attempted. Supabase's default project grants ALL to
  // authenticated on public.* — without explicit revoke in 002_*.sql
  // (for the Day-2A tables) and 003_*.sql (for the workspace tables),
  // authenticated would silently hold UPDATE/DELETE/TRUNCATE/REFERENCES/
  // TRIGGER. TRUNCATE in particular bypasses RLS entirely.
  const rows = psqlQuery(
    "SELECT table_name, privilege_type FROM information_schema.role_table_grants " +
      "WHERE table_schema = 'public' " +
      "AND grantee = 'authenticated' " +
      "AND table_name IN ('workspaces','workspace_members','channels','channel_members','messages') " +
      "ORDER BY table_name, privilege_type",
  );
  const expected = [
    ["channel_members", "SELECT"],
    ["channels", "SELECT"],
    ["messages", "INSERT"],
    ["messages", "SELECT"],
    ["workspace_members", "SELECT"],
    ["workspaces", "SELECT"],
  ];
  assert.deepStrictEqual(
    rows,
    expected,
    `authenticated grants drift: got=${JSON.stringify(rows)} expected=${JSON.stringify(expected)}`,
  );
});

test("anon has zero SQL grants on all five app tables", () => {
  const rows = psqlQuery(
    "SELECT table_name, privilege_type FROM information_schema.role_table_grants " +
      "WHERE table_schema = 'public' " +
      "AND grantee = 'anon' " +
      "AND table_name IN ('workspaces','workspace_members','channels','channel_members','messages')",
  );
  assert.equal(
    rows.length,
    0,
    `anon must hold zero grants on app tables: ${JSON.stringify(rows)}`,
  );
});

test("PUBLIC has zero SQL grants on all five app tables", () => {
  // PUBLIC is the pseudo-role every role inherits. A direct GRANT TO
  // PUBLIC leaks to every other role on the cluster. role_table_grants
  // surfaces direct GRANT-TO-PUBLIC rows with grantee = 'PUBLIC' on
  // PG 17+ — the PG docs' "omits tables made accessible to the current
  // user via PUBLIC" caveat is about INHERITED rows for the current
  // user, not direct grants.
  //
  // 'PUBLIC' is uppercase on PG 17; lowercase 'public' kept defensively.
  const rows = psqlQuery(
    "SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants " +
      "WHERE table_schema = 'public' " +
      "AND grantee IN ('PUBLIC','public') " +
      "AND table_name IN ('workspaces','workspace_members','channels','channel_members','messages')",
  );
  assert.equal(
    rows.length,
    0,
    `PUBLIC must hold zero grants on app tables: ${JSON.stringify(rows)}`,
  );
});

test("no UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER granted to anon, authenticated, or PUBLIC on any app table", () => {
  // Negative privilege matrix across ALL FIVE app tables. Even if some
  // future migration adds the wrong grant (or upstream Supabase changes
  // its default privileges), this catches the leak before it ships.
  // Service_role intentionally holds these privileges and is excluded —
  // it is the trusted BYPASSRLS administrative role.
  const rows = psqlQuery(
    "SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants " +
      "WHERE table_schema = 'public' " +
      "AND table_name IN ('workspaces','workspace_members','channels','channel_members','messages') " +
      "AND grantee IN ('anon','authenticated','PUBLIC','public') " +
      "AND privilege_type IN ('UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')",
  );
  assert.equal(
    rows.length,
    0,
    `dangerous grants leaked to anon/authenticated/PUBLIC: ${JSON.stringify(rows)}`,
  );
});
