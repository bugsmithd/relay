// Phase 4 — /api/messages route handler.
//
// Hard concrete body-size cap (per docs/tasks/day-2a-phase4-proxy-message-paths.md
// §"Implementation Checklist" 2h): MAX_BODY_BYTES = 4096. Literal integer, not
// "reasonable" / "whatever". Enforcement is a hard byte counter on the
// request body stream (readBodyWithCap below); Content-Length is NEVER trusted
// for size decisions because chunked, missing, and lying Content-Length all
// fall through the same byte-counter path.
//
// Route-vs-action divergence: this route handler collapses every denial
// sub-case (D-0..D-17 except HEAD) to a byte-identical 404 + "{}" response
// with the full Day-1B six-header set. It does NOT redirect on cross-origin
// or host-mismatch (D-14). The companion Server Action in
// app/w/[workspaceSlug]/actions.ts uses redirect-based denial; the divergence
// is intentional and noted in the slice contract §"Security Invariants".
//
// D-8 / D-9 honest split: every supabase await is wrapped in try-catch so
// that thrown failures (createSupabaseServerClient throw, auth.getUser throw,
// supabase-js builder throw) and PostgREST error envelopes collapse to the
// byte-identical denial response with no message / details / hint / stack
// leakage. Deterministic runtime forcing of these paths is Phase-6
// follow-up; Phase 4 reviews them by source per the slice contract §"D-8 /
// D-9 honest split".

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 4096;

