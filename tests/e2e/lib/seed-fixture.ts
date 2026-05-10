// Per-test fixture: seeds two users + two workspaces (member of alpha only)
// against the local Supabase stack via service-role.
import { test as base, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export type SeedFixture = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  member: { email: string; password: string };
  nonMember: { email: string; password: string };
  workspaceA: { slug: string; name: string };
  workspaceB: { slug: string; name: string };
};

export const test = base.extend<{ seed: SeedFixture }>({
  seed: async ({}, use) => {
    const url = reqEnv("SUPABASE_URL");
    const anon = reqEnv("SUPABASE_ANON_KEY");
    const sr = reqEnv("SUPABASE_SERVICE_ROLE");
    const admin: SupabaseClient = createClient(url, sr, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const runId = "e" + Math.random().toString(36).slice(2, 10);

    const memberEmail = `member-${runId}@relay-test.invalid`;
    const nonMemberEmail = `nonmember-${runId}@relay-test.invalid`;
    const password = `pw-${runId}-${Math.random().toString(36).slice(2)}`;

    const m = await admin.auth.admin.createUser({
      email: memberEmail,
      password,
      email_confirm: true,
    });
    if (m.error) throw m.error;
    const n = await admin.auth.admin.createUser({
      email: nonMemberEmail,
      password,
      email_confirm: true,
    });
    if (n.error) throw n.error;

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
      user_id: m.data.user!.id,
    });
    if (wm.error) throw wm.error;

    await use({
      supabaseUrl: url,
      supabaseAnonKey: anon,
      member: { email: memberEmail, password },
      nonMember: { email: nonMemberEmail, password },
      workspaceA: { slug: wsA.data.slug, name: wsA.data.name },
      workspaceB: { slug: wsB.data.slug, name: wsB.data.name },
    });

    await admin.from("workspaces").delete().like("slug", `test-run-${runId}-%`);
    await admin.auth.admin.deleteUser(m.data.user!.id);
    await admin.auth.admin.deleteUser(n.data.user!.id);
  },
});

export { expect };
