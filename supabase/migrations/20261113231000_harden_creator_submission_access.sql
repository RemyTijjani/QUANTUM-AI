-- Creator Ops submissions must not be directly writable by client roles.
-- Also remove legacy broad anon/authenticated policies left by the original
-- single-tenant table setup. Players may read only their own submissions;
-- inserts happen through submit_creator_ops_submission (SECURITY DEFINER),
-- while admin review uses privileged server-side functions.

alter table public.creator_ops_submissions enable row level security;

revoke all privileges on table public.creator_ops_submissions
  from public, anon, authenticated;

grant select on table public.creator_ops_submissions to authenticated;
grant select, insert, update, delete on table public.creator_ops_submissions to service_role;

-- Remove every existing policy on this table so an old permissive policy
-- cannot accidentally widen access after grants are tightened.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'creator_ops_submissions'
  loop
    execute format(
      'drop policy if exists %I on public.creator_ops_submissions',
      policy_row.policyname
    );
  end loop;
end;
$$;

create policy creator_ops_submissions_select_own
  on public.creator_ops_submissions
  for select
  to authenticated
  using (player_id = auth.uid());

comment on table public.creator_ops_submissions is
  'Client users may read only their own submissions. New submissions must use submit_creator_ops_submission; administrative review is server-side only.';
