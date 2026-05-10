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
