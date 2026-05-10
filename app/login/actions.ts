"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirectTarget } from "@/lib/auth/redirect-allowlist";

function siteOrigin(): string {
  const env = process.env.SITE_ORIGIN;
  if (env) return env;
  // Fall back to throwing only at boot-time configuration error.
  throw new Error("SITE_ORIGIN env not set");
}

function logDeny(reason: string, extra: Record<string, unknown> = {}) {
  console.warn(
    JSON.stringify({ component: "login-actions", reason, ...extra }),
  );
}

async function isSameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function sendMagicLinkAction(formData: FormData) {
  if (!(await isSameOrigin())) {
    logDeny("cross-origin", { action: "sendMagicLink" });
    redirect("/login?error=origin");
  }

  const email = String(formData.get("email") ?? "");
  const redirectTo = safeRedirectTarget(String(formData.get("redirect_to") ?? "/"));

  const supabase = await createSupabaseServerClient();
  const callback = new URL("/auth/callback", siteOrigin());
  callback.searchParams.set("next", redirectTo);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callback.toString() },
  });
  if (error) {
    logDeny("otp-failed", { code: (error as { code?: string }).code ?? null });
    redirect("/login?error=otp");
  }

  redirect(`/login?sent=1`);
}

export async function signOutAction() {
  if (!(await isSameOrigin())) {
    logDeny("cross-origin", { action: "signOut" });
    redirect("/login?error=origin");
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
