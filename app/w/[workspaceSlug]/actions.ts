"use server";

// Phase 4 — sendMessageAction.
//
// Signature: sendMessageAction(workspaceSlug, formData). workspaceSlug is
// server-bound via .bind(null, workspaceSlug) from page.tsx — it MUST NOT
// come from form-data, URL query, headers, or any other client-controllable
// source. The action does NOT call formData.get("workspace_slug") and does
// NOT call formData.get("user_id") (strict allowlist: channel_id, body,
// optional client_nonce).
//
// Route-vs-action divergence: this action denies via redirect (matching
// app/login/actions.ts precedent for Server Actions). The companion route
// handler at app/api/messages/route.ts denies via byte-identical 404 + {}.
// The divergence is intentional and noted in the slice contract §"Security
// Invariants".
//
// Origin / Host helpers are reproduced as route-local copies from the
// app/login/actions.ts precedent (slice contract 3c). DO NOT import from
// app/login/actions.ts.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { withChannelGuard } from "@/lib/auth/with-channel-guard";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function logDeny(reason: string, extra: Record<string, unknown> = {}) {
  console.warn(
    JSON.stringify({ component: "send-message-action", reason, ...extra }),
  );
}

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

async function canonicalRedirectIfHostMismatch(
  path: string,
): Promise<string | null> {
  const h = await headers();
  const host = h.get("host");
  const env = process.env.SITE_ORIGIN;
  if (!env) return null;
  let canonicalUrl: URL;
  let canonicalHost: string;
  try {
    canonicalUrl = new URL(path, env);
    canonicalHost = canonicalUrl.host;
  } catch {
    return null;
  }
  if (host && host === canonicalHost) return null;
  return canonicalUrl.toString();
}

export async function sendMessageAction(
  workspaceSlug: string,
  formData: FormData,
): Promise<void> {
  // 3c: Origin / Host BEFORE any DB call AND BEFORE consuming form-data.
  const canonical = await canonicalRedirectIfHostMismatch(
    `/w/${workspaceSlug}`,
  );
  if (canonical) {
    const h = await headers();
    logDeny("host-mismatch", { host: h.get("host") });
    redirect(canonical);
  }
  if (!(await isSameOrigin())) {
    logDeny("cross-origin");
    redirect("/login?error=origin");
  }

  // 3d: Strict form-data allowlist. NO formData.get("workspace_slug") /
  // NO formData.get("user_id") / NO formData.entries() iteration.
  const rawChannelId = formData.get("channel_id");
  const rawBody = formData.get("body");
  const rawNonce = formData.get("client_nonce");

  const channelId = typeof rawChannelId === "string" ? rawChannelId : "";
  const body = typeof rawBody === "string" ? rawBody : "";
  const clientNonce =
    typeof rawNonce === "string" && rawNonce.length > 0 ? rawNonce : null;

  // 3e: Generic denial URL on shape failure. Redirect to workspace root
  // keeps the response surface uniform (no info leak).
  if (!UUID_RE.test(channelId) || body.length === 0) {
    logDeny("shape-rejected");
    redirect(`/w/${workspaceSlug}`);
  }

  // 3f: Thread through the existing channel guard. Its deny semantics are
  // redirect("/") — consistent with the Server Action surface.
  await withChannelGuard(workspaceSlug, channelId, async (ctx) => {
    // 3g: Insert with server-derived user_id. client-supplied user_id is
    // not read from form-data (allowlist above).
    const r = await ctx.supabase
      .from("messages")
      .insert({
        channel_id: channelId,
        user_id: ctx.user.id,
        body,
        client_nonce: clientNonce,
      })
      .select("id")
      .single();
    if (r.error) {
      logDeny("db-error", { code: r.error.code ?? null });
      redirect(`/w/${workspaceSlug}`);
    }
  });

  // 3g: On success — return void. Redirect back to workspace so the page
  // re-renders the message list. (Next 16 Server Actions need a redirect or
  // revalidate to refresh the calling page; redirect is the simplest path.)
  redirect(`/w/${workspaceSlug}?channel_id=${channelId}`);
}
