import "server-only";
import { Buffer } from "node:buffer";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// admin.ts is the SOLE reader of SUPABASE_SERVICE_ROLE in the repo.
// Anything that needs service-role access (seed scripts, identity-table
// writes, etc.) calls createSupabaseAdminClient() — never reads the env directly.

export class ServiceRoleSafetyError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ServiceRoleSafetyError";
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new ServiceRoleSafetyError(`Missing env: ${name}`);
  return v;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new ServiceRoleSafetyError("service-role JWT shape invalid");
  }
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

function assertSeedSafe(): { projectRef: string; serviceRole: string } {
  const ref = requireEnv("SUPABASE_PROJECT_REF");
  const allow = (process.env.DEV_PROJECT_REF_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) {
    throw new ServiceRoleSafetyError(
      "DEV_PROJECT_REF_ALLOWLIST not set; refuse to run with service-role",
    );
  }
  if (!allow.includes(ref)) {
    throw new ServiceRoleSafetyError(
      `SUPABASE_PROJECT_REF=${ref} not in DEV_PROJECT_REF_ALLOWLIST; refuse to run`,
    );
  }
  const sr = requireEnv("SUPABASE_SERVICE_ROLE");
  const payload = decodeJwtPayload(sr);
  // Per OR-Auth-2: cloud-issued service-role JWTs carry a `ref` claim. Local
  // Supabase emits `iss`/`role` instead. Accept either, matched against
  // SUPABASE_PROJECT_REF. Reject if neither claim is present, so the guard
  // never silently degrades.
  const refClaim = (payload as { ref?: unknown }).ref;
  const issClaim = (payload as { iss?: unknown }).iss;
  const matched =
    (typeof refClaim === "string" && refClaim === ref) ||
    (typeof issClaim === "string" && issClaim === ref);
  if (!matched) {
    throw new ServiceRoleSafetyError(
      `service-role JWT does not bind to project '${ref}'. ` +
        `Expected 'ref' or 'iss' claim to equal SUPABASE_PROJECT_REF.`,
    );
  }
  return { projectRef: ref, serviceRole: sr };
}

export type AdminClientOptions = {
  // When true, refuse to construct unless project-ref allowlist + JWT-ref claim match.
  // Required by every seed/cleanup path.
  requireSeedSafety?: boolean;
};

export function createSupabaseAdminClient(
  opts: AdminClientOptions = {},
): SupabaseClient {
  const url = requireEnv("SUPABASE_URL");
  let serviceRole: string;
  if (opts.requireSeedSafety) {
    ({ serviceRole } = assertSeedSafe());
  } else {
    serviceRole = requireEnv("SUPABASE_SERVICE_ROLE");
  }
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Public projection of the seed-safety check, for callers that want to fail
// fast before constructing the client. Internally re-uses the same env reads
// — service-role still only flows through this module.
export function assertSeedSafeOrExit(): { projectRef: string } {
  const { projectRef } = assertSeedSafe();
  return { projectRef };
}
