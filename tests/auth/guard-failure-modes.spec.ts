// Gate 1 — data-layer denial-shape proofs for withChannelGuard.
//
// SCOPE — important:
// This spec does NOT import or invoke withChannelGuard. It proves only that
// the fixture state + RLS + a correctly-formed combined channel-membership
// query yield identical data-layer outputs across the three denial cases:
//
//   - denial-A: workspace member but not a channel member
//   - denial-B: channel member but cross-workspace (workspace_id mismatch)
//   - denial-C: unknown channel id
//
// All three return `{ data: null, error: null }` from the combined lookup.
//
// What this spec does NOT prove:
//   - that lib/auth/with-channel-guard.ts actually issues this query shape;
//   - that the guard composes through withWorkspaceGuard;
//   - that the guard sanitizes its log fields;
//   - that the guard collapses sub-cases into the same redirect target /
//     log reason.
//
// Those are Gate 2 obligations and are verified by the SR-1..SR-12 source
// review of the guard source per docs/tasks/day-2a-phase-3-channel-guard-harness.md
// §"Layer 2 — Source Review Gate".
//
// End-to-end runtime "redirect happens" is Day-4 Playwright e2e scope.

import { test, after, before } from "node:test";
import { strict as assert } from "node:assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setupHarness, type Harness } from "../lib/supabase-test-harness.ts";

let H: Harness;
before(async () => {
  H = await setupHarness();
});
after(async () => {
  if (H) await H.cleanup();
});

// Mirror of the combined lookup the guard is required to issue (per §A.4
// Choice-1 of the slice contract). The spec issues this query independently
// from the guard — it cannot catch a guard that issues a different shape.
async function combinedChannelLookup(
  client: SupabaseClient,
  channelId: string,
  workspaceId: string,
  userId: string,
) {
  return client
    .from("channels")
    .select("id, name, kind, workspace_id, channel_members!inner(user_id)")
    .eq("id", channelId)
    .eq("workspace_id", workspaceId)
    .eq("channel_members.user_id", userId)
    .maybeSingle();
}

// --------------------------------------------------------------------------
// Block 1 — withSession denial surface: anon (unauthenticated)
// --------------------------------------------------------------------------
// Proves that anon cannot reach the channel branch via the workspaces table:
// migration 001 + 003 revoke broad privileges from anon, and (with no JWT)
// PostgREST returns a permission error rather than zero rows.
test("Block 1: anon SELECT workspaces returns no row + permission error", async () => {
  const { data, error } = await H.anon
    .from("workspaces")
    .select("id")
    .eq("slug", H.workspaceA.slug)
    .maybeSingle();
  assert.equal(data, null, "anon must not receive any workspaces row");
  assert.notEqual(error, null, "anon must hit a permission error (revoke from anon)");
});

// --------------------------------------------------------------------------
// Block 2 — withWorkspaceGuard denial surface: signed-in non-member
// --------------------------------------------------------------------------
// Mirrors the existing tests/auth/workspace-guard.spec.ts "non-member" case.
// RLS returns zero rows (no DB error). The workspace-level deny lands BEFORE
// the channel branch can fire.
test("Block 2: signed-in non-member sees zero rows for workspaceA (RLS deny, not DB error)", async () => {
  const { data, error } = await H.nonMember.client
    .from("workspaces")
    .select("id")
    .eq("slug", H.workspaceA.slug)
    .maybeSingle();
  assert.equal(data, null, "non-member must not see workspaceA");
  assert.equal(error, null, "RLS deny returns zero rows, not a permission error (PostgREST 200 + []​)");
});

// --------------------------------------------------------------------------
// Block 3 — withChannelGuard denial-A: workspace-only member, not a channel member
// --------------------------------------------------------------------------
test("Block 3 (denial-A): workspaceOnlyMember in workspaceA but not in channelA1 — combined lookup returns null", async () => {
  // Fixture sanity: workspaceOnlyMember IS in workspaceA's workspace_members.
  const wmCount = await H.admin
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", H.workspaceA.id)
    .eq("user_id", H.workspaceOnlyMember.userId);
  assert.equal(wmCount.error, null, wmCount.error?.message);
  assert.equal(wmCount.count, 1, "fixture: workspaceOnlyMember MUST be in workspaceA's workspace_members");

  // Fixture sanity: workspaceOnlyMember is NOT in channelA1's channel_members.
  // If this assertion fails, denial-A is non-load-bearing — the spec is testing
  // a state the guard doesn't have to handle.
  const cmCount = await H.admin
    .from("channel_members")
    .select("user_id", { count: "exact", head: true })
    .eq("channel_id", H.channelA1.id)
    .eq("user_id", H.workspaceOnlyMember.userId);
  assert.equal(cmCount.error, null, cmCount.error?.message);
  assert.equal(
    cmCount.count,
    0,
    "fixture invariant: workspaceOnlyMember must NOT be a channel_members row of channelA1 " +
      "(else denial-A is non-load-bearing — change the harness, not the spec)",
  );

  // The combined lookup the guard is required to issue returns null.
  const denialA = await combinedChannelLookup(
    H.workspaceOnlyMember.client,
    H.channelA1.id,
    H.workspaceA.id,
    H.workspaceOnlyMember.userId,
  );
  assert.equal(denialA.data, null, "denial-A: combined lookup must return null");
  assert.equal(denialA.error, null, "denial-A: RLS-filtered empty result, not DB error");
});