// Day-1B six-header set. Byte-identical to proxy securityHeaders() (proxy.ts)
// AND to tests/security/headers.spec.ts EXPECTED_HEADERS. Attached to every
// response this route emits — positive 200 / 201, denial 404 + {}, HEAD 404
// headers-only, unsupported-method 404 + {}.
const DAY_1B_HEADERS: Record<string, string> = {
  "cache-control": "no-store, private",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

// Route-local regex copies. UUID_RE mirrors lib/auth/with-channel-guard.ts;
// SLUG_RE mirrors lib/auth/with-workspace-guard.ts. Duplicated by design —
// the route handler does not import from lib/auth/** for regex literals
// (slice contract 2d). On drift, update both sites or fail one of the
// reviewer checks.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_RE = /^[a-z0-9-]+$/;

// Route-local Origin/Host helpers — reproduced from the app/login/actions.ts
// precedent (slice contract 2e). DO NOT import from app/login/actions.ts
// (those functions are private to that module and the route handler must
// stay decoupled from the login surface).
//
// Route-handler usage differs from the Server Action: the action redirects
// on mismatch; this route handler collapses mismatch to byte-identical
// 404 + {} (route-vs-action divergence, slice contract §"Security
// Invariants"). The helper still returns the canonical URL on mismatch /
// null on match so the source-review fingerprint matches the precedent.
async function isSameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function canonicalRedirectIfHostMismatch(): Promise<string | null> {
  const h = await headers();
  const host = h.get("host");
  const env = process.env.SITE_ORIGIN;
  if (!env) return null;
  let canonical: URL;
  try {
    canonical = new URL(env);
  } catch {
    return null;
  }
  if (host && host === canonical.host) return null;
  return canonical.toString();
}

// Byte-identical denial. status 404, body "{}", Content-Type
// application/json, full Day-1B header set. No X-Reason, no Allow, no
// WWW-Authenticate. No PostgREST message / details / hint / stack / row
// content / channel-existence signal.
function denyResponse(): Response {
  return new Response("{}", {
    status: 404,
    headers: { "content-type": "application/json", ...DAY_1B_HEADERS },
  });
}

// HEAD-only 404. status 404, full Day-1B headers, NO body. HEAD responses
// MUST NOT carry a body per RFC 9110 §9.3.2. NO Content-Type:
// application/json (no body to type), NO Content-Length: 2, NO Allow, NO
// WWW-Authenticate.
function headOnly404(): Response {
  return new Response(null, { status: 404, headers: DAY_1B_HEADERS });
}

// Hard byte-counter body read. Ignores Content-Length entirely; counts the
// actual bytes streamed. Returns null when the cap is exceeded; returns the
// buffered body otherwise. Catches three D-15 variants:
//   - honest Content-Length oversize
//   - missing Content-Length / chunked oversize
//   - lying Content-Length with stream that exceeds cap
async function readBodyWithCap(
  req: NextRequest,
  max: number,
): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        try {
          await reader.cancel();
        } catch {
          // intentional: cancellation failure does not change the deny path
        }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // intentional: lock-release failure does not change the deny path
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// Route-local channel-guard composition. Matches the EXACT query shape in
// lib/auth/with-channel-guard.ts:withChannelGuard — workspace SELECT then
// the single combined `!inner` channel + membership lookup with three eq
// predicates. NOT an import of withChannelGuard (the guard's deny path is
// redirect-based; the route handler needs byte-identical-404 deny). NOT a
// new export from the lib file.
type ChannelCtx = {
  user: { id: string };
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  workspace: { id: string; slug: string };
  channel: { id: string; workspace_id: string };
};

async function withRouteLocalChannelGuard(
  workspaceSlug: string,
  channelId: string,
): Promise<ChannelCtx | null> {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return null;
  }

  let user: { id: string } | null = null;
  try {
    const r = await supabase.auth.getUser();
    if (r.error || !r.data?.user) return null;
    user = { id: r.data.user.id };
  } catch {
    return null;
  }

  let workspace: { id: string; slug: string } | null = null;
  try {
    const r = await supabase
      .from("workspaces")
      .select("id, slug, name")
      .eq("slug", workspaceSlug)
      .maybeSingle();
    if (r.error || !r.data) return null;
    workspace = { id: r.data.id as string, slug: r.data.slug as string };
  } catch {
    return null;
  }

  try {
    const r = await supabase
      .from("channels")
      .select("id, workspace_id, channel_members!inner(user_id)")
      .eq("id", channelId)
      .eq("workspace_id", workspace.id)
      .eq("channel_members.user_id", user.id)
      .maybeSingle();
    if (r.error || !r.data) return null;
    const members = (r.data as { channel_members?: { user_id: string }[] })
      .channel_members;
    if (!Array.isArray(members) || members.length === 0) return null;
    return {
      user,
      supabase,
      workspace,
      channel: {
        id: r.data.id as string,
        workspace_id: r.data.workspace_id as string,
      },
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const workspaceSlug = url.searchParams.get("workspace_slug");
  const channelId = url.searchParams.get("channel_id");
  if (!workspaceSlug || !channelId) return denyResponse(); // D-11 / D-12
  if (!SLUG_RE.test(workspaceSlug)) return denyResponse(); // D-2
  if (!UUID_RE.test(channelId)) return denyResponse(); // D-1

  const ctx = await withRouteLocalChannelGuard(workspaceSlug, channelId);
  if (!ctx) return denyResponse(); // D-0 / D-3..D-7 / D-8 / D-9

  try {
    const r = await ctx.supabase
      .from("messages")
      .select("id, channel_id, user_id, body, client_nonce, created_at")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true });
    if (r.error) return denyResponse(); // D-8
    return new Response(JSON.stringify({ messages: r.data ?? [] }), {
      status: 200,
      headers: { "content-type": "application/json", ...DAY_1B_HEADERS },
    });
  } catch {
    return denyResponse(); // D-9
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  // 2g: Origin / Host BEFORE body read AND BEFORE any DB call. Route handler
  // does NOT redirect on mismatch — collapses to byte-identical 404 + {}.
  const canonical = await canonicalRedirectIfHostMismatch();
  if (canonical) return denyResponse(); // D-14 host mismatch
  if (!(await isSameOrigin())) return denyResponse(); // D-14 cross-origin

  // 2i: Content-Type BEFORE body read. Charset suffix OK (case-insensitive
  // primary type compare).
  const ct = req.headers.get("content-type") ?? "";
  const ctType = ct.split(";")[0].trim().toLowerCase();
  if (ctType !== "application/json") return denyResponse(); // D-16

  // 2h: Hard byte counter (ignores Content-Length).
  const bodyBytes = await readBodyWithCap(req, MAX_BODY_BYTES);
  if (bodyBytes === null) return denyResponse(); // D-15

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return denyResponse(); // D-10
  }
  if (!parsed || typeof parsed !== "object") return denyResponse(); // D-10

  // 2j: Strict destructure — only allowlisted fields. NO user_id read.
  const p = parsed as Record<string, unknown>;
  const workspaceSlug = p.workspace_slug;
  const channelId = p.channel_id;
  const body = p.body;
  const client_nonce = p.client_nonce;

  if (typeof workspaceSlug !== "string" || workspaceSlug.length === 0) {
    return denyResponse(); // D-11
  }
  if (typeof channelId !== "string" || channelId.length === 0) {
    return denyResponse(); // D-12
  }
  if (typeof body !== "string" || body.length === 0) {
    return denyResponse(); // D-13
  }
  if (
    client_nonce !== undefined &&
    client_nonce !== null &&
    typeof client_nonce !== "string"
  ) {
    return denyResponse(); // shape: nonce must be string|null|undefined
  }
  if (!SLUG_RE.test(workspaceSlug)) return denyResponse(); // D-2
  if (!UUID_RE.test(channelId)) return denyResponse(); // D-1

  const ctx = await withRouteLocalChannelGuard(workspaceSlug, channelId);
  if (!ctx) return denyResponse(); // D-0 / D-3..D-7 / D-8 / D-9

  try {
    const r = await ctx.supabase
      .from("messages")
      .insert({
        channel_id: channelId,
        user_id: ctx.user.id, // server-derived; client-supplied user_id ignored
        body,
        client_nonce: client_nonce ?? null,
      })
      .select("id, channel_id, user_id, body, client_nonce, created_at")
      .single();
    if (r.error || !r.data) return denyResponse(); // D-8
    return new Response(JSON.stringify({ message: r.data }), {
      status: 201,
      headers: { "content-type": "application/json", ...DAY_1B_HEADERS },
    });
  } catch {
    return denyResponse(); // D-9
  }
}

// 2o: Unsupported HTTP methods (PUT / DELETE / PATCH / OPTIONS). Byte-
// identical 404 + {} + Day-1B headers. No 405, no Allow header.
export async function PUT(): Promise<Response> {
  return denyResponse();
}
export async function DELETE(): Promise<Response> {
  return denyResponse();
}
export async function PATCH(): Promise<Response> {
  return denyResponse();
}
export async function OPTIONS(): Promise<Response> {
  return denyResponse();
}

// 2o: HEAD-specific shape. Status 404, full Day-1B headers, NO body.
export async function HEAD(): Promise<Response> {
  return headOnly404();
}
