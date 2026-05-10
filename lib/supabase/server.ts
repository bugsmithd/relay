import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const COOKIE_PREFIX =
  process.env.NODE_ENV === "production" ? "__Host-" : "__Secure-";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

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
          };
          cookieStore.set(name, value, opts);
        }
      },
    },
  });
}
