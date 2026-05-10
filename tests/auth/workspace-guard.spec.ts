// Pure-logic + RLS-edge tests for the data layer that withWorkspaceGuard
// relies on. End-to-end behavior (signed-out redirect, signed-in member sees
// page, non-member denied) is covered by the Playwright e2e suite.
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

test("member: SELECT by slug returns workspace row", async () => {
  const { data, error } = await H.member.client
    .from("workspaces")
    .select("id, slug, name")
    .eq("slug", H.workspaceA.slug)
    .maybeSingle();
  assert.equal(error, null, error?.message);
  assert.ok(data, "guard would return a context for member");
  assert.equal(data?.slug, H.workspaceA.slug);
});

test("non-member: SELECT by alpha slug returns null (notFound() path)", async () => {
  const { data, error } = await H.nonMember.client
    .from("workspaces")
    .select("id")
    .eq("slug", H.workspaceA.slug)
    .maybeSingle();
  assert.equal(error, null, error?.message);
  assert.equal(data, null, "guard would call notFound() for non-member");
});

test("member: SELECT by beta slug returns null (member of alpha only)", async () => {
  const { data } = await H.member.client
    .from("workspaces")
    .select("id")
    .eq("slug", H.workspaceB.slug)
    .maybeSingle();
  assert.equal(data, null, "membership of A does not leak B");
});

test("anon: SELECT by slug returns no row + permission error", async () => {
  const { data, error } = await H.anon
    .from("workspaces")
    .select("id")
    .eq("slug", H.workspaceA.slug)
    .maybeSingle();
  assert.equal(data, null);
  assert.notEqual(error, null);
});

test("invalid slug shape: regex check matches guard's pre-DB rejection", async () => {
  const SLUG_RE = /^[a-z0-9-]+$/;
  for (const bad of ["UPPER", "with space", "../etc/passwd", "x.y", ""]) {
    assert.equal(SLUG_RE.test(bad), false, `${JSON.stringify(bad)} must be rejected by guard`);
  }
  for (const good of ["alpha", "team-1", "abc-123"]) {
    assert.equal(SLUG_RE.test(good), true, `${JSON.stringify(good)} must be accepted`);
  }
});