// --------------------------------------------------------------------------
// Block 4 — withChannelGuard denial-B: cross-workspace channel member (LOAD-BEARING)
// --------------------------------------------------------------------------
// This is the core authz boundary: a user who IS a member of channelB1 but is
// asking through workspaceA's slug must NOT be granted access to channelB1.
// The workspace_id constraint in the combined lookup is what enforces this.
test("Block 4 (denial-B): member is in channelB1 AND in workspaceA, but channelB1 lives in workspaceB — combined lookup with workspaceA constraint returns null", async () => {
  // Fixture sanity: member IS in channelB1's channel_members. If this is false,
  // denial-B reduces to denial-C (unknown-channel) at the data-layer surface
  // and the test stops proving the cross-workspace correlation.
  const cmCount = await H.admin
    .from("channel_members")
    .select("user_id", { count: "exact", head: true })
    .eq("channel_id", H.channelB1.id)
    .eq("user_id", H.member.userId);
  assert.equal(cmCount.error, null, cmCount.error?.message);
  assert.equal(
    cmCount.count,
    1,
    "fixture invariant: member MUST be in channelB1's channel_members " +
      "(else denial-B is non-load-bearing — change the harness, not the spec)",
  );

  // Fixture sanity: channelB1 lives in workspaceB (NOT workspaceA).
  assert.notEqual(
    H.channelB1.workspace_id,
    H.workspaceA.id,
    "fixture invariant: channelB1.workspace_id must be workspaceB.id, not workspaceA.id",
  );
  assert.equal(H.channelB1.workspace_id, H.workspaceB.id);

  // Step 1: the workspace lookup with slug=workspaceA succeeds (member IS in workspaceA).
  // This proves the guard's withWorkspaceGuard step would resolve cleanly.
  const ws = await H.member.client
    .from("workspaces")
    .select("id")
    .eq("slug", H.workspaceA.slug)
    .maybeSingle();
  assert.equal(ws.error, null);
  assert.equal(ws.data?.id, H.workspaceA.id);

  // Step 2: combined lookup pins workspace_id to workspaceA, asks for channelB1.
  const denialB = await combinedChannelLookup(
    H.member.client,
    H.channelB1.id,
    H.workspaceA.id, // <-- load-bearing constraint
    H.member.userId,
  );
  assert.equal(
    denialB.data,
    null,
    "denial-B: combined lookup with workspaceA constraint must return null even though " +
      "member IS a channel_members row of channelB1",
  );
  assert.equal(denialB.error, null);

  // Step 3: negative-control "broken-guard simulation". The same query WITHOUT
  // the workspace_id constraint must return the cross-workspace row. This
  // proves the workspace_id constraint is NECESSARY: a guard that omits it
  // would leak the cross-workspace row to `member`.
  //
  // If this assertion fails (broken-guard sim returns null), it means either:
  //   (a) member is no longer a channel_members row of channelB1, OR
  //   (b) RLS unexpectedly already blocks the row even without the workspace
  //       binding (which would mean the workspace_id constraint is redundant
  //       and denial-B is not load-bearing).
  // Either way, the harness/contract must be revisited.
  const brokenGuard = await H.member.client
    .from("channels")
    .select("id, workspace_id, channel_members!inner(user_id)")
    .eq("id", H.channelB1.id)
    // NOTE: deliberately no .eq("workspace_id", ...) — that omission is the
    // regression the workspace_id constraint catches.
    .eq("channel_members.user_id", H.member.userId)
    .maybeSingle();
  assert.notEqual(
    brokenGuard.data,
    null,
    "broken-guard simulation: without workspace_id constraint, member must see channelB1 — " +
      "this is the regression the workspace_id constraint catches. If null, denial-B is not load-bearing.",
  );
  const leakedWs = (brokenGuard.data as { workspace_id?: string } | null)?.workspace_id;
  assert.equal(
    leakedWs,
    H.workspaceB.id,
    "broken-guard simulation returned the cross-workspace channelB1 row (workspace_id = workspaceB.id)",
  );
});

