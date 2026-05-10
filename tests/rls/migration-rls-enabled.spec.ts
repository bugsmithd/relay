// Static check: every CREATE TABLE in supabase/migrations/**.sql is paired with
// `enable row level security` AND `force row level security` for that table.
// Run via: node --import tsx --test tests/rls/migration-rls-enabled.spec.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_DIR = "supabase/migrations";

function listMigrations(): string[] {
  return readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => join(MIGRATION_DIR, f));
}

function tablesIn(sql: string): string[] {
  const out: string[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.push(m[1].toLowerCase());
  return out;
}

test("all migrations enable + force RLS on every created table", () => {
  for (const file of listMigrations()) {
    const sql = readFileSync(file, "utf8");
    const tables = tablesIn(sql);
    for (const t of tables) {
      const enableRe = new RegExp(
        `alter\\s+table\\s+(public\\.)?${t}\\s+enable\\s+row\\s+level\\s+security`,
        "i",
      );
      const forceRe = new RegExp(
        `alter\\s+table\\s+(public\\.)?${t}\\s+force\\s+row\\s+level\\s+security`,
        "i",
      );
      assert.ok(enableRe.test(sql), `${file}: missing 'enable row level security' for ${t}`);
      assert.ok(forceRe.test(sql), `${file}: missing 'force row level security' for ${t}`);
    }
  }
});

test("identity tables revoke all from anon", () => {
  for (const file of listMigrations()) {
    const sql = readFileSync(file, "utf8");
    const tables = tablesIn(sql);
    for (const t of tables) {
      const re = new RegExp(
        `revoke\\s+all\\s+on\\s+(public\\.)?${t}\\s+from\\s+anon`,
        "i",
      );
      assert.ok(re.test(sql), `${file}: missing 'revoke all on ${t} from anon'`);
    }
  }
});
