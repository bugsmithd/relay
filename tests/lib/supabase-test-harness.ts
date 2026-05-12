// Multi-actor test harness against the local Supabase stack.
// Refuses to run against non-local Supabase via assertTestTargetSafe().
//
// Day 1A baseline:
// - Two users: member, nonMember. Two workspaces: workspaceA (alpha), workspaceB (beta).
// - member is in workspaceA's workspace_members. nonMember is in no workspace.
// - Returns one supabase-js client per actor (anon, member, nonMember) plus admin.
//
// Phase 3 additive (channel + membership fixtures for withChannelGuard proofs):
// - workspaceOnlyMember: third user; in workspaceA's workspace_members ONLY.
//   Never a channel_members row (load-bearing for denial-A).
// - channelA1: in workspaceA. member is a channel_members row; workspaceOnlyMember is NOT.
// - channelB1: in workspaceB. member is ALSO a channel_members row here.
//   Cross-workspace channel membership — load-bearing for denial-B.
// - seedMessage: one row in channelA1 authored by member, admin-inserted (BYPASSRLS).
//   Phase 4+ read fixture only; does NOT prove messages INSERT policy semantics.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertTestTargetSafe } from "./test-target-guard.ts";
import { seedEmail } from "../../scripts/lib/seed-guards.ts";

export type Actor = {
  email: string;
  password: string;
  userId: string;
  client: SupabaseClient;
};

export type Harness = {
  runId: string;
  admin: SupabaseClient;
  anon: SupabaseClient;
  member: Actor;
  nonMember: Actor;
  // Phase 3 additive: in workspaceA only, NOT a channel_members row anywhere.
  // Used to test withChannelGuard denial-A (workspace member ≠ channel member).
  workspaceOnlyMember: Actor;
  workspaceA: { id: string; slug: string; name: string };
  workspaceB: { id: string; slug: string; name: string };
  // Phase 3 additive: channelA1 lives in workspaceA; member is a channel_members row.
  channelA1: { id: string; workspace_id: string; name: string; kind: string };
  // Phase 3 additive: channelB1 lives in workspaceB. member is ALSO a channel_members
  // row here. Load-bearing for denial-B (cross-workspace channel correlation).
  channelB1: { id: string; workspace_id: string; name: string; kind: string };
  // Phase 3 additive: Phase 4+ read fixture only. Admin-inserted (BYPASSRLS), so
  // this does NOT prove the messages INSERT policy semantics — those are proven
  // structurally by tests/rls/policy-shape.spec.ts (Option A exact-equality on
  // with_check per Phase 2.5 §Blocker 1) and exercised at runtime by Phase 4+
  // user-scoped message-send paths.
  seedMessage: { id: string; channel_id: string; user_id: string };
  cleanup: () => Promise<void>;
};

function randomRunId(): string {
  return "t" + Math.random().toString(36).slice(2, 10);
}

