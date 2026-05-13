// Phase 4 — proxy two-branch policy runtime acceptance.
//
// Asserts the two boundaries the proxy owns vs the route handler owns:
//   - /api/messages          -> route-owned (route handler emits 404 + {} on
//                                 D-0, with full Day-1B headers)
//   - /api/healthz-not-real  -> proxy-owned (proxy emits 404 + empty body via
//                                 api404(), with full Day-1B headers)
//
// Both probes are unauthenticated; D-0 collapse on the route handler is the
// no-session response. Body distinguishability (`{}` vs empty) is what proves
// the proxy did not swallow `/api/messages` with the unknown-API 404.
//
// Spawns `pnpm exec next start` (production build) on an ephemeral port and
// PID-ancestry-guards the listener — pattern from tests/auth/cache-control.spec.ts.

import { test, after, before } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const HOST = "127.0.0.1";

const EXPECTED_HEADERS: Record<string, string> = {
  "cache-control": "no-store, private",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

let child: ChildProcess | null = null;
let PORT = 0;

async function pickFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        return reject(new Error("could not bind ephemeral port"));
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

function lsofListenerPid(port: number): number | null {
  const r = spawnSync(
    "lsof",
    ["-nP", "-iTCP:" + String(port), "-sTCP:LISTEN", "-t"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  const tokens = (r.stdout ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const pid = Number(tokens[0]);
  return Number.isFinite(pid) ? pid : null;
}

function processAncestors(pid: number, maxDepth = 10): number[] {
  const chain: number[] = [pid];
  let cur = pid;
  for (let i = 0; i < maxDepth; i++) {
    const r = spawnSync("ps", ["-o", "ppid=", "-p", String(cur)], {
      encoding: "utf8",
    });
    if (r.status !== 0) break;
    const ppid = Number((r.stdout ?? "").trim());
    if (!Number.isFinite(ppid) || ppid <= 1) break;
    chain.push(ppid);
    cur = ppid;
  }
  return chain;
}

async function waitFor(url: string, ms = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.status >= 200 && r.status < 600) return;
    } catch {
      // server not yet listening
    }
    await sleep(250);
  }
  throw new Error(`server at ${url} did not start within ${ms}ms`);
}

function assertSixHeaders(r: Response, label: string) {
  for (const [name, expected] of Object.entries(EXPECTED_HEADERS)) {
    assert.equal(
      r.headers.get(name),
      expected,
      `${label}: header ${name} expected ${JSON.stringify(expected)}, got ${JSON.stringify(r.headers.get(name))}`,
    );
  }
}

before(async () => {
  PORT = await pickFreePort();
  child = spawn(
    "pnpm",
    ["exec", "next", "start", "-H", HOST, "-p", String(PORT)],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production" },
    },
  );
  let stderrBuf = "";
  child.stderr?.on("data", (d) => {
    stderrBuf += d.toString();
  });
  child.stdout?.on("data", () => {});
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(
        `next start exited ${code} during boot. stderr tail: ${stderrBuf.slice(-500)}`,
      );
    }
  });
  await waitFor(`http://${HOST}:${PORT}/`);

  const listenerPid = lsofListenerPid(PORT);
  if (listenerPid === null) {
    throw new Error(
      `could not identify listener PID for port ${PORT}. Aborting to avoid false-pass.`,
    );
  }
  const childPid = child.pid;
  if (childPid === undefined) throw new Error("spawned child has no pid");
  const ancestors = processAncestors(listenerPid);
  if (!ancestors.includes(childPid)) {
    throw new Error(
      `stale-server guard tripped: listener pid ${listenerPid} ` +
        `(ancestors=[${ancestors.join(",")}]) is not a descendant of ` +
        `spawned child pid ${childPid}. Refusing to assert against a foreign server.`,
    );
  }
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

// Route-owned probe. The route handler's D-0 (no-auth) response is the
// byte-identical denial: status 404, body exactly "{}" (two bytes), full
// Day-1B header set. If the proxy accidentally swallows /api/messages, the
// observed body becomes empty (proxy-owned shape) and this fails.
test("/api/messages -> route-owned 404 with body {} (no-session D-0 collapse)", async () => {
  const r = await fetch(`http://${HOST}:${PORT}/api/messages`, {
    method: "GET",
    redirect: "manual",
  });
  const body = await r.text();
  assert.equal(r.status, 404, "route-owned probe: status must be 404");
  assert.equal(
    body,
    "{}",
    `route-owned probe: body must be exactly two bytes "{}" (got ${JSON.stringify(body)}). ` +
      `Empty body indicates the proxy swallowed /api/messages with the unknown-API shape.`,
  );
  assert.equal(
    r.headers.get("content-type"),
    "application/json",
    "route-owned probe: content-type must be application/json",
  );
  assertSixHeaders(r, "route-owned /api/messages");
});

// Proxy-owned probe. Unknown /api/* paths fall through to the Day-1B api404()
// shape: status 404, empty body, full Day-1B header set. This is the existing
// Day-1B contract that tests/security/headers.spec.ts:/api/healthz-not-real
// pins; the two-branch policy must preserve it byte-identical.
test("/api/healthz-not-real -> proxy-owned 404 with empty body (Day-1B api404)", async () => {
  const r = await fetch(`http://${HOST}:${PORT}/api/healthz-not-real`, {
    method: "GET",
    redirect: "manual",
  });
  const body = await r.text();
  assert.equal(r.status, 404, "proxy-owned probe: status must be 404");
  assert.equal(
    body.length,
    0,
    `proxy-owned probe: body must be exactly zero bytes (got ${body.length} bytes: ${JSON.stringify(body)}). ` +
      `Non-empty body indicates the route handler answered an unknown /api/* path.`,
  );
  assertSixHeaders(r, "proxy-owned /api/healthz-not-real");
});

// Distinguishability assertion — same status + headers, different body. A
// regression where /api/messages and /api/healthz-not-real produce identical
// bytes means the proxy two-branch policy collapsed.
test("body distinguishability: route-owned {} vs proxy-owned empty", async () => {
  const route = await fetch(`http://${HOST}:${PORT}/api/messages`, {
    method: "GET",
    redirect: "manual",
  });
  const proxy = await fetch(`http://${HOST}:${PORT}/api/healthz-not-real`, {
    method: "GET",
    redirect: "manual",
  });
  const routeBody = await route.text();
  const proxyBody = await proxy.text();
  assert.equal(route.status, proxy.status, "status must match across both probes");
  for (const [name, expected] of Object.entries(EXPECTED_HEADERS)) {
    assert.equal(
      route.headers.get(name),
      expected,
      `route-owned header ${name} mismatch`,
    );
    assert.equal(
      proxy.headers.get(name),
      expected,
      `proxy-owned header ${name} mismatch`,
    );
  }
  assert.notEqual(
    routeBody,
    proxyBody,
    `routes must produce DIFFERENT bodies (route-owned "{}" vs proxy-owned ""); ` +
      `got both = ${JSON.stringify(routeBody)} — proxy two-branch policy collapsed.`,
  );
  assert.equal(routeBody, "{}", "route-owned body must be {}");
  assert.equal(proxyBody.length, 0, "proxy-owned body must be empty");
});
