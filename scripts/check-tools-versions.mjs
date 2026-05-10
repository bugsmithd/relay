// tools-version-check: verifies binary versions, npm dependency versions, and
// pnpm-lock.yaml SHA256 against tools.lock.json. Exit non-zero on any drift.

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const ROOT = process.cwd();
const lockPath = resolve(ROOT, "tools.lock.json");
if (!existsSync(lockPath)) {
  console.error("tools.lock.json missing");
  process.exit(1);
}
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const errors = [];

function bin(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim();
}

function check(label, expected, actual) {
  if (!actual) {
    errors.push(`${label}: could not read actual version`);
    return;
  }
  if (actual !== expected) {
    errors.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

if (lock.binaries) {
  if (lock.binaries.node) {
    check("node", lock.binaries.node, (bin("node", ["-v"]) ?? "").replace(/^v/, ""));
  }
  if (lock.binaries.pnpm) {
    check("pnpm", lock.binaries.pnpm, bin("pnpm", ["-v"]));
  }
  if (lock.binaries.semgrep) {
    const sv = bin("semgrep", ["--version"]);
    check("semgrep", lock.binaries.semgrep, sv);
  }
}

if (lock.npm) {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const [name, expected] of Object.entries(lock.npm)) {
    const actual = all[name];
    check(`npm:${name}`, expected, actual);
  }
}

if (lock.lockfile_sha256) {
  const lockfilePath = resolve(ROOT, "pnpm-lock.yaml");
  if (!existsSync(lockfilePath)) {
    errors.push("pnpm-lock.yaml missing; cannot verify lockfile_sha256");
  } else {
    const h = createHash("sha256")
      .update(readFileSync(lockfilePath))
      .digest("hex");
    check("pnpm-lock.yaml sha256", lock.lockfile_sha256, h);
  }
}

if (errors.length) {
  for (const e of errors) console.error("FAIL " + e);
  process.exit(1);
}
console.log("tools-version-check ok");
