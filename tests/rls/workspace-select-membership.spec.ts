// RLS: workspaces SELECT policy joins workspace_members on auth.uid().
// Three actors:
//   - member of alpha   -> sees alpha (1 row)
//   - non-member        -> sees zero rows for alpha
//   - anon (no JWT)     -> denied (revoke all from anon)
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

test("member sees their workspace", async () => {
  const { data, error } = await H.member.client
    .from("workspaces")
    .select("id, slug, name")
    .eq("id", H.workspaceA.id);
  assert.equal(error, null, error?.message);
  assert.equal(data?.length, 1);
  assert.equal(data?.[0].slug, H.workspaceA.slug);
});

test("member does NOT see workspace they are not in", async () => {
  const { data, error } = await H.member.client
    .from("workspaces")
    .select("id")
    .eq("id", H.workspaceB.id);
  assert.equal(error, null, error?.message);
  assert.equal(data?.length, 0, "member must not see beta");
});

test("non-member sees zero rows for alpha", async () => {
  const { data, error } = await H.nonMember.client
    .from("workspaces")
    .select("id")
    .eq("id", H.workspaceA.id);
  assert.equal(error, null, error?.message);
  assert.equal(data?.length, 0, "non-member must not see alpha");
});

test("anon SELECT denied (revoke all from anon)", async () => {
  const { data, error } = await H.anon
    .from("workspaces")
    .select("id")
    .eq("id", H.workspaceA.id);
  // PostgREST returns 401 / permission-denied. Either way we must not get rows.
  assert.equal(data?.length ?? 0, 0, "anon must not receive rows");
  assert.notEqual(error, null, "anon must hit a permission error");
});

test("workspace_members SELECT policy: each user sees only their rows", async () => {
  const { data: m, error: me } = await H.member.client
    .from("workspace_members")
    .select("user_id, workspace_id");
  assert.equal(me, null, me?.message);
  assert.ok(m && m.length >= 1, "member should see at least their own membership");
  for (const row of m) {
    assert.equal(row.user_id, H.member.userId, "leak: foreign membership row visible");
  }

  const { data: n, error: ne } = await H.nonMember.client
    .from("workspace_members")
    .select("user_id, workspace_id");
  assert.equal(ne, null, ne?.message);
  assert.equal(n?.length, 0, "non-member has no memberships");
});
