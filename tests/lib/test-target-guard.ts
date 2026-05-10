// Refuse to point any test harness at a non-local Supabase target.
// Two checks (mirrors lib/supabase/admin.ts assertSeedSafe):
//   1. SUPABASE_URL host must be in TEST_SUPABASE_HOST_ALLOWLIST.
//   2. SUPABASE_SERVICE_ROLE JWT must carry `iss` (or `ref`) matching
//      SUPABASE_PROJECT_REF, AND that ref must be in DEV_PROJECT_REF_ALLOWLIST.
//
// Defaults: localhost / 127.0.0.1 only. CI can override via env.

import { Buffer } from "node:buffer";

export class TestTargetSafetyError extends Error {}

const DEFAULT_ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new TestTargetSafetyError("service-role JWT shape invalid");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

function envAllowedHosts(): Set<string> {
  const raw = process.env.TEST_SUPABASE_HOST_ALLOWLIST;
  if (!raw) return DEFAULT_ALLOWED_HOSTS;
  const out = new Set<string>();
  for (const h of raw.split(",").map((s) => s.trim()).filter(Boolean)) out.add(h);
  return out;
}

export function assertTestTargetSafe(): {
  url: string;
  serviceRole: string;
  anonKey: string;
  projectRef: string;
} {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new TestTargetSafetyError("SUPABASE_URL not set");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new TestTargetSafetyError(`SUPABASE_URL not a valid URL: ${url}`);
  }
  const allowed = envAllowedHosts();
  if (!allowed.has(host)) {
    throw new TestTargetSafetyError(
      `SUPABASE_URL host '${host}' not in TEST_SUPABASE_HOST_ALLOWLIST. ` +
        `Refuse to run against non-local target. ` +
        `(allowlist: ${[...allowed].join(",")})`,
    );
  }

  const sr = process.env.SUPABASE_SERVICE_ROLE;
  if (!sr) throw new TestTargetSafetyError("SUPABASE_SERVICE_ROLE not set");

  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!ref) throw new TestTargetSafetyError("SUPABASE_PROJECT_REF not set");
  const allow = (process.env.DEV_PROJECT_REF_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) {
    throw new TestTargetSafetyError(
      "DEV_PROJECT_REF_ALLOWLIST not set; refuse to run with service-role",
    );
  }
  if (!allow.includes(ref)) {
    throw new TestTargetSafetyError(
      `SUPABASE_PROJECT_REF=${ref} not in DEV_PROJECT_REF_ALLOWLIST`,
    );
  }

  const payload = decodeJwtPayload(sr);
  const refClaim = (payload as { ref?: unknown }).ref;
  const issClaim = (payload as { iss?: unknown }).iss;
  const matched =
    (typeof refClaim === "string" && refClaim === ref) ||
    (typeof issClaim === "string" && issClaim === ref);
  if (!matched) {
    throw new TestTargetSafetyError(
      `service-role JWT does not bind to project '${ref}' (no matching ref/iss claim)`,
    );
  }

  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) throw new TestTargetSafetyError("SUPABASE_ANON_KEY not set");

  return { url, serviceRole: sr, anonKey, projectRef: ref };
}
