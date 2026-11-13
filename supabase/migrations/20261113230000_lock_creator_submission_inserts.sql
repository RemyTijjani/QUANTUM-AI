-- Creator Ops submissions must be created through the authenticated SECURITY DEFINER RPC.
-- Direct table INSERT would let a player choose status='approved' and reviewed_at,
-- bypassing admin review and forging event evidence.
revoke insert on table public.creator_ops_submissions
  from public, anon, authenticated;

drop policy if exists "insert_own_submissions"
  on public.creator_ops_submissions;

-- Keep players able to read only their own submissions. The submit RPC remains
-- executable by authenticated and inserts as its postgres function owner.
grant select on table public.creator_ops_submissions to authenticated;
grant select, insert, update, delete on table public.creator_ops_submissions to service_role;

comment on table public.creator_ops_submissions is
  'Creator Ops submissions are inserted through submit_creator_ops_submission; clients cannot directly insert or review submissions.';
