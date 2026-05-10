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
import {
  SeedArgsError,
  parseRunId,
  seedEmail,
  seedSlug,
} from "./lib/seed-guards.ts";

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

  const memberEmail = seedEmail("member", runId);
  const otherEmail = seedEmail("nonmember", runId);
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

  // Credential file holds the seeded password — sole on-disk record. If the
  // write fails the seed is unusable (operator can't sign in), so the script
  // must surface that as a hard failure, not a silent "seeded …" success.
  const credPath = ".supabase-local/seed-credentials.json";
  try {
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
  } catch (e) {
    console.error(
      `seed: failed to write ${credPath}: ${(e as Error).message}. ` +
        `Aborting so operator does not get a seed without credentials.`,
    );
    process.exit(1);
  }

  // Operator-friendly stdout: explicit credential file path + every value a
  // manual demo needs, so no one has to guess the email or workspace slug.
  // Password is intentionally NOT printed; it lives only in the cred file.
  console.log(`seeded run-id=${runId}`);
  console.log(`seed_credentials=${credPath}`);
  console.log(`member_email=${memberEmail}`);
  console.log(`member_workspace=/w/${wsA.data.slug}`);
  console.log(`nonmember_email=${otherEmail}`);
  console.log(`nonmember_workspace=/w/${wsB.data.slug}`);
}

main().catch((e) => {
  if (e instanceof ServiceRoleSafetyError || e instanceof SeedArgsError) {
    console.error(e.message);
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});
