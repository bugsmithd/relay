// Runtime proof: every public table has RLS enabled AND forced at the
// catalog level. Catches drift if a future migration creates a table
// without `enable row level security` + `force row level security`.
//
// Complements (does not replace) the static SQL-grep check in
// tests/rls/migration-rls-enabled.spec.ts.
//
// Reads pg_class via a psql subprocess because PostgREST does not expose
// pg_catalog (supabase/config.toml exposes only public + graphql_public).
// The helper enforces a local-host allowlist before invoking psql, and
// passes psql args as a fixed array (no shell), so command injection
// is structurally impossible. See:
// docs/tasks/day-2a-phase-2-policy-shape-tests.md §"Decision".
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

test("every public table has enable + force RLS at the catalog level", () => {
  // boolean::text in pg 17 returns 'true'/'false', not 't'/'f'. Use an
  // explicit case-when to surface the values as 't'/'f' for clear assertions.
  const rows = psqlQuery(
    "SELECT c.relname, " +
      "case when c.relrowsecurity then 't' else 'f' end, " +
      "case when c.relforcerowsecurity then 't' else 'f' end " +
      "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname",
  );

  const expected = [
    "channel_members",
    "channels",
    "messages",
    "workspace_members",
    "workspaces",
  ];
  const names = rows.map((r) => r[0]);
  for (const e of expected) {
    assert.ok(names.includes(e), `missing public table: ${e}`);
  }

  for (const [name, enabled, forced] of rows) {
    assert.equal(enabled, "t", `table ${name}: enable row level security is OFF`);
    assert.equal(forced, "t", `table ${name}: force row level security is OFF`);
  }
});
