#!/usr/bin/env node
// Reproducible proof that the stale-server guard in
// tests/security/backdoor-production-blocked.spec.ts would refuse to assert
// against a foreign listener.
//
// Method:
//   1. Spawn a benign HTTP listener detached + double-forked via `nohup ... &`
//      in `sh -c`, so the listener reparents to init (PID 1) and is NOT a
//      descendant of this proof process. This faithfully mirrors the "stale
//      server left over from a previous test run" failure mode.
//   2. Wait for the listener to write its {port, pid} to a tempfile.
//   3. Walk the listener PID's parent chain via `ps -o ppid=` (same logic the
//      spec uses).
//   4. Confirm the chain does NOT include this proof process's PID. If it did,
//      the spec's guard would PASS the foreign listener through — which is
//      exactly what we're testing CANNOT happen.
//
// Output: text proof to stdout. Exit 0 iff guard would reject foreign listener.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

function processAncestors(pid, maxDepth = 10) {
  const chain = [pid];
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

const dir = mkdtempSync(join(tmpdir(), "stale-server-proof-"));
const probeJs = join(dir, "probe.cjs");
const outFile = join(dir, "meta.json");

writeFileSync(
  probeJs,
  `
const http = require('node:http');
const fs = require('node:fs');
const srv = http.createServer((req, res) => res.end('foreign'));
srv.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(${JSON.stringify(outFile)},
    JSON.stringify({ port: srv.address().port, pid: process.pid }));
});
setTimeout(() => process.exit(0), 12000);
`,
);

// Detached double-fork: sh forks node into background via &, then sh exits.
// node's parent becomes init (1) within ~milliseconds. The shell prints node's
// pid before exiting.
const launch = spawnSync(
  "sh",
  [
    "-c",
    `nohup ${process.execPath} ${probeJs} </dev/null >/dev/null 2>&1 & echo -n $!`,
  ],
  { encoding: "utf8" },
);
if (launch.status !== 0) {
  console.error(`stale-server-guard-proof: failed to spawn detached listener: ${launch.stderr}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(2);
}

// Wait for listener to announce. Up to ~5 s.
let meta = null;
for (let i = 0; i < 50; i++) {
  await sleep(100);
  if (existsSync(outFile)) {
    try {
      const txt = readFileSync(outFile, "utf8");
      if (txt) {
        meta = JSON.parse(txt);
        break;
      }
    } catch {}
  }
}
if (!meta) {
  console.error("stale-server-guard-proof: foreign listener did not announce within 5s");
  rmSync(dir, { recursive: true, force: true });
  process.exit(2);
}

// Wait one more tick so the shell has actually exited and re-parenting to init
// has settled.
await sleep(200);

const ancestors = processAncestors(meta.pid);
const proofPid = process.pid;
const wouldReject = !ancestors.includes(proofPid);

const lines = [
  "# Stale-server guard proof",
  "",
  `Generated:                          ${new Date().toISOString()}`,
  `Proof process PID (simulated 'spawned child' the spec would compare against): ${proofPid}`,
  `Foreign listener PID:               ${meta.pid}`,
  `Foreign listener port:              ${meta.port}`,
  `Foreign listener ancestor chain (ps -o ppid= walk, depth 10):`,
  `  [${ancestors.join(", ")}]`,
  "",
  `Guard logic in tests/security/backdoor-production-blocked.spec.ts:`,
  `  if (!processAncestors(listenerPid).includes(child.pid)) throw "stale-server guard tripped"`,
  "",
  `ancestors.includes(${proofPid}) === ${ancestors.includes(proofPid)}`,
  `Guard would reject foreign listener: ${wouldReject}`,
  "",
  wouldReject
    ? "PASS: backdoor regression spec WOULD throw before any assertion ran against this foreign listener."
    : "FAIL: PID ancestry walk did NOT reject the foreign listener; guard would not trip.",
];
console.log(lines.join("\n"));

// Best-effort cleanup. The detached listener will exit on its own timer.
try { rmSync(dir, { recursive: true, force: true }); } catch {}

process.exit(wouldReject ? 0 : 1);
