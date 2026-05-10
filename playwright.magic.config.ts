// Dedicated Playwright config for the real magic-link e2e.
// Pins Next dev to host:port = 127.0.0.1:3000 because supabase/config.toml's
// `site_url = "http://127.0.0.1:3000"` is what Supabase uses to construct the
// magic-link `redirect_to`. Running on a different port would land the email
// link on a host with no listener (or, worse, on a stale dev process).
//
// This config does NOT enable the /dev/test-signin backdoor: the real-flow
// e2e must succeed without it.
import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

// Load .env.local into process.env for the Playwright runner so the seed
// fixture's assertTestTargetSafe() sees the local Supabase URL + service-role
// key. Next dev loads its own envs separately. Tiny inline parser keeps us
// off `dotenv` (not a project dep).
function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}
loadEnvLocal();

const HOST = "127.0.0.1";
const PORT = 3000;
const REUSE = process.env.E2E_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "tests/e2e-magic",
  testIgnore: ["**/lib/**"],
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev -H ${HOST} -p ${PORT}`,
    url: `http://${HOST}:${PORT}/`,
    reuseExistingServer: REUSE,
    timeout: 180_000,
    // No RELAY_E2E_BACKDOOR. Real flow only.
    env: {},
  },
});
