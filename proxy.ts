import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const COOKIE_PREFIX =
  process.env.NODE_ENV === "production" ? "__Host-" : "__Secure-";
const COOKIE_NAME = `${COOKIE_PREFIX}relay-session`;

// Day 1B: matcher widens from `/w/:path*` to also cover `/api/:path*` so the
// six required response headers attach to API responses too. Auth-redirect
// logic stays confined to `/w/*`; `/api/*` requests pass through to Next
// routing with headers attached (Day 2A introduces API routes + their guards).
export const config = {
  matcher: ["/w/:path*", "/api/:path*"],
};

// Plan-locked CSP. Do not relax — relaxation is a plan amendment, not an
// implementation freedom. Source:
// .planning/claude-code-slack-agent-gates-week1-grounded-20260509.md §"Day 1B".
const CSP_VALUE =
  "default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'";

// Apply the six required response headers (Cache-Control + five security
// headers) to a NextResponse. Uses `set` (not `append`) so we overwrite any
// Next-default Cache-Control that the framework attaches to 404 / redirect
// responses (verified: Next 16 emits `private, no-cache, no-store, max-age=0,
// must-revalidate` on its built-in 404 before the proxy override).
// Day-1B-only synthetic 404 for matched `/api/*` paths. See proxy() body for
// why `NextResponse.next()` is unsafe for /api/* on a 404 path in Next 16.
function api404(): NextResponse {
  return securityHeaders(new NextResponse(null, { status: 404 }));
}

function securityHeaders(res: NextResponse): NextResponse {
  res.headers.set("cache-control", "no-store, private");
  res.headers.set("content-security-policy", CSP_VALUE);
  res.headers.set(
    "strict-transport-security",
    "max-age=63072000; includeSubDomains",
  );
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("x-frame-options", "DENY");
  return res;
}

// Next 16 deprecated `middleware.ts` in favor of `proxy.ts` with `proxy` export.
// Edge runtime is not available under proxy; that's fine — we only need Node APIs.
//
// Cookie pattern follows the @supabase/ssr v0.10 canonical Next.js example:
// inside `setAll`, we mirror cookies onto BOTH `request` (so any further reads
// in this same request see the rotated session) AND a fresh `response` (so the
// browser receives the rotated cookie). Critical when Supabase rotates the
// access token mid-request — without this, the rotated token is dropped.
//
// `securityHeaders(...)` is applied to the FINAL response object on every
// return path so the headers land after any cookie-driven `response`
// reassignment inside `setAll`.
export async function proxy(req: NextRequest) {
  const url = req.nextUrl;
  const isWorkspacePath = url.pathname.startsWith("/w/");
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    // Fail-closed for `/w/*`: redirect to /login. `/api/*` returns a synthetic
    // 404 from the proxy (see api404 below for the Day-1B-only rationale).
    if (isWorkspacePath) {
      return securityHeaders(
        NextResponse.redirect(new URL("/login", url.origin)),
      );
    }
    return api404();
  }

  // `/api/*` in Day 1B has no auth gate and no API routes. We must NOT call
  // `NextResponse.next()` here: Next 16's built-in 404 handler overrides
  // middleware-set `Cache-Control` with its own (`private, no-cache, no-store,
  // max-age=0, must-revalidate`), which silently regresses Stop Condition #4.
  // Returning a synthetic 404 from the proxy keeps our headers intact.
  //
  // Day 2A will introduce real API routes and must refactor this branch — the
  // synthetic 404 is correct only while no API routes exist.
  if (!isWorkspacePath) {
    return api404();
  }

  // `/w/*` — auth + cookie rotation path.
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
    return securityHeaders(redirectRes);
  }

  return securityHeaders(response);
}
