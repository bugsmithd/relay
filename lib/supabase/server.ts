import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const COOKIE_PREFIX =
  process.env.NODE_ENV === "production" ? "__Host-" : "__Secure-";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Single createServerClient construction. Used from Server Components,
// Route Handlers, and Server Actions. Per @supabase/ssr v0.10 guidance,
// `cookieStore.set` calls during Server Component render throw at runtime;
// we swallow that specific failure mode because Next 16's proxy (formerly
// middleware) refreshes the session cookie on every navigation, which means
// the Server Component's failed write is harmless.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");

  return createServerClient(url, anonKey, {
    cookieOptions: {
      name: `${COOKIE_PREFIX}relay-session`,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            const opts: CookieOptions = {
              ...options,
              httpOnly: true,
              secure: true,
              sameSite: "lax",
              path: "/",
            };
            cookieStore.set(name, value, opts);
          }
        } catch {
          // Called from a Server Component render; safe to ignore because the
          // proxy.ts refresh path also writes the cookie on the next request.
        }
      },
    },
  });
}
