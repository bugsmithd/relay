// RLS: no client INSERT/UPDATE/DELETE policies on workspaces or
// workspace_members. Three actors x two tables x verbs (INSERT/UPDATE/DELETE)
// all expected to be denied (or no-op for UPDATE/DELETE under RLS).
//
// Verification: attempt the write; verify via service-role probe that nothing
// was actually mutated.
import { test, after, before } from "node:test";
import { strict as assert } from "node:assert";
import { setupHarness, type Harness } from "../lib/supabase-test-harness.ts";

let H: Harness;
before(async () => {
  H = await setupHarness();
});
after(async () => {
  if (H) await H.cleanup();
});

async function workspaceCount(slug: string): Promise<number> {
  const { count, error } = await H.admin
    .from("workspaces")
    .select("id", { count: "exact", head: true })
    .eq("slug", slug);
  if (error) throw error;
  return count ?? 0;
}
async function membershipCount(userId: string, workspaceId: string): Promise<number> {
  const { count, error } = await H.admin
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return count ?? 0;
}

const newSlug = (prefix: string) => `test-run-${H.runId}-${prefix}-${Math.random().toString(36).slice(2, 7)}`;

function clientFor(name: "anon" | "nonMember" | "member") {
  return name === "anon" ? H.anon
    : name === "nonMember" ? H.nonMember.client
    : H.member.client;
}

for (const actorName of ["anon", "nonMember", "member"] as const) {
  test(`${actorName}: INSERT into workspaces denied`, async () => {
    const slug = newSlug(`ins-${actorName}`);
    const { error } = await clientFor(actorName)
      .from("workspaces")
      .insert({ slug, name: `should not exist ${slug}` });
    assert.notEqual(error, null, `${actorName} INSERT must be denied`);
    assert.equal(await workspaceCount(slug), 0, `${actorName} INSERT leaked a row`);
  });

  test(`${actorName}: UPDATE on workspaces denied (no rows changed)`, async () => {
    const before = (
      await H.admin.from("workspaces").select("name").eq("id", H.workspaceA.id).single()
    ).data?.name;
    await clientFor(actorName)
      .from("workspaces")
      .update({ name: "PWNED-by-" + actorName })
      .eq("id", H.workspaceA.id);
    const after = (
      await H.admin.from("workspaces").select("name").eq("id", H.workspaceA.id).single()
    ).data?.name;
    assert.equal(after, before, `${actorName} UPDATE must not change name`);
  });

  test(`${actorName}: DELETE on workspaces denied`, async () => {
    await clientFor(actorName).from("workspaces").delete().eq("id", H.workspaceA.id);
    const stillExists = await workspaceCount(H.workspaceA.slug);
    assert.equal(stillExists, 1, `${actorName} DELETE removed alpha`);
  });

  test(`${actorName}: INSERT into workspace_members denied`, async () => {
    const targetUser = H.nonMember.userId;
    const { error } = await clientFor(actorName)
      .from("workspace_members")
      .insert({ workspace_id: H.workspaceB.id, user_id: targetUser });
    assert.notEqual(error, null, `${actorName} INSERT into members must be denied`);
    assert.equal(
      await membershipCount(targetUser, H.workspaceB.id),
      0,
      `${actorName} INSERT into members leaked a row`,
    );
  });

  test(`${actorName}: UPDATE on workspace_members denied (no rows changed)`, async () => {
    // Capture row state before, attempt UPDATE redirecting member's slot to
    // someone else, verify membership UNCHANGED via admin probe.
    const before = (
      await H.admin
        .from("workspace_members")
        .select("user_id, workspace_id, created_at")
        .eq("workspace_id", H.workspaceA.id)
        .eq("user_id", H.member.userId)
        .single()
    ).data;
    assert.ok(before, "fixture invariant: member exists in alpha before UPDATE attempt");

    await clientFor(actorName)
      .from("workspace_members")
      .update({ user_id: H.nonMember.userId })
      .eq("workspace_id", H.workspaceA.id)
      .eq("user_id", H.member.userId);

    const after = (
      await H.admin
        .from("workspace_members")
        .select("user_id, workspace_id, created_at")
        .eq("workspace_id", H.workspaceA.id)
        .eq("user_id", H.member.userId)
        .single()
    ).data;
    assert.ok(after, `${actorName} UPDATE deleted the row`);
    assert.deepEqual(after, before, `${actorName} UPDATE on workspace_members mutated row`);
    // Cross-check: nonMember did NOT inherit alpha membership.
    assert.equal(
      await membershipCount(H.nonMember.userId, H.workspaceA.id),
      0,
      `${actorName} UPDATE leaked alpha membership to nonMember`,
    );
  });

  test(`${actorName}: DELETE on workspace_members denied`, async () => {
    await clientFor(actorName)
      .from("workspace_members")
      .delete()
      .eq("workspace_id", H.workspaceA.id)
      .eq("user_id", H.member.userId);
    const stillThere = await membershipCount(H.member.userId, H.workspaceA.id);
    assert.equal(stillThere, 1, `${actorName} DELETE removed member's row`);
  });
}
