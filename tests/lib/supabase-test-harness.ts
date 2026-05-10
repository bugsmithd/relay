// Multi-actor test harness against the local Supabase stack.
// Refuses to run against non-local Supabase via assertTestTargetSafe().
// - Creates two users (member, non-member) and two workspaces (alpha, beta).
// - member is in alpha. Nobody is in beta.
// - Returns one supabase-js client per actor (anon, member, non-member),
//   plus the admin client for setup/teardown.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertTestTargetSafe } from "./test-target-guard.ts";

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
  workspaceA: { id: string; slug: string; name: string };
  workspaceB: { id: string; slug: string; name: string };
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
    `member-${runId}@relay-test.invalid`,
    `pw-${runId}-${Math.random().toString(36).slice(2)}`,
  );
  const nonMember = await makeUser(
    admin,
    url,
    anonKey,
    `nonmember-${runId}@relay-test.invalid`,
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

  return {
    runId,
    admin,
    anon,
    member,
    nonMember,
    workspaceA: { id: wsA.data.id, slug: wsA.data.slug, name: wsA.data.name },
    workspaceB: { id: wsB.data.id, slug: wsB.data.slug, name: wsB.data.name },
    cleanup: async () => {
      await admin.from("workspaces").delete().like("slug", `test-run-${runId}-%`);
      await admin.auth.admin.deleteUser(member.userId);
      await admin.auth.admin.deleteUser(nonMember.userId);
    },
  };
}
