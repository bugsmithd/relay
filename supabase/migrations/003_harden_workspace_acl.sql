-- Day 2A Phase 2.5 Blocker 3: harden workspaces + workspace_members ACL.
-- Forward-only. Do not modify after merge.
--
-- 001_workspace_identity.sql (committed) revoked broad privileges from anon
-- only. Supabase's default project grants ALL on public.* to authenticated,
-- so the live catalog exposes UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER to
-- authenticated on both workspace tables. TRUNCATE bypasses RLS entirely
-- (any authenticated user could DROP every row regardless of policy), which
-- makes this a defense-in-depth failure with a real attack surface.
--
-- 002_channels_and_messages.sql already closes the same hole on
-- channels / channel_members / messages. 003 closes it on
-- workspaces / workspace_members.

revoke all on public.workspaces        from authenticated;
revoke all on public.workspaces        from public;
revoke all on public.workspace_members from authenticated;
revoke all on public.workspace_members from public;

grant select on public.workspaces        to authenticated;
grant select on public.workspace_members to authenticated;

-- No policy changes. 001's SELECT policies on both tables are correct;
-- this migration adjusts SQL-level grants only. No new tables, no new
-- policies, no SECURITY DEFINER, no replica identity change.