async function makeUser(
  admin: SupabaseClient,
  url: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<Actor> {
  const cu = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (cu.error) throw cu.error;
  const userId = cu.data.user!.id;

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const si = await userClient.auth.signInWithPassword({ email, password });
  if (si.error) throw si.error;
  return { email, password, userId, client: userClient };
}

export async function setupHarness(): Promise<Harness> {
  // Hard refuse to construct the harness against a non-local target.
  const { url, anonKey, serviceRole: sr } = assertTestTargetSafe();
  const runId = randomRunId();

  const admin = createClient(url, sr, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const member = await makeUser(
    admin,
    url,
    anonKey,
    seedEmail("member", runId),
    `pw-${runId}-${Math.random().toString(36).slice(2)}`,
  );
  const nonMember = await makeUser(
    admin,
    url,
    anonKey,
    seedEmail("nonmember", runId),
    `pw-${runId}-${Math.random().toString(36).slice(2)}`,
  );

  const wsA = await admin
    .from("workspaces")
    .insert({ slug: `test-run-${runId}-alpha`, name: `Alpha ${runId}` })
    .select()
    .single();
  if (wsA.error) throw wsA.error;
  const wsB = await admin
    .from("workspaces")
    .insert({ slug: `test-run-${runId}-beta`, name: `Beta ${runId}` })
    .select()
    .single();
  if (wsB.error) throw wsB.error;

  const wm = await admin.from("workspace_members").insert({
    workspace_id: wsA.data.id,
    user_id: member.userId,
  });
  if (wm.error) throw wm.error;

  // Phase 3 additive fixtures begin.
  // workspaceOnlyMember: in workspaceA, NOT a channel member anywhere.
  const workspaceOnlyMember = await makeUser(
    admin,
    url,
    anonKey,
    seedEmail("wsonly", runId),
    `pw-${runId}-${Math.random().toString(36).slice(2)}`,
  );
  const wmOnly = await admin.from("workspace_members").insert({
    workspace_id: wsA.data.id,
    user_id: workspaceOnlyMember.userId,
  });
  if (wmOnly.error) throw wmOnly.error;

  // channelA1 in workspaceA; member is a channel_members row.
  const cA1 = await admin
    .from("channels")
    .insert({
      workspace_id: wsA.data.id,
      name: `general-A-${runId}`,
      kind: "private",
    })
    .select()
    .single();
  if (cA1.error) throw cA1.error;
  const cmA1 = await admin.from("channel_members").insert({
    channel_id: cA1.data.id,
    user_id: member.userId,
  });
  if (cmA1.error) throw cmA1.error;

  // channelB1 in workspaceB; member is ALSO a channel_members row (cross-workspace).
  // Load-bearing for denial-B: without this row, denial-B collapses to denial-C.
  const cB1 = await admin
    .from("channels")
    .insert({
      workspace_id: wsB.data.id,
      name: `general-B-${runId}`,
      kind: "private",
    })
    .select()
    .single();
  if (cB1.error) throw cB1.error;
  const cmB1 = await admin.from("channel_members").insert({
    channel_id: cB1.data.id,
    user_id: member.userId,
  });
  if (cmB1.error) throw cmB1.error;

  // Seed message in channelA1 by member. Phase 4+ read fixture; admin INSERT
  // BYPASSes RLS so this does not prove messages INSERT policy semantics.
  const msg = await admin
    .from("messages")
    .insert({
      channel_id: cA1.data.id,
      user_id: member.userId,
      body: `seed message ${runId}`,
    })
    .select()
    .single();
  if (msg.error) throw msg.error;

  return {
    runId,
    admin,
    anon,
    member,
    nonMember,
    workspaceOnlyMember,
    workspaceA: { id: wsA.data.id, slug: wsA.data.slug, name: wsA.data.name },
    workspaceB: { id: wsB.data.id, slug: wsB.data.slug, name: wsB.data.name },
    channelA1: {
      id: cA1.data.id,
      workspace_id: cA1.data.workspace_id,
      name: cA1.data.name,
      kind: cA1.data.kind,
    },
    channelB1: {
      id: cB1.data.id,
      workspace_id: cB1.data.workspace_id,
      name: cB1.data.name,
      kind: cB1.data.kind,
    },
    seedMessage: {
      id: msg.data.id,
      channel_id: msg.data.channel_id,
      user_id: msg.data.user_id,
    },
    cleanup: async () => {
      // workspaces DELETE cascades via FK ON DELETE CASCADE to:
      //   workspaces -> channels -> channel_members
      //   workspaces -> channels -> messages
      //   workspaces -> workspace_members
      // Idempotent: re-running is safe; the user deletes below also cascade
      // via auth.users FK to any remaining workspace_members / channel_members
      // / messages rows authored by those users.
      await admin.from("workspaces").delete().like("slug", `test-run-${runId}-%`);
      await admin.auth.admin.deleteUser(member.userId);
      await admin.auth.admin.deleteUser(nonMember.userId);
      await admin.auth.admin.deleteUser(workspaceOnlyMember.userId);
    },
  };
}
