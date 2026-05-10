import { test, expect } from "./lib/seed-fixture.ts";
import { signInProgrammatically } from "./lib/auth-helper.ts";

test("session cookie carries prefix + HttpOnly + Secure + SameSite=Lax", async ({
  context,
  page,
  baseURL,
  seed,
}) => {
  await signInProgrammatically(context, page, baseURL!, seed.supabaseUrl, seed.member.email, seed.member.password);
  await page.goto(`${baseURL}/w/${seed.workspaceA.slug}`, { waitUntil: "load" });

  const cookies = await context.cookies();
  expect(cookies.length, "expected at least one cookie after sign-in").toBeGreaterThan(0);

  const sessionCookie = cookies.find((c) => /relay-session/.test(c.name));
  expect(sessionCookie, "no relay-session cookie present").toBeDefined();
  const c = sessionCookie!;

  expect(
    c.name.startsWith("__Host-") || c.name.startsWith("__Secure-"),
    `cookie name ${c.name} must start with __Host- or __Secure-`,
  ).toBe(true);
  expect(c.httpOnly, `cookie ${c.name} must be HttpOnly`).toBe(true);
  expect(c.secure, `cookie ${c.name} must be Secure`).toBe(true);
  expect(c.sameSite, `cookie ${c.name} sameSite must be Lax`).toBe("Lax");
  expect(c.path, `cookie ${c.name} path must be /`).toBe("/");
});
