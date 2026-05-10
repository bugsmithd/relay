// Regression: app/dev/test-signin/route.ts must return 404 when NODE_ENV=production
// even if RELAY_E2E_BACKDOOR=1 leaks into the deploy.
//
// Anti-false-pass:
// - Picks an ephemeral port via net.createServer().listen(0) instead of a fixed
//   one — eliminates collision with stale Next servers from prior runs.
// - After spawn + readiness, queries `lsof` for the listener PID on PORT and
//   walks the parent chain via `ps -o ppid=` to confirm the listener belongs
//   to our spawned child. Any other PID → throw "stale server" before any
//   assertion runs. This stops the test from passing against a foreign server
//   (e.g., yesterday's `next start` left running).
//
// Pre-requisite: `pnpm build` already produced .next/. The closeout target runs
// build before this spec.
import { test, after, before } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const HOST = "127.0.0.1";

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
    } catch {}
    await sleep(250);
  }
  throw new Error(`server at ${url} did not start within ${ms}ms`);
}

before(async () => {
  PORT = await pickFreePort();
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

  // Anti-false-pass: confirm the listener on PORT belongs to the process tree
  // we spawned. Without this, a foreign server on the same port (vanishingly
  // unlikely with an ephemeral port, but defense in depth) could satisfy the
  // 404 assertion for the wrong reason.
  const listenerPid = lsofListenerPid(PORT);
  if (listenerPid === null) {
    throw new Error(
      `could not identify listener PID for port ${PORT}. Aborting to avoid false-pass.`,
    );
  }
  const childPid = child.pid;
  if (childPid === undefined) {
    throw new Error("spawned child has no pid");
  }
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
