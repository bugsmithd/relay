import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const COOKIE_PREFIX =
  process.env.NODE_ENV === "production" ? "__Host-" : "__Secure-";
const COOKIE_NAME = `${COOKIE_PREFIX}relay-session`;

export const config = {
  matcher: ["/w/:path*"],
};

// Next 16 deprecated `middleware.ts` in favor of `proxy.ts` with `proxy` export.
// Edge runtime is not available under proxy; that's fine for Day 1A — we only
// need Node APIs.
//
// Cookie pattern follows the @supabase/ssr v0.10 canonical Next.js example:
// inside `setAll`, we mirror cookies onto BOTH `request` (so any further reads
// in this same request see the rotated session) AND a fresh `response` (so the
// browser receives the rotated cookie). Critical when Supabase rotates the
// access token mid-request — without this, the rotated token is dropped.
export async function proxy(req: NextRequest) {
  const url = req.nextUrl;
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    // Without env, fail closed.
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookieOptions: {
      name: COOKIE_NAME,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return req.cookies.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          req.cookies.set(name, value);
        }
        response = NextResponse.next({ request: req });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set({
            name,
            value,
            ...options,
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            // Strip Domain so __Host- prefix invariant is preserved.
            domain: undefined,
          });
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("redirect_to", url.pathname);
    // Carry any rotated cookies onto the redirect response so a refresh that
    // happened during getUser() isn't lost.
    const redirectRes = NextResponse.redirect(loginUrl);
    for (const c of response.cookies.getAll()) redirectRes.cookies.set(c);
    return redirectRes;
  }

  return response;
}
