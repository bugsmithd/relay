// Day 1A seed cleanup. Service-role + project-ref safety enforced by
// lib/supabase/admin.ts (sole env reader).
// Deletes workspaces with slug prefix `test-run-` and users with @relay-test.invalid.

async function main() {
  let supabase;
  try {
    const admin = await import("../lib/supabase/admin.ts");
    supabase = admin.createSupabaseAdminClient({ requireSeedSafety: true });
  } catch (e) {
    console.error(e?.message ?? e);
    process.exit(1);
  }

  const ws = await supabase
    .from("workspaces")
    .delete()
    .like("slug", "test-run-%")
    .select("slug");
  if (ws.error) throw ws.error;

  let page = 1;
  let deleted = 0;
  for (;;) {
    const list = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (list.error) throw list.error;
    const targets = list.data.users.filter((u) =>
      (u.email ?? "").endsWith("@relay-test.invalid"),
    );
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
  console.error(e?.message ?? e);
  process.exit(1);
});
