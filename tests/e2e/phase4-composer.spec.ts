// Phase 4 — Server Action acceptance via Playwright (black-box browser-form
// submission). No private Next internals: no manual Next-Action header
// construction, no build-manifest action-ID derivation. Submission goes
// through the rendered form's native browser submission against the
// same-origin host that the e2e webServer (next dev + RELAY_E2E_BACKDOOR=1
// per playwright.config.ts) exposes.
//
// Cross-origin / host-mismatched Server Action runtime probes are Phase-6.
// Phase 4 proves: rendered form shape + same-origin positive insert +
// invalid-channel_id zero-rows.
//
// REQUIRED INVOCATION: `E2E_PORT=<SITE_ORIGIN-port> pnpm test:e2e -- tests/e2e/phase4-composer.spec.ts`.
// The Server Action's host-canonical check (sendMessageAction) compares the
// inbound Host header against new URL(SITE_ORIGIN).host; the Playwright
// webServer port (envInt("E2E_PORT", 3100) in playwright.config.ts) MUST
// match the SITE_ORIGIN port (default 3000 per .env.local). Without this
// alignment, every positive POST collapses to redirect("/login?error=host")
// at the action layer and the positive insert test reads zero rows. The
// beforeAll hook below enforces this loudly so the failure mode is obvious
// — playwright.config.ts is on the Phase-4 read-only surface and cannot be
// edited from inside this slice.

import { test, expect } from "./lib/seed-fixture.ts";
import { signInProgrammatically } from "./lib/auth-helper.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertTestTargetSafe } from "../lib/test-target-guard.ts";

function adminClient(): SupabaseClient {
  const { url, serviceRole } = assertTestTargetSafe();
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function seedChannelForWorkspaceA(
  workspaceSlug: string,
  memberEmail: string,
): Promise<{ channelId: string; workspaceId: string; userId: string }> {
  const admin = adminClient();
  const ws = await admin
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .single();
  if (ws.error) throw ws.error;
  const u = await admin.auth.admin.listUsers();
  if (u.error) throw u.error;
  const user = u.data.users.find((x) => x.email === memberEmail);
  if (!user) throw new Error(`user ${memberEmail} not found after seed`);
  const ch = await admin
    .from("channels")
    .insert({
      workspace_id: ws.data.id,
      name: `phase4-composer-${Math.random().toString(36).slice(2, 8)}`,
      kind: "private",
    })
    .select()
    .single();
  if (ch.error) throw ch.error;
  const cm = await admin
    .from("channel_members")
    .insert({ channel_id: ch.data.id, user_id: user.id });
  if (cm.error) throw cm.error;
  return { channelId: ch.data.id, workspaceId: ws.data.id, userId: user.id };
}

async function countMessagesInChannel(channelId: string): Promise<number> {
  const admin = adminClient();
  const r = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId);
  if (r.error) throw r.error;
  return r.count ?? 0;
}

async function countAllMessagesByUser(userId: string): Promise<number> {
  const admin = adminClient();
  const r = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (r.error) throw r.error;
  return r.count ?? 0;
}

// Enforce the SITE_ORIGIN-vs-E2E_PORT alignment up front so a port-mismatch
// failure mode does not silently look like "the action is broken".
test.beforeAll(() => {
  const siteOrigin = process.env.SITE_ORIGIN;
  if (!siteOrigin) {
    throw new Error(
      "SITE_ORIGIN env not set — Phase 4 composer spec requires the action's " +
        "canonical-host check to have a target. Source .env.local before invoking.",
    );
  }
  const e2ePort = process.env.E2E_PORT ?? "3100";
  const sitePort = new URL(siteOrigin).port || "80";
  if (e2ePort !== sitePort) {
    throw new Error(
      `E2E_PORT (${e2ePort}) must match SITE_ORIGIN port (${sitePort}) so the ` +
        `Server Action's canonicalRedirectIfHostMismatch passes for the test ` +
        `host. Invoke as: E2E_PORT=${sitePort} pnpm test:e2e -- tests/e2e/phase4-composer.spec.ts`,
    );
  }
});

