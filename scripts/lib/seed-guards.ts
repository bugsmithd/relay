// Seed-script helpers that DO NOT read SUPABASE_SERVICE_ROLE.
// All service-role + project-ref safety lives in lib/supabase/admin.ts
// (the sole env reader, per Day 1A invariant).

export class SeedArgsError extends Error {}

export function parseRunId(argv: string[]): string {
  const idx = argv.findIndex((a) => a === "--run-id");
  if (idx === -1 || !argv[idx + 1]) {
    throw new SeedArgsError("--run-id <id> required");
  }
  const id = argv[idx + 1];
  if (!/^[a-z0-9-]{1,40}$/.test(id)) {
    throw new SeedArgsError("--run-id must match ^[a-z0-9-]{1,40}$");
  }
  return id;
}

export const SEED_SLUG_PREFIX = "test-run-";
export function seedSlug(runId: string, suffix: string): string {
  return `${SEED_SLUG_PREFIX}${runId}-${suffix}`;
}

// Local-only seed/test domain. .test is an IETF reserved TLD (RFC 6761) so
// any leak cannot resolve to a real recipient. Avoids @relay-test.invalid
// (reads as "this email is invalid") and avoids @relay.local (mDNS baggage).
export const SEED_EMAIL_DOMAIN = "relay-local.test";

// Legacy domain previously emitted by seed/test fixtures. Kept here so
// scripts/seed-cleanup.mjs can still purge any users left behind from runs
// before the rename. New code MUST use seedEmail() / SEED_EMAIL_DOMAIN.
export const LEGACY_SEED_EMAIL_DOMAIN = "relay-test.invalid";

export type SeedUserKind = "member" | "nonmember";

export function seedEmail(kind: SeedUserKind, runId: string): string {
  return `${kind}-${runId}@${SEED_EMAIL_DOMAIN}`;
}
