// Semgrep --test fixture for service-role-boundary.
// Both positive and negative cases live here; semgrep pairs by basename.

// ruleid: service-role-boundary
const leak1 = process.env.SUPABASE_SERVICE_ROLE;

// ruleid: service-role-boundary
const leak2 = process.env["SUPABASE_SERVICE_ROLE"];

// ruleid: service-role-boundary
const leak3 = process.env['SUPABASE_SERVICE_ROLE'];

// ok: service-role-boundary
const anon = process.env.SUPABASE_ANON_KEY;

// ok: service-role-boundary
const url = process.env.SUPABASE_URL;

// ok: service-role-boundary
const projectRef = process.env.SUPABASE_PROJECT_REF;

console.log(leak1, leak2, leak3, anon, url, projectRef);
