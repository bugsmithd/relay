// Single source of truth for the app's canonical origin.
//
// SITE_ORIGIN is the origin we expect the user's browser to be on for the
// entire auth flow: it backs `emailRedirectTo` (so the magic link lands on
// the same host as the form), the same-origin guard in Server Actions, and
// the post-callback redirect.
//
// Critically, NextRequest.url in route handlers does not always reflect the
// real request host — under `next dev` we have observed it normalize to
// localhost even when the browser hit 127.0.0.1, which would land the user
// on a host where their freshly-set session cookie is not scoped. Anchoring
// every redirect to SITE_ORIGIN keeps the cookie domain and the navigation
// host in lockstep.
export function siteOrigin(): string {
  const env = process.env.SITE_ORIGIN;
  if (!env) throw new Error("SITE_ORIGIN env not set");
  return env;
}
