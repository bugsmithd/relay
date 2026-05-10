import { withWorkspaceGuard } from "@/lib/auth/with-workspace-guard";
import { signOutAction } from "@/app/login/actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return withWorkspaceGuard(workspaceSlug, async ({ user, workspace }) => (
    <main>
      <h1>{workspace.name}</h1>
      <p>Signed in as {user.email}</p>
      <form action={signOutAction}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  ));
}
