import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const COOKIE_PREFIX =
  process.env.NODE_ENV === "production" ? "__Host-" : "__Secure-";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Detect Next's "called from a Server Component" cookies.set() error so the
// try/catch in setAll only swallows that specific failure mode. Any other
// error (oversized cookie, invalid name, etc.) is rethrown.
const SERVER_COMPONENT_COOKIE_ERROR = /can only be modified|Cookies can only be modified/i;

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
        for (const { name, value, options } of cookiesToSet) {
          const opts: CookieOptions = {
            ...options,
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            // Strip Domain explicitly so __Host- prefix invariant holds even
            // if Supabase ever populates a domain.
            domain: undefined,
          };
          try {
            cookieStore.set(name, value, opts);
          } catch (err) {
            const msg = (err as { message?: string })?.message ?? "";
            if (SERVER_COMPONENT_COOKIE_ERROR.test(msg)) {
              // Expected when called from a Server Component render. The
              // proxy refresh path will write the cookie on the next request.
              continue;
            }
            // Unknown failure — rethrow so it's visible.
            throw err;
          }
        }
      },
    },
  });
}
