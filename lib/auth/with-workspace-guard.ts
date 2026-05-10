import { redirect } from "next/navigation";
import { withSession, type SessionContext } from "@/lib/auth/with-session";

export type WorkspaceContext = SessionContext & {
  workspace: { id: string; slug: string; name: string };
};

const SLUG_RE = /^[a-z0-9-]+$/;

// Safe diagnostic logger. Never logs secrets, JWTs, code/token_hash, emails, or
// raw Supabase error payloads (which can echo back row contents). Always logs
// to stderr via console.warn (Next propagates to its server logger).
function logDeny(
  reason: string,
  ctx: { slug: string; userId: string; code?: string },
  level: "warn" | "error" = "warn",
) {
  const safe = {
    component: "with-workspace-guard",
    reason,
    slug: ctx.slug,
    user_id: ctx.userId,
    code: ctx.code ?? null,
  };
  const line = JSON.stringify(safe);
  if (level === "error") console.error(line);
  else console.warn(line);
}

export async function withWorkspaceGuard<T>(
  workspaceSlug: string,
  fn: (ctx: WorkspaceContext) => Promise<T>,
): Promise<T> {
  if (!SLUG_RE.test(workspaceSlug)) {
    // Pre-DB rejection. Send to root rather than leaking 404-vs-403 distinction.
    redirect("/");
  }
  return withSession(async ({ user, supabase }) => {
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, slug, name")
      .eq("slug", workspaceSlug)
      .maybeSingle();

    if (error) {
      // RLS / DB errors fail closed. Log a structured diagnostic with only the
      // PostgREST error code (e.g. "PGRST116", "42501") — no message, no detail.
      // DB / RLS errors are alert-class — not the same as a non-member visit.
      logDeny(
        "db-error",
        { slug: workspaceSlug, userId: user.id, code: error.code },
        "error",
      );
      redirect("/");
    }
    if (!data) {
      // Either does not exist or user not a member. Same response surface.
      // Per Day 1A plan stop-condition #19: "non-member requesting /w/<other-slug>
      // gets 403/redirect". Redirect to root keeps the response shape uniform
      // (no info leak about workspace existence) and avoids relying on
      // notFound() which renders the framework 404 page (could leak chrome).
      logDeny("not-found-or-not-member", {
        slug: workspaceSlug,
        userId: user.id,
      });
      redirect("/");
    }
    return fn({ user, supabase, workspace: data });
  });
}
