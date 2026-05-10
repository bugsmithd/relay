// Dev-only e2e backdoor. Refuses to respond unless BOTH:
//   1. NODE_ENV !== "production" (closes the door in any production build,
//      even if a misconfigured deploy sets RELAY_E2E_BACKDOOR=1).
//   2. RELAY_E2E_BACKDOOR === "1" (explicit opt-in for the e2e harness).
//
// Production deploys must NEVER set RELAY_E2E_BACKDOOR. The NODE_ENV check
// is the second wall: if the env var leaks into a prod deploy by accident,
// the route still returns 404 because `next start` runs with NODE_ENV=production.
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function backdoorEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.RELAY_E2E_BACKDOOR === "1";
}

export async function POST(req: NextRequest) {
  if (!backdoorEnabled()) {
    return new NextResponse("not found", { status: 404 });
  }
  // Surface backdoor-active state in logs so a misconfigured deploy is visible.
  console.warn(JSON.stringify({ component: "test-signin", reason: "backdoor-active" }));
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
