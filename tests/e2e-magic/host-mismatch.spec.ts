// Host-mismatch redirect: opening /login at any host other than SITE_ORIGIN's
// (e.g. http://localhost:3000 vs canonical http://127.0.0.1:3000) is a known
// footgun — the PKCE code-verifier cookie set on `localhost` cannot ride to
// the magic-link callback that lands on `127.0.0.1`, leaving the user
// silently bounced to /login with no usable session.
//
// The action layer detects the mismatch on form submit, redirects to
// SITE_ORIGIN's /login?error=host, and the page renders an explanatory
// message. This spec drives the form on the wrong host and asserts both the
// host swap and the visible error.
import { test, expect } from "./lib/seed-magic.ts";

test("host mismatch: localhost form submit redirects to canonical /login?error=host", async ({
  page,
  seed,
}) => {
  // Wrong host on purpose. Same dev process binds 127.0.0.1, but the browser
  // treats the two host names as different cookie origins.
  await page.goto(
    `http://localhost:3000/login?redirect_to=/w/${seed.workspace.slug}`,
  );
  await page.getByLabel(/email/i).fill(seed.userEmail);
  await page.getByRole("button", { name: /send magic link/i }).click();

  // Action must redirect to canonical SITE_ORIGIN host with the host-error code.
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:3000\/login\?error=host/);
  await expect(page.getByRole("alert")).toContainText(
    /canonical app origin/i,
  );
});
