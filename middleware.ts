import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const COOKIE_PREFIX =
  process.env.NODE_ENV === "production" ? "__Host-" : "__Secure-";

export const config = {
  matcher: ["/w/:path*"],
};

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    // Without env, fail closed.
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const res = NextResponse.next();

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookieOptions: {
      name: `${COOKIE_PREFIX}relay-session`,
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
        for (const { name, value, options } of cookiesToSet) {
          res.cookies.set({
            name,
            value,
            ...options,
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
          });
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("redirect_to", url.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}
