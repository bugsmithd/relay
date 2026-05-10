import { defineConfig, devices } from "@playwright/test";

// Treat empty-string env as unset so callers like the closeout script can
// safely clear hermetic-bypass envs without nuking the port.
function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

const PORT = envInt("E2E_PORT", 3100);
const HOST = envStr("E2E_HOST", "127.0.0.1");

// Hermetic by default: refuse to reuse a stale local Next server. Devs can
// opt in to fast iteration via E2E_REUSE_SERVER=1.
const REUSE = process.env.E2E_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: ["**/lib/**"],
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // `next dev` runs with NODE_ENV=development, which lets the
    // /dev/test-signin backdoor pass its NODE_ENV gate. The backdoor route
    // refuses to respond when NODE_ENV=production (see route.ts), so e2e
    // cannot use `next start`. Day 1B tests that require production headers
    // will spawn `next start` separately on a different port.
    command: `pnpm exec next dev -H ${HOST} -p ${PORT}`,
    url: `http://${HOST}:${PORT}/`,
    reuseExistingServer: REUSE,
    timeout: 180_000,
    env: {
      RELAY_E2E_BACKDOOR: "1",
    },
  },
});
