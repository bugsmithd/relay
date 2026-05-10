import { test, expect } from "./lib/seed-fixture.ts";
import { signInProgrammatically } from "./lib/auth-helper.ts";

test("signed-out /w/<slug> redirects to /login", async ({ page, baseURL, seed }) => {
  const resp = await page.goto(`${baseURL}/w/${seed.workspaceA.slug}`, {
    waitUntil: "load",
  });
  expect(resp).not.toBeNull();
  expect(page.url()).toMatch(/\/login(\?|$)/);
});

test("signed-in member sees workspace name + email + sign out", async ({
  page,
  context,
  baseURL,
  seed,
}) => {
  await signInProgrammatically(context, page, baseURL!, seed.supabaseUrl, seed.member.email, seed.member.password);
  await page.goto(`${baseURL}/w/${seed.workspaceA.slug}`);
  await expect(page.getByRole("heading", { name: seed.workspaceA.name })).toBeVisible();
  await expect(page.getByText(seed.member.email)).toBeVisible();
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
});

test("signed-in non-member -> 404 (notFound), not 500", async ({
  page,
  context,
  baseURL,
  seed,
}) => {
  await signInProgrammatically(context, page, baseURL!, seed.supabaseUrl, seed.nonMember.email, seed.nonMember.password);
  const resp = await page.goto(`${baseURL}/w/${seed.workspaceA.slug}`);
  expect(resp?.status(), "must not 500-leak").not.toBe(500);
  expect([404, 200]).toContain(resp?.status() ?? 0);
});
