import { notFound, redirect } from "next/navigation";
import { withSession, type SessionContext } from "@/lib/auth/with-session";

export type WorkspaceContext = SessionContext & {
  workspace: { id: string; slug: string; name: string };
};

const SLUG_RE = /^[a-z0-9-]+$/;

// Safe diagnostic logger. Never logs secrets, JWTs, code/token_hash, emails, or
// raw Supabase error payloads (which can echo back row contents). Always logs
// to stderr so structured-log shippers can pick it up.
function logDeny(reason: string, ctx: { slug: string; userId: string; code?: string }) {
  const safe = {
    component: "with-workspace-guard",
    reason,
    slug: ctx.slug,
    user_id: ctx.userId,
    code: ctx.code ?? null,
  };
  console.warn(JSON.stringify(safe));
}

export async function withWorkspaceGuard<T>(
  workspaceSlug: string,
  fn: (ctx: WorkspaceContext) => Promise<T>,
): Promise<T> {
  if (!SLUG_RE.test(workspaceSlug)) {
    notFound();
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
      logDeny("db-error", {
        slug: workspaceSlug,
        userId: user.id,
        code: error.code,
      });
      redirect("/");
    }
    if (!data) {
      // Either does not exist or user not a member. Same response surface, but
      // log the deny so we can detect probing in aggregate.
      logDeny("not-found-or-not-member", {
        slug: workspaceSlug,
        userId: user.id,
      });
      notFound();
    }
    return fn({ user, supabase, workspace: data });
  });
}
