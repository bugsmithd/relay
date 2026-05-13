// Phase 4 — workspace page with composer.
//
// Channel-selection strategy (slice contract 4b):
//   1. Query channels in THIS workspace where the user is a channel_members
//      row. Single user-scoped query: channels.workspace_id = workspace.id
//      AND channel_members.user_id = auth.uid() via !inner. workspace.id
//      correlation is load-bearing — a query that joins only channel_members
//      without workspace_id correlation would surface cross-workspace
//      channels and is forbidden.
//   2. If ?channel_id=<uuid> is on the URL AND matches one of the membership
//      rows, use it.
//   3. Else fall back to the first membership row (deterministic order by
//      created_at ascending).
//   4. If zero membership rows: empty state, NO composer rendered.
//
// The composer is rendered through the withChannelGuard composition (per
// slice contract 4 — "Continues to render through withWorkspaceGuard →
// withChannelGuard composition"). withChannelGuard internally re-runs the
// workspace + session lookups; the duplicate round-trip is acceptable for
// Phase 4 (and is the same composition pattern Phase 3 locked in).
import { withWorkspaceGuard } from "@/lib/auth/with-workspace-guard";
import { withChannelGuard } from "@/lib/auth/with-channel-guard";
import { signOutAction } from "@/app/login/actions";
import { sendMessageAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ChannelRow = {
  id: string;
  name: string;
  kind: string;
};

async function ChannelView(props: {
  workspaceSlug: string;
  channelId: string;
}) {
  return withChannelGuard(
    props.workspaceSlug,
    props.channelId,
    async ({ supabase, channel }) => {
      const msgR = await supabase
        .from("messages")
        .select("id, body, user_id, created_at")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: true });
      const messages = msgR.error ? [] : (msgR.data ?? []);
      return (
        <section>
          <h2>{channel.name}</h2>
          <ul>
            {messages.map((m) => (
              <li key={m.id as string}>{m.body as string}</li>
            ))}
          </ul>
          {/* Mandatory composer (slice contract 4c). Action is server-bound
              with workspaceSlug; the form has channel_id (hidden) + body
              (text). NO workspace_slug input; NO user_id input. */}
          <form action={sendMessageAction.bind(null, props.workspaceSlug)}>
            <input type="hidden" name="channel_id" value={channel.id} />
            <input type="text" name="body" required />
            <button type="submit">Send</button>
          </form>
        </section>
      );
    },
  );
}

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ channel_id?: string | string[] }>;
}) {
  const { workspaceSlug } = await params;
  const sp = await searchParams;
  const rawChannelParam = Array.isArray(sp.channel_id)
    ? sp.channel_id[0]
    : sp.channel_id;

  return withWorkspaceGuard(
    workspaceSlug,
    async ({ user, workspace, supabase }) => {
      const channelsR = await supabase
        .from("channels")
        .select("id, name, kind, channel_members!inner(user_id)")
        .eq("workspace_id", workspace.id)
        .eq("channel_members.user_id", user.id)
        .order("created_at", { ascending: true });

      const memberships: ChannelRow[] = channelsR.error
        ? []
        : ((channelsR.data ?? []).map((c) => ({
            id: c.id as string,
            name: c.name as string,
            kind: c.kind as string,
          })) as ChannelRow[]);

      let selectedChannelId: string | null = null;
      if (
        typeof rawChannelParam === "string" &&
        UUID_RE.test(rawChannelParam) &&
        memberships.some((c) => c.id === rawChannelParam)
      ) {
        selectedChannelId = rawChannelParam;
      } else if (memberships.length > 0) {
        selectedChannelId = memberships[0].id;
      }

      return (
        <main>
          <h1>{workspace.name}</h1>
          <p>Signed in as {user.email}</p>
          <form action={signOutAction}>
            <button type="submit">Sign out</button>
          </form>
          {selectedChannelId === null ? (
            <section>
              <p>No channels yet</p>
            </section>
          ) : (
            <ChannelView
              workspaceSlug={workspaceSlug}
              channelId={selectedChannelId}
            />
          )}
        </main>
      );
    },
  );
}
