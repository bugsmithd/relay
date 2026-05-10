// Self-test for the bundle-leak scanner without rebuilding the app.
// Writes a synthetic file under .next/static containing SUPABASE_SERVICE_ROLE,
// runs the scanner, asserts exit=3 (leak detected), then cleans up.
//
// Safety gate: SUPABASE_SERVICE_ROLE value MUST start with `leak-test-` or `synthetic-`.
// Real-shape JWT (`eyJ...`) values are rejected to prevent accidental prod-key planting.

import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const PREFIX_RE = /^(leak-test-|synthetic-)/;
const ENV = process.env.SUPABASE_SERVICE_ROLE;
const MODE = process.argv[2] ?? "leak"; // "leak" | "unreadable"

if (!ENV) {
  console.error("SUPABASE_SERVICE_ROLE not set");
  process.exit(2);
}
if (!PREFIX_RE.test(ENV)) {
  console.error(
    "real-shape value rejected: SUPABASE_SERVICE_ROLE must start with leak-test- or synthetic-",
  );
  process.exit(2);
}

const STATIC_DIR = resolve(process.cwd(), ".next/static/_leak-fixture");
const FIXTURE = join(STATIC_DIR, "fixture.js");
const SCANNER = resolve(process.cwd(), "scripts/check-bundle-leak.mjs");

function expect(condition, msg) {
  if (!condition) {
    console.error("ASSERT FAIL: " + msg);
    process.exit(1);
  }
}

let exitCode = 0;
try {
  mkdirSync(STATIC_DIR, { recursive: true });

  if (MODE === "leak") {
    writeFileSync(FIXTURE, `// fixture\nconst x = ${JSON.stringify(ENV)};\n`);
    const r = spawnSync(process.execPath, [SCANNER], {
      env: { ...process.env, SUPABASE_SERVICE_ROLE: ENV },
      encoding: "utf8",
    });
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
    expect(r.status === 3, `expected scanner exit=3 (leak detected), got ${r.status}`);
    console.log("fixture leak detected as expected (exit=3)");
  } else if (MODE === "unreadable") {
    writeFileSync(FIXTURE, "// inert\n");
    chmodSync(FIXTURE, 0o000);
    const r = spawnSync(process.execPath, [SCANNER], {
      env: { ...process.env, SUPABASE_SERVICE_ROLE: ENV },
      encoding: "utf8",
    });
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
    // Restore mode so cleanup can remove it.
    try {
      chmodSync(FIXTURE, 0o644);
    } catch {}
    expect(
      r.status === 4,
      `expected scanner exit=4 (fail-closed on unreadable), got ${r.status}`,
    );
    console.log("fixture unreadable file fails closed as expected (exit=4)");
  } else {
    console.error(`unknown mode: ${MODE}`);
    exitCode = 1;
  }
} catch (e) {
  console.error("fixture harness error: " + (e?.message ?? e));
  exitCode = 1;
} finally {
  // Surface cleanup failures explicitly (no swallowed catch).
  try {
    if (existsSync(FIXTURE)) chmodSync(FIXTURE, 0o644);
    rmSync(STATIC_DIR, { recursive: true, force: true });
  } catch (cleanupErr) {
    console.error("CLEANUP FAILED: " + (cleanupErr?.message ?? cleanupErr));
    exitCode = exitCode || 1;
  }
  if (existsSync(FIXTURE)) {
    console.error("CLEANUP INCOMPLETE: fixture still present at " + FIXTURE);
    exitCode = exitCode || 1;
  } else {
    console.log("cleanup verified");
  }
}

process.exit(exitCode);