test("composer form shape: channel_id + body present; no workspace_slug; no user_id", async ({
  page,
  context,
  baseURL,
  seed,
}) => {
  await seedChannelForWorkspaceA(seed.workspaceA.slug, seed.member.email);
  await signInProgrammatically(
    context,
    baseURL!,
    seed.member.email,
    seed.member.password,
  );
  await page.goto(`${baseURL}/w/${seed.workspaceA.slug}`);

  await expect(page.locator("form").filter({ has: page.locator('[name="body"]') }))
    .toBeVisible();

  const bodyCount = await page.locator('form [name="body"]').count();
  expect(bodyCount, "form must include a body field").toBeGreaterThanOrEqual(1);

  const channelIdCount = await page.locator('form [name="channel_id"]').count();
  expect(
    channelIdCount,
    "form must include a channel_id field",
  ).toBeGreaterThanOrEqual(1);

  const wsSlugCount = await page.locator('form [name="workspace_slug"]').count();
  expect(
    wsSlugCount,
    "form MUST NOT include a workspace_slug field (server-bound via .bind)",
  ).toBe(0);

  const userIdCount = await page.locator('form [name="user_id"]').count();
  expect(
    userIdCount,
    "form MUST NOT include a user_id field (server-derived from ctx.user.id)",
  ).toBe(0);
});

test("positive insert via browser form submission: row attributed to session user", async ({
  page,
  context,
  baseURL,
  seed,
}) => {
  const ch = await seedChannelForWorkspaceA(
    seed.workspaceA.slug,
    seed.member.email,
  );
  await signInProgrammatically(
    context,
    baseURL!,
    seed.member.email,
    seed.member.password,
  );
  await page.goto(
    `${baseURL}/w/${seed.workspaceA.slug}?channel_id=${ch.channelId}`,
  );

  const composerForm = page.locator("form").filter({
    has: page.locator('[name="body"]'),
  });
  await expect(composerForm).toBeVisible();

  const known = `composer-${Math.random().toString(36).slice(2, 10)}`;
  const bodyField = composerForm.locator('[name="body"]');
  await bodyField.fill(known);

  const before = await countMessagesInChannel(ch.channelId);
  // Submit via browser-native form submission (button click). No Next-Action
  // header construction; no build-manifest action-ID derivation. The form's
  // action is the bound Server Action; the browser handles the request.
  const submit = composerForm.locator('button[type="submit"]');
  await Promise.all([
    page.waitForLoadState("networkidle"),
    submit.click(),
  ]);

  const after = await countMessagesInChannel(ch.channelId);
  expect(after, "exactly one row inserted").toBe(before + 1);

  const admin = adminClient();
  const row = await admin
    .from("messages")
    .select("user_id, body")
    .eq("channel_id", ch.channelId)
    .eq("body", known)
    .single();
  expect(row.error).toBeNull();
  expect(row.data?.user_id, "row.user_id must equal session user").toBe(
    ch.userId,
  );
  expect(row.data?.body).toBe(known);
});

test("invalid channel_id (via DOM mutation) writes zero rows", async ({
  page,
  context,
  baseURL,
  seed,
}) => {
  const ch = await seedChannelForWorkspaceA(
    seed.workspaceA.slug,
    seed.member.email,
  );
  await signInProgrammatically(
    context,
    baseURL!,
    seed.member.email,
    seed.member.password,
  );
  await page.goto(
    `${baseURL}/w/${seed.workspaceA.slug}?channel_id=${ch.channelId}`,
  );

  const composerForm = page.locator("form").filter({
    has: page.locator('[name="body"]'),
  });
  await expect(composerForm).toBeVisible();

  // Mutate the hidden channel_id input to an invalid UUID via page.evaluate
  // BEFORE submission. This proves the Server Action does not trust whatever
  // the browser sent — the action's UUID-regex check + channel-guard collapse
  // to redirect-deny, and zero rows are inserted anywhere.
  await page.evaluate(() => {
    const el = document.querySelector(
      'form [name="channel_id"]',
    ) as HTMLInputElement | null;
    if (el) el.value = "not-a-uuid";
  });

  await composerForm.locator('[name="body"]').fill("should-not-insert");

  const beforeChannel = await countMessagesInChannel(ch.channelId);
  const beforeUser = await countAllMessagesByUser(ch.userId);

  await Promise.all([
    page.waitForLoadState("networkidle"),
    composerForm.locator('button[type="submit"]').click(),
  ]);

  const afterChannel = await countMessagesInChannel(ch.channelId);
  const afterUser = await countAllMessagesByUser(ch.userId);
  expect(afterChannel, "no rows in original channel").toBe(beforeChannel);
  expect(afterUser, "no rows in ANY channel for this user").toBe(beforeUser);
});
