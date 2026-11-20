-- Stage 6: trusted, once-per-UTC-day Daily Uplink claim.
-- Source-only until separately approved for Preview application.
-- The reward amount is read from the published mission record; no amount or
-- claim date is accepted from the client.

create table if not exists public.daily_uplink_claims (
  player_id uuid not null references auth.users(id) on delete cascade,
  claim_date date not null,
  reward_zp numeric not null check (reward_zp > 0),
  claimed_at timestamptz not null default now(),
  primary key (player_id, claim_date)
);

create index if not exists daily_uplink_claims_player_date_idx
  on public.daily_uplink_claims (player_id, claim_date desc);

alter table public.daily_uplink_claims enable row level security;
revoke all on public.daily_uplink_claims from public, anon, authenticated;
grant select on public.daily_uplink_claims to service_role;

create or replace function public.claim_daily_uplink(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_claim_date date := (now() at time zone 'utc')::date;
  v_reward numeric;
  v_claim public.daily_uplink_claims%rowtype;
  v_economy public.player_economy%rowtype;
  v_balance numeric;
begin
  if p_player_id is null then
    raise exception 'Player identity is required';
  end if;

  -- Only the published, zero-cost ZP mission controls the claim amount.
  select mt.reward::numeric
    into v_reward
    from public.mission_tasks mt
    where mt.id = 'daily-uplink'
      and mt.kind = 'daily'
      and mt.status = 'published'
      and mt.reward_currency = 'ZP'
      and mt.unlock_cost_zp = 0;

  if not found or v_reward is null or v_reward <= 0 then
    raise exception 'Daily Uplink is not currently claimable';
  end if;

  -- Ensure and lock the player's authoritative balance row before recording
  -- the claim. All following writes commit or roll back together.
  insert into public.player_economy (
    player_id, zp_balance, lifetime_zp, pending_kickback
  ) values (p_player_id, 0, 0, 0)
  on conflict (player_id) do nothing;

  select *
    into v_economy
    from public.player_economy
    where player_id = p_player_id
    for update;

  if not found then
    raise exception 'Player economy record could not be loaded';
  end if;

  insert into public.daily_uplink_claims (player_id, claim_date, reward_zp)
  values (p_player_id, v_claim_date, v_reward)
  on conflict (player_id, claim_date) do nothing
  returning * into v_claim;

  if not found then
    select *
      into v_claim
      from public.daily_uplink_claims
      where player_id = p_player_id
        and claim_date = v_claim_date;

    return jsonb_build_object(
      'success', true,
      'alreadyClaimed', true,
      'claimDate', v_claim.claim_date,
      'claimedAt', v_claim.claimed_at,
      'rewardZp', v_claim.reward_zp,
      'balanceAfter', v_economy.zp_balance
    );
  end if;

  v_balance := coalesce(v_economy.zp_balance, 0) + v_reward;

  update public.player_economy
    set zp_balance = v_balance,
        lifetime_zp = coalesce(lifetime_zp, 0) + v_reward,
        updated_at = now()
    where player_id = p_player_id;

  insert into public.economy_ledger (
    player_id, transaction_type, amount, balance_after, reference_id, description
  ) values (
    p_player_id,
    'daily_mission_reward',
    v_reward,
    v_balance,
    'daily-uplink:' || v_claim_date::text,
    'Daily Uplink reward for ' || v_claim_date::text
  );

  return jsonb_build_object(
    'success', true,
    'alreadyClaimed', false,
    'claimDate', v_claim.claim_date,
    'claimedAt', v_claim.claimed_at,
    'rewardZp', v_reward,
    'balanceAfter', v_balance
  );
end;
$$;

revoke all on function public.claim_daily_uplink(uuid) from public, anon, authenticated;
grant execute on function public.claim_daily_uplink(uuid) to service_role;
