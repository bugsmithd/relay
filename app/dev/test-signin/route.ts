// Dev-only e2e backdoor. Refuses to respond unless RELAY_E2E_BACKDOOR=1 AND
// NODE_ENV!=production. Signs in a pre-seeded test user via password, so the
// session cookie is set by @supabase/ssr exactly as production would set it.
//
// The route is unreachable in production builds because:
//   1. The env-flag guard returns 404.
//   2. The build pipeline never sets RELAY_E2E_BACKDOOR in any deploy env.
//
// Tests gate every call on a header that we strip from any logging.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function backdoorEnabled() {
  // Single env-var gate. RELAY_E2E_BACKDOOR is never set in any production
  // deploy. The route returns 404 in any other environment.
  return process.env.RELAY_E2E_BACKDOOR === "1";
}

export async function POST(req: NextRequest) {
  if (!backdoorEnabled()) {
    return new NextResponse("not found", { status: 404 });
  }
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.email || !body.password) {
    return NextResponse.json({ error: "email+password required" }, { status: 400 });
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