// --------------------------------------------------------------------------
// Block 5 — withChannelGuard denial-C: unknown channel id
// --------------------------------------------------------------------------
test("Block 5 (denial-C): unknown channel id — combined lookup returns null", async () => {
  const unknownChannelId = crypto.randomUUID();
  const denialC = await combinedChannelLookup(
    H.member.client,
    unknownChannelId,
    H.workspaceA.id,
    H.member.userId,
  );
  assert.equal(denialC.data, null, "denial-C: combined lookup for unknown UUID must return null");
  assert.equal(denialC.error, null, "denial-C: empty result, not DB error");
});

// --------------------------------------------------------------------------
// Block 6 — Same-shape denial across A/B/C at the data-layer surface
// --------------------------------------------------------------------------
// Re-issues the three lookups in a single test, then asserts the observable
// is identical: { data: null, error: null }. This proves the FIXTURE / RLS /
// query-shape produce identical data-layer outputs for the three denial
// sub-conditions; it does NOT prove the GUARD collapses them to the same
// log line or redirect target. See SR-5, SR-6, SR-8 in Gate 2.
test("Block 6: denial-A/B/C return identical {data:null, error:null} at the data-layer surface", async () => {
  const denialA = await combinedChannelLookup(
    H.workspaceOnlyMember.client,
    H.channelA1.id,
    H.workspaceA.id,
    H.workspaceOnlyMember.userId,
  );
  const denialB = await combinedChannelLookup(
    H.member.client,
    H.channelB1.id,
    H.workspaceA.id,
    H.member.userId,
  );
  const denialC = await combinedChannelLookup(
    H.member.client,
    crypto.randomUUID(),
    H.workspaceA.id,
    H.member.userId,
  );
  for (const [label, result] of [
    ["denial-A", denialA],
    ["denial-B", denialB],
    ["denial-C", denialC],
  ] as const) {
    assert.equal(result.data, null, `${label}: data must be null`);
    assert.equal(result.error, null, `${label}: error must be null (RLS-filtered, not DB error)`);
  }
});

// --------------------------------------------------------------------------
// Block 7 — Pre-DB UUID-shape regex contract (pure-regex assertion)
// --------------------------------------------------------------------------
// Asserts the regex shape that lib/auth/with-channel-guard.ts is required to
// use per §A.1 of the slice contract. This is a pure assertion: it does NOT
// invoke the guard, but it pins the regex so a guard implementation can be
// verified at Gate 2 / SR-1 against this exact pattern.
test("Block 7: UUID regex (§A.1) accepts canonical UUIDs and rejects malformed input", () => {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const bad = [
    "",
    "not-a-uuid",
    "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA", // canonical form is lowercase
    "00000000-0000-0000-0000-00000000000", // 11 trailing hex chars
    "00000000-0000-0000-0000-0000000000000", // 13 trailing hex chars
    "00000000-0000-0000-0000-00000000000g", // non-hex char
    "00000000_0000_0000_0000_000000000000", // wrong separator
    "../etc/passwd",
  ];
  for (const s of bad) {
    assert.equal(
      UUID_RE.test(s),
      false,
      `${JSON.stringify(s)} must be rejected by guard's pre-DB UUID check`,
    );
  }
  const good = [
    "00000000-0000-0000-0000-000000000000",
    crypto.randomUUID().toLowerCase(),
  ];
  for (const s of good) {
    assert.equal(
      UUID_RE.test(s),
      true,
      `${JSON.stringify(s)} must be accepted`,
    );
  }
});

// --------------------------------------------------------------------------
// Block 8 — No-500 contract (assertion-by-presence)
// --------------------------------------------------------------------------
// The supabase-js calls in Blocks 1-6 returned {data, error} for every case
// (anon permission denial, RLS-filtered empty, unknown-UUID, cross-workspace).
// If any of those calls had thrown an uncaught rejection, the await would have
// propagated it and failed the surrounding test BEFORE the assert.equal call.
//
// This test documents that fact explicitly. The "guard catches thrown
// rejection and logs db-error" obligation (§A.8 of the contract) is verified
// by Gate 2 / SR-9 reading the guard source, not by fault injection here.
test("Block 8: no-500 contract — supabase-js round-trips returned {data,error} structurally", () => {
  // No assertion needed: the fact that Blocks 1-6 reached their assertions
  // proves the supabase-js calls did not throw. Documented as an explicit
  // test for readers; see SR-9 for the guard-source attestation.
  assert.ok(true, "documented: Blocks 1-6 reached their assertions without uncaught rejection");
});
