-- Day 2A: channels + channel_members + messages trust substrate
-- Forward-only. Do not modify after merge.
--
-- client_nonce is Day 3 optimistic-send reconciliation only; this slice
-- adds no broader idempotency surface (nullable, no unique index).

create table public.channels (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  kind         text not null default 'private',
  created_at   timestamptz not null default now()
);

create table public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id    uuid not null references auth.users(id)      on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index channel_members_user_id_idx
  on public.channel_members (user_id);

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.channels(id) on delete cascade,
  user_id      uuid not null references auth.users(id)      on delete cascade,
  body         text not null,
  client_nonce text null,
  created_at   timestamptz not null default now()
);

create index messages_channel_id_created_at_idx
  on public.messages (channel_id, created_at desc);

-- Explicit no-op: surfaces the replica identity choice for migration review (OR-DB-1).
alter table public.messages replica identity default;

-- Defense behind RLS. Supabase's default project grants ALL on public.*
-- to authenticated; the revoke below is load-bearing because TRUNCATE
-- (included in the default ALL grant) bypasses RLS entirely.
revoke all on public.channels         from anon;
revoke all on public.channel_members  from anon;
revoke all on public.messages         from anon;

revoke all on public.channels         from authenticated;
revoke all on public.channel_members  from authenticated;
revoke all on public.messages         from authenticated;

-- PUBLIC is the pseudo-role every role inherits. Supabase defaults
-- grant nothing to PUBLIC today; these revokes are belt-and-suspenders
-- against future upstream changes that would leak to every role.
revoke all on public.channels         from public;
revoke all on public.channel_members  from public;
revoke all on public.messages         from public;

grant select         on public.channels        to authenticated;
grant select         on public.channel_members to authenticated;
grant select, insert on public.messages        to authenticated;

-- RLS on.
alter table public.channels        enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages        enable row level security;
alter table public.channels        force  row level security;
alter table public.channel_members force  row level security;
alter table public.messages        force  row level security;

-- channels SELECT: joins channel_members (not workspace_members) by design.
create policy channels_select_member_only
  on public.channels
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.channel_members cm
      where cm.channel_id = channels.id
        and cm.user_id    = auth.uid()
    )
  );

-- channel_members SELECT: each user sees only their own rows.
create policy channel_members_select_self
  on public.channel_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- messages SELECT: visible only to channel_members of the message's channel.
create policy messages_select_channel_member
  on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.channel_members cm
      where cm.channel_id = messages.channel_id
        and cm.user_id    = auth.uid()
    )
  );

-- messages INSERT: author must be auth.uid() AND a channel_members row.
create policy messages_insert_self_and_member
  on public.messages
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.channel_members cm
      where cm.channel_id = messages.channel_id
        and cm.user_id    = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies for channels or channel_members in week 1.
-- All identity-table writes go through lib/supabase/admin.ts (service role).
-- No UPDATE/DELETE policies on messages in week 1.
