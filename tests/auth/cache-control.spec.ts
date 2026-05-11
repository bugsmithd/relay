// Day 1B: response on /w/<slug> must carry `Cache-Control: no-store, private`.
//
// Spawns `pnpm exec next start` (production build) on an ephemeral port and
// PID-ancestry-guards the listener (copy of the pattern in
// tests/security/backdoor-production-blocked.spec.ts:16-40). `pnpm build` must
// have produced `.next/` before this spec runs.
//
// The assertion is taken against the IMMEDIATE response with `redirect:
// "manual"` so the header attaches to the proxy's response (whatever its
// status), not whatever the redirect target eventually serves.
import { test, after, before } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const HOST = "127.0.0.1";
const TEST_SLUG = "day-1b-test-slug";

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

test(`response on /w/${TEST_SLUG} carries Cache-Control: no-store, private`, async () => {
  const r = await fetch(`http://${HOST}:${PORT}/w/${TEST_SLUG}`, {
    method: "GET",
    redirect: "manual",
  });
  assert.equal(
    r.headers.get("cache-control"),
    "no-store, private",
    `expected Cache-Control: no-store, private; got: ${JSON.stringify(r.headers.get("cache-control"))}`,
  );
});
