import { redirect } from "next/navigation";
import {
  withWorkspaceGuard,
  type WorkspaceContext,
} from "@/lib/auth/with-workspace-guard";

export type ChannelContext = WorkspaceContext & {
  channel: {
    id: string;
    name: string;
    kind: string;
    workspace_id: string;
  };
};

// Canonical lowercase-hex UUID shape. Rejected channelIds collapse to the
// unified-deny branch (§A.1 + §A.5) before the channel DB lookup. The
// workspace DB lookup precedes this via withWorkspaceGuard composition
// (§A.2); an invalid channelId never reaches the channel/channel_members
// query at lines 107-113.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Safe diagnostic logger. Same shape and JSON-line discipline as
// lib/auth/with-workspace-guard.ts. Never logs JWT, cookie value, email,
// channel name, channel kind, or raw Supabase error fields
// (message / details / hint / row contents). Code is PostgREST/Postgres
// error code on the db-error path; null on the unified-deny path.
function logDeny(
  reason: string,
  ctx: { slug: string; channelId: string; userId: string; code?: string | null },
  level: "warn" | "error" = "warn",
) {
  const safe = {
    component: "with-channel-guard",
    reason,
    slug: ctx.slug,
    channel_id: ctx.channelId,
    user_id: ctx.userId,
    code: ctx.code ?? null,
  };
  const line = JSON.stringify(safe);
  if (level === "error") console.error(line);
  else console.warn(line);
}

// Single unified-deny exit. All four sub-conditions of §A.5 collapse here:
//   - UUID-shape regex fails
//   - channel does not exist
//   - channel exists but channels.workspace_id !== workspace.id
//   - channel exists in correct workspace but user is not a channel_members row
// Same console.warn-level log line, same redirect("/") target. The redirect
// returns `never`, so callers narrow naturally after this call.
function unifiedDeny(
  slug: string,
  channelId: string,
  userId: string,
): never {
  logDeny("not-found-or-not-bound-or-not-member", { slug, channelId, userId });
  return redirect("/");
}

// Alert-class DB/RLS error path. Same redirect target as unified deny —
// distinguishable only in the log stream (reason + level). The PostgREST
// error.code is the only non-fixed field; never include message / details /
// hint / row contents.
function dbErrorDeny(
  slug: string,
  channelId: string,
  userId: string,
  code: string | null,
): never {
  logDeny(
    "db-error",
    { slug, channelId, userId, code },
    "error",
  );
  return redirect("/");
}

export async function withChannelGuard<T>(
  workspaceSlug: string,
  channelId: string,
  fn: (ctx: ChannelContext) => Promise<T>,
): Promise<T> {
  return withWorkspaceGuard(workspaceSlug, async (workspaceCtx) => {
    const slug = workspaceCtx.workspace.slug;
    const userId = workspaceCtx.user.id;

    // §A.1: pre-DB UUID-shape rejection. Invalid shapes never reach Postgres.
    if (!UUID_RE.test(channelId)) {
      unifiedDeny(slug, channelId, userId);
    }

    // §A.4: single combined user-scoped lookup binding all three predicates:
    //   - channels.id = channelId
    //   - channels.workspace_id = workspace.id
    //   - channel_members(channel_id = channelId AND user_id = user.id) exists
    // The !inner is load-bearing: with default left-join semantics a
    // non-matching channel_members row would leave the channels row intact
    // and the guard would false-pass on membership.
    //
    // §A.8: the supabase-js call is wrapped to convert any thrown rejection
    // (network failure, etc.) into the db-error path with code: null. We
    // wrap ONLY the await on the supabase-js builder so that downstream
    // redirect() calls (which throw a Next.js control-flow sentinel) are
    // never accidentally caught.
    let lookup;
    try {
      lookup = await workspaceCtx.supabase
        .from("channels")
        .select("id, name, kind, workspace_id, channel_members!inner(user_id)")
        .eq("id", channelId)
        .eq("workspace_id", workspaceCtx.workspace.id)
        .eq("channel_members.user_id", userId)
        .maybeSingle();
    } catch {
      // dbErrorDeny is `: never` and unwinds via redirect; control does not
      // reach past this catch.
      dbErrorDeny(slug, channelId, userId, null);
    }

    // §A.6: distinct db-error path. Same redirect target as unified deny.
    if (lookup.error) {
      dbErrorDeny(slug, channelId, userId, lookup.error.code ?? null);
    }

    // §A.5 (unknown channel / foreign workspace / non-member): all three
    // converge here because the !inner + workspace_id + id predicates either
    // all match (data populated) or the row is filtered out (data === null).
    if (!lookup.data) {
      unifiedDeny(slug, channelId, userId);
    }

    // Defense-in-depth (§A.4 Choice-2 fallback): if PostgREST does not honor
    // the !inner filter pushdown for some reason and returns the channel row
    // with an empty channel_members array, collapse to the unified deny.
    // §C Block 6 of the contract verifies !inner against the live stack;
    // this branch is unreachable in practice but cheap to keep.
    const members = (
      lookup.data as { channel_members?: { user_id: string }[] }
    ).channel_members;
    if (!Array.isArray(members) || members.length === 0) {
      unifiedDeny(slug, channelId, userId);
    }

    // Flat channel context — strip the embedded membership array (present
    // only for the inner-join semantics, not for downstream consumption).
    const channel = {
      id: lookup.data.id as string,
      name: lookup.data.name as string,
      kind: lookup.data.kind as string,
      workspace_id: lookup.data.workspace_id as string,
    };
    return fn({ ...workspaceCtx, channel });
  });
}
