import { test, expect } from "./lib/seed-fixture.ts";
import { signInProgrammatically } from "./lib/auth-helper.ts";

test("session cookie name carries __Host- or __Secure- prefix", async ({
  context,
  page,
  baseURL,
  seed,
}) => {
  await signInProgrammatically(context, page, baseURL!, seed.supabaseUrl, seed.member.email, seed.member.password);
  // Round-trip through a server-rendered page so the cookies installed by the
  // backdoor are surfaced into the browser context (same-origin response).
  await page.goto(`${baseURL}/w/${seed.workspaceA.slug}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => {});

  const cookies = await context.cookies();
  expect(cookies.length, "expected at least one cookie after sign-in").toBeGreaterThan(0);
  for (const c of cookies) {
    expect(
      c.name.startsWith("__Host-") || c.name.startsWith("__Secure-"),
      `cookie ${c.name} must start with __Host- or __Secure-`,
    ).toBe(true);
  }
});
