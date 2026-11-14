-- Keep referral-sub-node history readable only by the authenticated referrer/recruit.
-- Referral attribution is established by the trusted telegram-auth Edge Function;
-- clients must never insert, reassign, edit, or delete referral relationships.

alter table public.referral_sub_nodes enable row level security;

revoke all on table public.referral_sub_nodes
  from public, anon, authenticated;

grant select on table public.referral_sub_nodes to authenticated;

drop policy if exists "anon_select_referrals" on public.referral_sub_nodes;
drop policy if exists "anon_insert_referrals" on public.referral_sub_nodes;
drop policy if exists "anon_update_referrals" on public.referral_sub_nodes;
drop policy if exists "anon_delete_referrals" on public.referral_sub_nodes;

drop policy if exists "insert_own_referrals" on public.referral_sub_nodes;
drop policy if exists "update_synced_own_referrals" on public.referral_sub_nodes;

-- Recreate the intended read scope explicitly. No client write policies exist.
drop policy if exists "select_own_referrals" on public.referral_sub_nodes;
create policy "select_own_referrals"
  on public.referral_sub_nodes
  for select
  to authenticated
  using (recruit_id = auth.uid() or referrer_id = auth.uid());

-- Service-role access remains server-only for trusted backend operations.
grant select, insert, update, delete on table public.referral_sub_nodes
  to service_role;
