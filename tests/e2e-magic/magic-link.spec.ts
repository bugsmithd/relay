// Real magic-link e2e: drives the /login form in a real browser, polls Mailpit
// for the magic-link email, clicks the link, and asserts the user lands inside
// the workspace shell. No /dev/test-signin. Site_url in supabase/config.toml
// is `http://127.0.0.1:3000`, so this test pins Next dev to :3000 via
// playwright.magic.config.ts.
import { test, expect } from "./lib/seed-magic.ts";
import { waitForMessageTo, extractMagicLink } from "./lib/mailpit.ts";

test("magic link: form → email → click → workspace shell", async ({
  page,
  context,
  baseURL,
  seed,
}) => {
  const target = `/w/${seed.workspace.slug}`;

  await page.goto(`${baseURL}/login?redirect_to=${encodeURIComponent(target)}`);
  await page.getByLabel(/email/i).fill(seed.userEmail);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();

  // PKCE code-verifier cookie carries the __Secure- prefix invariant; assert
  // it landed before driving the verify URL so a regression that breaks the
  // cookie write fails here, not silently downstream as a callback error.
  const cookieNamesAfterSend = (await context.cookies()).map((c) => c.name);
  expect(
    cookieNamesAfterSend.some(
      (n) => n.startsWith("__Secure-") && n.endsWith("-code-verifier"),
    ),
    `expected __Secure-*-code-verifier cookie, got: ${cookieNamesAfterSend.join(",")}`,
  ).toBe(true);

  const detail = await waitForMessageTo(seed.userEmail);
  const verifyUrl = extractMagicLink(detail);
  await page.goto(verifyUrl);

  // Final URL: workspace shell, NOT /login. Workspace name + signed-in email
  // visible (proves the session cookie attached + with-workspace-guard let us in).
  await expect(page).toHaveURL(new RegExp(`${target}/?$`));
  await expect(
    page.getByRole("heading", { name: seed.workspace.name }),
  ).toBeVisible();
  await expect(page.getByText(seed.userEmail)).toBeVisible();
});
