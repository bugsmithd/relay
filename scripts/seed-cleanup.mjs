// Day 1A seed cleanup. Service-role + project-ref safety enforced by
// lib/supabase/admin.ts (sole env reader).
// Deletes workspaces with slug prefix `test-run-` and users on the seed
// email domain (current `@relay-local.test`) plus the legacy
// `@relay-test.invalid` domain so older local junk is purged on first run.

async function main() {
  let supabase;
  let admin;
  let seedGuards;
  try {
    admin = await import("../lib/supabase/admin.ts");
    seedGuards = await import("./lib/seed-guards.ts");
  } catch (e) {
    // Module-resolution failure (typo, missing dep). Distinguish from safety
    // rejection so operators see the real cause.
    console.error("seed-cleanup: cannot import admin client:");
    console.error(e?.stack ?? e);
    process.exit(2);
  }
  try {
    supabase = admin.createSupabaseAdminClient({ requireSeedSafety: true });
  } catch (e) {
    if (e instanceof admin.ServiceRoleSafetyError) {
      console.error(`seed-cleanup: ${e.message}`);
      process.exit(1);
    }
    console.error("seed-cleanup: unexpected error constructing admin client:");
    console.error(e?.stack ?? e);
    process.exit(2);
  }

  const ws = await supabase
    .from("workspaces")
    .delete()
    .like("slug", "test-run-%")
    .select("slug");
  if (ws.error) throw ws.error;

  // Both the active domain and the legacy one — covers users created before
  // the rename so a single cleanup run leaves no stale local accounts behind.
  const seedDomains = [
    `@${seedGuards.SEED_EMAIL_DOMAIN}`,
    `@${seedGuards.LEGACY_SEED_EMAIL_DOMAIN}`,
  ];
  let page = 1;
  let deleted = 0;
  for (;;) {
    const list = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (list.error) throw list.error;
    const targets = list.data.users.filter((u) => {
      const email = u.email ?? "";
      return seedDomains.some((d) => email.endsWith(d));
    });
    for (const u of targets) {
      const r = await supabase.auth.admin.deleteUser(u.id);
      if (r.error) throw r.error;
      deleted += 1;
    }
    if (list.data.users.length < 200) break;
    page += 1;
  }

  console.log(`cleanup: workspaces=${ws.data?.length ?? 0} users=${deleted}`);
}

main().catch((e) => {
  console.error("seed-cleanup: " + (e?.message ?? e));
  process.exit(1);
});
