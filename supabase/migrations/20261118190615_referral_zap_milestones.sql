-- Cumulative, server-verified referral milestones paid in ZAP.
-- Each threshold is claimable once; rewards are additional to referral kickbacks.

create table if not exists app_private.referral_milestone_claims (
  player_id uuid not null references public.players(id) on delete cascade,
  referral_threshold integer not null check (referral_threshold in (3, 10, 25)),
  reward_zap bigint not null check (reward_zap > 0),
  claimed_at timestamptz not null default now(),
  primary key (player_id, referral_threshold)
);

revoke all on table app_private.referral_milestone_claims from public, anon, authenticated;

create or replace function public.get_player_referral_milestones(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_count integer;
  v_milestones jsonb;
begin
  if p_player_id is null or not exists (
    select 1 from public.players where id = p_player_id
  ) then
    raise exception 'Player account was not found';
  end if;

  select count(distinct recruit_id)::integer
    into v_count
  from public.referral_sub_nodes
  where referrer_id = p_player_id
    and recruit_id is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'threshold', m.threshold,
    'rewardZap', m.reward_zap,
    'reached', v_count >= m.threshold,
    'claimedAt', c.claimed_at
  ) order by m.threshold), '[]'::jsonb)
  into v_milestones
  from (values (3, 10::bigint), (10, 20::bigint), (25, 50::bigint))
    as m(threshold, reward_zap)
  left join app_private.referral_milestone_claims c
    on c.player_id = p_player_id
   and c.referral_threshold = m.threshold;

  return jsonb_build_object(
    'referralCount', v_count,
    'milestones', v_milestones
  );
end;
$function$;

create or replace function public.claim_player_referral_milestone(
  p_player_id uuid,
  p_referral_threshold integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_count integer;
  v_reward bigint;
  v_claimed_at timestamptz;
  v_credit jsonb;
  v_wallet jsonb;
begin
  if p_player_id is null then
    raise exception 'Player account is required';
  end if;

  perform 1
  from public.players
  where id = p_player_id
  for update;
  if not found then
    raise exception 'Player account was not found';
  end if;

  v_reward := case p_referral_threshold
    when 3 then 10
    when 10 then 20
    when 25 then 50
    else null
  end;
  if v_reward is null then
    raise exception 'Unknown referral milestone';
  end if;

  select count(distinct recruit_id)::integer
    into v_count
  from public.referral_sub_nodes
  where referrer_id = p_player_id
    and recruit_id is not null;

  if v_count < p_referral_threshold then
    raise exception 'Referral milestone has not been reached';
  end if;

  select claimed_at into v_claimed_at
  from app_private.referral_milestone_claims
  where player_id = p_player_id
    and referral_threshold = p_referral_threshold;

  if found then
    v_wallet := public.get_player_zap_wallet(p_player_id);
    return jsonb_build_object(
      'success', true,
      'alreadyClaimed', true,
      'threshold', p_referral_threshold,
      'rewardZap', v_reward,
      'referralCount', v_count,
      'claimedAt', v_claimed_at,
      'wallet', v_wallet
    );
  end if;

  v_credit := public.apply_player_zap_ledger_entry(
    p_player_id,
    'credit',
    v_reward,
    'referral_milestone',
    'referral-milestone:' || p_referral_threshold::text,
    'referral-milestone:' || p_player_id::text || ':' || p_referral_threshold::text,
    'Referral milestone reward: ' || p_referral_threshold::text || ' verified referrals'
  );

  insert into app_private.referral_milestone_claims (
    player_id, referral_threshold, reward_zap
  ) values (
    p_player_id, p_referral_threshold, v_reward
  )
  returning claimed_at into v_claimed_at;

  v_wallet := public.get_player_zap_wallet(p_player_id);
  return jsonb_build_object(
    'success', true,
    'alreadyClaimed', false,
    'threshold', p_referral_threshold,
    'rewardZap', v_reward,
    'referralCount', v_count,
    'claimedAt', v_claimed_at,
    'ledgerEntry', v_credit,
    'wallet', v_wallet
  );
end;
$function$;

revoke all on function public.get_player_referral_milestones(uuid) from public, anon, authenticated;
revoke all on function public.claim_player_referral_milestone(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_player_referral_milestones(uuid) to service_role;
grant execute on function public.claim_player_referral_milestone(uuid, integer) to service_role;
