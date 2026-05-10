// Browser Supabase client. NOT in active use during Day 1A — there are no
// client components performing data fetches. Kept as a documented stub so
// later days (Realtime in Day 3) can adopt it without re-architecting.
//
// Contract:
// - Session cookie set by /auth/callback is HttpOnly, so this client cannot
//   read the session via document.cookie.
// - The library still works for UI-triggered actions (signInWithPassword,
//   signInWithOtp, signOut) and for Realtime subscriptions: it manages
//   session state in its own in-memory storage layer, populated by the
//   server-side callback's response and by explicit signIn calls.
// - To prevent silent fall-through into "future code accidentally relies on
//   document.cookie", the factory below errors if invoked from a non-browser
//   context (where window is undefined).
//
// Day 3 owners: when wiring Realtime, import this factory inside a
// "use client" component, call it once at module scope, and re-use the
// returned client for subscriptions.
import { createBrowserClient } from "@supabase/ssr";

function requirePublicEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export function createSupabaseBrowserClient() {
  if (typeof window === "undefined") {
    throw new Error(
      "createSupabaseBrowserClient() called in a non-browser context. " +
        "Use createSupabaseServerClient() (Route Handlers / Server Actions / " +
        "Server Components) or createSupabaseAdminClient() (CLI) instead.",
    );
  }
  return createBrowserClient(
    requirePublicEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requirePublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}
