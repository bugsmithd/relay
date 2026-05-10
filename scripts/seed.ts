// Day 1A seed: creates two workspaces + a member user. Dev-only.
// Service-role flows through lib/supabase/admin.ts, which enforces project-ref
// + JWT-claim safety BEFORE returning a client.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createSupabaseAdminClient,
  ServiceRoleSafetyError,
  assertSeedSafeOrExit,
} from "../lib/supabase/admin.ts";
import { SeedArgsError, parseRunId, seedSlug } from "./lib/seed-guards.ts";

async function main() {
  let projectRef: string;
  let runId: string;
  try {
    ({ projectRef } = assertSeedSafeOrExit());
    runId = parseRunId(process.argv);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  const supabase = createSupabaseAdminClient({ requireSeedSafety: true });

  const memberEmail = `member-${runId}@relay-test.invalid`;
  const otherEmail = `nonmember-${runId}@relay-test.invalid`;
  const password = `seed-${runId}-${crypto.randomUUID()}`;

  const member = await supabase.auth.admin.createUser({
    email: memberEmail,
    email_confirm: true,
    password,
  });
  if (member.error) throw member.error;

  const other = await supabase.auth.admin.createUser({
    email: otherEmail,
    email_confirm: true,
    password,
  });
  if (other.error) throw other.error;

  const wsA = await supabase
    .from("workspaces")
    .insert({ slug: seedSlug(runId, "alpha"), name: `Alpha ${runId}` })
    .select()
    .single();
  if (wsA.error) throw wsA.error;

  const wsB = await supabase
    .from("workspaces")
    .insert({ slug: seedSlug(runId, "beta"), name: `Beta ${runId}` })
    .select()
    .single();
  if (wsB.error) throw wsB.error;

  const wm = await supabase.from("workspace_members").insert({
    workspace_id: wsA.data.id,
    user_id: member.data.user!.id,
  });
  if (wm.error) throw wm.error;

  const credPath = ".supabase-local/seed-credentials.json";
  mkdirSync(dirname(credPath), { recursive: true });
  writeFileSync(
    credPath,
    JSON.stringify(
      {
        project_ref: projectRef,
        run_id: runId,
        member: { email: memberEmail, password, workspace_slug: wsA.data.slug },
        non_member: { email: otherEmail, password, workspace_slug: wsB.data.slug },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  console.log(`seeded run-id=${runId} alpha=${wsA.data.slug} beta=${wsB.data.slug}`);
}

main().catch((e) => {
  if (e instanceof ServiceRoleSafetyError || e instanceof SeedArgsError) {
    console.error(e.message);
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});
