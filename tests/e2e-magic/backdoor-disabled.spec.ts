// Behavioral invariant for the magic-link suite: the effective Next dev
// server it runs against must have /dev/test-signin disabled — the real-flow
// e2e is supposed to exercise the magic link, not the password backdoor.
//
// Two paths reach the invariant:
//   - spawned server: playwright.magic.config.ts clears inherited
//     RELAY_E2E_BACKDOOR via webServer.env, so the new process boots with
//     the backdoor off.
//   - reused server (E2E_REUSE_SERVER=1): Playwright skips webServer.env
//     entirely, so the env-clear cannot help. This spec is the safety net
//     for that path: a 404 here proves the running server has the backdoor
//     disabled regardless of how it got that way.
import { test, expect } from "@playwright/test";

test("magic-link suite: /dev/test-signin backdoor returns 404", async ({
  request,
  baseURL,
}) => {
  const r = await request.post(`${baseURL}/dev/test-signin`, {
    data: { email: "doesnt@matter.invalid", password: "irrelevant" },
  });
  expect(
    r.status(),
    `magic-link suite must run with backdoor OFF; got status ${r.status()}`,
  ).toBe(404);
});
