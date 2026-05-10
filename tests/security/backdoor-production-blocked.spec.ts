// Regression: app/dev/test-signin/route.ts must return 404 when NODE_ENV=production
// even if RELAY_E2E_BACKDOOR=1 leaks into the deploy. Spawns `next start` (which
// forces NODE_ENV=production), POSTs to /dev/test-signin with backdoor flag set,
// asserts 404.
//
// Pre-requisite: `pnpm build` already produced .next/. The closeout target runs
// build before this spec.
import { test, after, before } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.BACKDOOR_TEST_PORT ?? 3201);
const HOST = "127.0.0.1";

let child: ChildProcess | null = null;

async function waitFor(url: string, ms = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.status >= 200 && r.status < 600) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`server at ${url} did not start within ${ms}ms`);
}

before(async () => {
  // Spawn `next start` with NODE_ENV=production (Next sets this anyway) AND
  // RELAY_E2E_BACKDOOR=1. The route's NODE_ENV gate must override the env flag.
  child = spawn(
    "pnpm",
    ["exec", "next", "start", "-H", HOST, "-p", String(PORT)],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        RELAY_E2E_BACKDOOR: "1",
        NODE_ENV: "production",
      },
    },
  );
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});
  await waitFor(`http://${HOST}:${PORT}/`);
});

after(async () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise<void>((res) => {
      const t = setTimeout(() => {
        child?.kill("SIGKILL");
        res();
      }, 3000);
      child?.once("exit", () => {
        clearTimeout(t);
        res();
      });
    });
  }
});

test("POST backdoor returns 404 in production build even with RELAY_E2E_BACKDOOR=1", async () => {
  const r = await fetch(`http://${HOST}:${PORT}/dev/test-signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "x@y.invalid", password: "irrelevant" }),
  });
  assert.equal(r.status, 404, `expected 404 in production NODE_ENV, got ${r.status}`);
  const text = await r.text();
  assert.ok(!/"ok"\s*:\s*true/.test(text), "response leaked an ok payload");
});

test("GET backdoor never leaks an ok payload in production build", async () => {
  // Route only exports POST, so GET in production may surface as 404 or 405
  // depending on Next's method-routing. Either is fine; what's not fine is any
  // response shape that confirms the backdoor is reachable.
  const r = await fetch(`http://${HOST}:${PORT}/dev/test-signin`, { method: "GET" });
  assert.ok([404, 405].includes(r.status), `expected 404|405 GET, got ${r.status}`);
  const text = await r.text();
  assert.ok(!/"ok"\s*:\s*true/.test(text), "GET response leaked an ok payload");
  assert.ok(!/backdoor[_-]?enabled/i.test(text), "GET response surfaced backdoor state");
});
