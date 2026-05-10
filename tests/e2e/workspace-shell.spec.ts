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
  await signInProgrammatically(context, baseURL!, seed.member.email, seed.member.password);
  await page.goto(`${baseURL}/w/${seed.workspaceA.slug}`);
  await expect(page.getByRole("heading", { name: seed.workspaceA.name })).toBeVisible();
  await expect(page.getByText(seed.member.email)).toBeVisible();
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
});

test("signed-in non-member: redirected away, never sees workspace data", async ({
  page,
  context,
  baseURL,
  seed,
}) => {
  await signInProgrammatically(context, baseURL!, seed.nonMember.email, seed.nonMember.password);
  const resp = await page.goto(`${baseURL}/w/${seed.workspaceA.slug}`, {
    waitUntil: "load",
  });
  // Per Day 1A plan stop-condition #19: "non-member ... gets 403/redirect".
  // We implement via redirect to "/", which yields a 200 on the home page.
  // Therefore strict-status assert is on FINAL URL (must NOT be the workspace
  // page) and on absence of any workspace-protected data.
  expect(resp?.status(), "must not 500-leak").not.toBe(500);

  const finalUrl = new URL(page.url());
  expect(
    finalUrl.pathname,
    "non-member must be redirected away from /w/<slug>",
  ).not.toBe(`/w/${seed.workspaceA.slug}`);
  expect(finalUrl.pathname).toMatch(/^(\/|\/login)$/);

  // Hard negative: protected workspace data must not appear on the response.
  const body = await page.content();
  expect(body, "workspace name must not leak").not.toContain(seed.workspaceA.name);
  expect(body, "member email must not leak to non-member").not.toContain(seed.member.email);
});
