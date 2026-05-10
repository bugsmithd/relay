"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirectTarget } from "@/lib/auth/redirect-allowlist";

function siteOrigin(): string {
  const env = process.env.SITE_ORIGIN;
  if (env) return env;
  throw new Error("SITE_ORIGIN env not set");
}

async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (!origin || !host) throw new Error("Origin/Host required");
  const originHost = new URL(origin).host;
  if (originHost !== host) throw new Error("Cross-origin POST rejected");
}

export async function sendMagicLinkAction(formData: FormData) {
  await assertSameOrigin();

  const email = String(formData.get("email") ?? "");
  const redirectTo = safeRedirectTarget(String(formData.get("redirect_to") ?? "/"));

  const supabase = await createSupabaseServerClient();
  const callback = new URL("/auth/callback", siteOrigin());
  callback.searchParams.set("next", redirectTo);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callback.toString() },
  });
  if (error) throw error;

  redirect(`/login?sent=1`);
}

export async function signOutAction() {
  await assertSameOrigin();
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
