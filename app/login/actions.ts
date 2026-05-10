"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirectTarget } from "@/lib/auth/redirect-allowlist";
import { siteOrigin } from "@/lib/auth/site-origin";

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

// Returns absolute SITE_ORIGIN URL if the request landed on a different
// host, else null. Cookies are host-scoped — see
// tests/e2e-magic/host-mismatch.spec.ts for the failure mode this prevents.
async function canonicalRedirectIfHostMismatch(
  path: string,
): Promise<string | null> {
  const h = await headers();
  const host = h.get("host");
  let canonicalHost: string;
  let canonicalUrl: URL;
  try {
    canonicalUrl = new URL(path, siteOrigin());
    canonicalHost = canonicalUrl.host;
  } catch {
    return null;
  }
  if (host && host === canonicalHost) return null;
  return canonicalUrl.toString();
}

export async function sendMagicLinkAction(formData: FormData) {
  const canonical = await canonicalRedirectIfHostMismatch("/login?error=host");
  if (canonical) {
    const h = await headers();
    logDeny("host-mismatch", {
      action: "sendMagicLink",
      host: h.get("host"),
    });
    redirect(canonical);
  }

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
  const canonical = await canonicalRedirectIfHostMismatch("/login");
  if (canonical) {
    const h = await headers();
    logDeny("host-mismatch", { action: "signOut", host: h.get("host") });
    redirect(canonical);
  }

  if (!(await isSameOrigin())) {
    logDeny("cross-origin", { action: "signOut" });
    redirect("/login?error=origin");
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
