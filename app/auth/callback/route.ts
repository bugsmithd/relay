import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirectTarget } from "@/lib/auth/redirect-allowlist";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Allowlisted Supabase email-OTP types. verifyOtp accepts more (sms, phone_change),
// but the magic-link flow only uses these. Reject anything else at runtime.
const ALLOWED_TYPES = new Set<EmailOtpType>([
  "email",
  "magiclink",
  "signup",
  "recovery",
  "invite",
  "email_change",
]);

function parseEmailOtpType(raw: string | null): EmailOtpType | null {
  if (raw === null) return null;
  return ALLOWED_TYPES.has(raw as EmailOtpType) ? (raw as EmailOtpType) : null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const next = safeRedirectTarget(url.searchParams.get("next"));

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login", url.origin));
  } else if (tokenHash) {
    const type = parseEmailOtpType(rawType);
    if (type === null) {
      return NextResponse.redirect(new URL("/login", url.origin));
    }
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) return NextResponse.redirect(new URL("/login", url.origin));
  } else {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  // `next` is from the redirect-allowlist (root or /w/<slug>). Never carries
  // code/token_hash, so nothing sensitive lands in the redirect target or any
  // downstream URL log.
  return NextResponse.redirect(new URL(next, url.origin));
}
