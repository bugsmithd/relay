// Per-test fixture for the real magic-link e2e: seeds one user (auto-confirmed)
// + one workspace + member row, against the local Supabase stack via service-role.
// Uses assertTestTargetSafe (same guard as the e2e backdoor fixture) to keep
// the service-role read inside a single sanctioned test path. Importing
// lib/supabase/admin.ts directly is not viable here because Playwright runs
// the test under a `client` import condition, which trips `server-only`.
import { test as base, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertTestTargetSafe } from "../../lib/test-target-guard.ts";
import { deleteAllMail } from "./mailpit.ts";

export type MagicSeedFixture = {
  userEmail: string;
  workspace: { slug: string; name: string };
};

export const test = base.extend<{ seed: MagicSeedFixture }>({
  seed: async ({}, use) => {
    const { url, serviceRole: sr } = assertTestTargetSafe();
    const admin: SupabaseClient = createClient(url, sr, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const runId = "m" + Math.random().toString(36).slice(2, 10);
    const userEmail = `member-${runId}@relay-test.invalid`;

    const cu = await admin.auth.admin.createUser({
      email: userEmail,
      email_confirm: true,
    });
    if (cu.error) throw cu.error;
    const userId = cu.data.user!.id;

    const ws = await admin
      .from("workspaces")
      .insert({ slug: `test-run-${runId}-alpha`, name: `Alpha ${runId}` })
      .select()
      .single();
    if (ws.error) throw ws.error;

    const wm = await admin
      .from("workspace_members")
      .insert({ workspace_id: ws.data.id, user_id: userId });
    if (wm.error) throw wm.error;

    // Clear Mailpit so the per-test message is unambiguous.
    await deleteAllMail();

    await use({
      userEmail,
      workspace: { slug: ws.data.slug, name: ws.data.name },
    });

    await admin.from("workspaces").delete().like("slug", `test-run-${runId}-%`);
    await admin.auth.admin.deleteUser(userId);
  },
});

export { expect };
