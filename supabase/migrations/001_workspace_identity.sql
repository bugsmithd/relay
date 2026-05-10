-- Day 1A: workspaces + workspace_members trust substrate
-- Forward-only. Do not modify after merge.

create extension if not exists citext;

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  slug        citext not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id)        on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx
  on public.workspace_members (user_id);

-- Defense behind RLS.
revoke all on public.workspaces        from anon;
revoke all on public.workspace_members from anon;

-- RLS on.
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspaces        force  row level security;
alter table public.workspace_members force  row level security;

-- workspaces SELECT: visible only if requester is a member.
create policy workspaces_select_member_only
  on public.workspaces
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id      = auth.uid()
    )
  );

-- workspace_members SELECT: each user sees only their own membership rows.
create policy workspace_members_select_self
  on public.workspace_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies for week 1.
-- All identity-table writes go through lib/supabase/admin.ts (service role).
