// Scans .next/static for the literal SUPABASE_SERVICE_ROLE value.
// Exit codes:
//   0 = scan ran, no leak
//   2 = preconditions missing (no env, no .next/static)
//   3 = leak found
//   4 = scan failed (unreadable file) — fail-closed

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd(), ".next/static");
const ENV = process.env.SUPABASE_SERVICE_ROLE;

if (!ENV) {
  console.error("SUPABASE_SERVICE_ROLE not set; cannot scan");
  process.exit(2);
}
if (!existsSync(ROOT)) {
  console.error(`.next/static missing at ${ROOT}; run pnpm build first`);
  process.exit(2);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const offenders = [];
let scanned = 0;
for (const file of walk(ROOT)) {
  let buf;
  try {
    buf = readFileSync(file, "utf8");
  } catch (err) {
    // Fail closed: an unreadable file in the bundle path means we can't
    // certify it doesn't leak. Surface and exit 4.
    console.error(
      `bundle-leak: unreadable file (cannot certify), exiting fail-closed: ${file}`,
    );
    console.error(err?.message ?? err);
    process.exit(4);
  }
  scanned += 1;
  if (buf.includes(ENV)) offenders.push(file);
}

if (offenders.length) {
  console.error("SERVICE-ROLE LEAK in client bundle:");
  for (const f of offenders) console.error("  " + f);
  process.exit(3);
}

console.log(`bundle-leak scan ok: scanned ${scanned} file(s) under ${ROOT}`);
process.exit(0);
