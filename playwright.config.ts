import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
const HOST = process.env.E2E_HOST ?? "127.0.0.1";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  reporter: process.env.CI ? "list" : "list",
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Tests run against the production build (matches plan §"Day 1B" intent
    // for cookie/cache assertions). For Day 1A we exercise login + workspace
    // shell end-to-end; same setup.
    //
    // RELAY_E2E_BACKDOOR=1 enables app/dev/test-signin/route.ts. Refuses to
    // respond when NODE_ENV=production, but `next start` runs in production
    // mode by default — the route file's own guard would block. Force NODE_ENV
    // to "test" here so the backdoor can answer.
    command: `pnpm exec next start -H ${HOST} -p ${PORT}`,
    url: `http://${HOST}:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      RELAY_E2E_BACKDOOR: "1",
    },
  },
});
