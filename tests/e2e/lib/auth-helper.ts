// Programmatic sign-in via the dev-only backdoor at /dev/test-signin.
// The backdoor returns 404 unless RELAY_E2E_BACKDOOR=1 AND NODE_ENV!=production,
// which is enforced in app/dev/test-signin/route.ts.
import type { BrowserContext, Page } from "@playwright/test";

export async function signInProgrammatically(
  ctx: BrowserContext,
  _page: Page,
  baseURL: string,
  _supabaseUrl: string,
  email: string,
  password: string,
) {
  const r = await ctx.request.post(`${baseURL}/dev/test-signin`, {
    data: { email, password },
  });
  if (!r.ok()) {
    throw new Error(`sign-in backdoor failed: ${r.status()} ${await r.text()}`);
  }
}
