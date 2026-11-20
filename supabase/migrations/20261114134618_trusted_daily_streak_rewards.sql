-- Stage 6: trusted Daily Streak claims, UTC progression, and atomic rewards.
-- Source-only until separately approved for Preview application.
-- No player claims or balances are changed by creating this migration file.

create schema if not exists app_private;

create table app_private.player_daily_streak_state (
  player_id uuid primary key references auth.users(id) on delete cascade,
  current_streak_day integer not null default 0 check (current_streak_day between 0 and 30),
  best_streak_day integer not null default 0 check (best_streak_day between 0 and 30),
  last_claim_date date,
  cycle_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table app_private.daily_streak_claims (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete cascade,
  claim_date date not null,
  streak_day integer not null check (streak_day between 1 and 30),
  reward_type text not null check (reward_type in ('zp', 'zap', 'boost', 'mystery_box', 'temporary_agent')),
  reward_amount integer,
  reward_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(reward_metadata) = 'object'),
  claimed_at timestamptz not null default now(),
  unique (player_id, claim_date)
);

create index daily_streak_claims_player_date_idx
  on app_private.daily_streak_claims (player_id, claim_date desc);

alter table app_private.player_daily_streak_state enable row level security;
alter table app_private.daily_streak_claims enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema app_private from public, anon, authenticated, service_role;

alter table app_private.player_reward_entitlements
  drop constraint if exists player_reward_entitlements_reward_type_check;
alter table app_private.player_reward_entitlements
  add constraint player_reward_entitlements_reward_type_check
  check (reward_type in ('mystery_box', 'fragment_mining_boost', 'daily_streak_agent'));

create or replace function public.claim_daily_streak(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, extensions, pg_temp
as $function$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_yesterday date := ((now() at time zone 'utc')::date - 1);
  v_state app_private.player_daily_streak_state%rowtype;
  v_claim app_private.daily_streak_claims%rowtype;
  v_economy public.player_economy%rowtype;
  v_day integer;
  v_roll bigint;
  v_bytes bytea;
  v_amount integer;
  v_reward_type text;
  v_reward_metadata jsonb := '{}'::jsonb;
  v_balance numeric(20,0);
  v_box_roll integer;
  v_box_tier text;
  v_entitlement_id uuid;
begin
  if p_player_id is null
     or not exists (select 1 from public.players p where p.id = p_player_id)
  then
    raise exception 'Player profile not found';
  end if;

  insert into app_private.player_daily_streak_state (player_id)
  values (p_player_id)
  on conflict (player_id) do nothing;

  select * into v_state
  from app_private.player_daily_streak_state
  where player_id = p_player_id
  for update;

  if v_state.last_claim_date = v_today then
    select * into v_claim
    from app_private.daily_streak_claims
    where player_id = p_player_id and claim_date = v_today;

    return jsonb_build_object(
      'success', true, 'alreadyClaimed', true,
      'claimDate', v_claim.claim_date, 'streakDay', v_claim.streak_day,
      'rewardType', v_claim.reward_type, 'rewardAmount', v_claim.reward_amount,
      'rewardMetadata', v_claim.reward_metadata,
      'claimedAt', v_claim.claimed_at,
      'currentStreakDay', v_state.current_streak_day,
      'bestStreakDay', v_state.best_streak_day
    );
  end if;

  if v_state.last_claim_date is null
     or v_state.last_claim_date < v_yesterday
     or v_state.current_streak_day >= 30
  then
    v_day := 1;
  else
    v_day := v_state.current_streak_day + 1;
  end if;

  if v_day between 1 and 7 then
    v_reward_type := 'zp';
    v_amount := v_day * 100;

    insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
    values (p_player_id, 0, 0, 0)
    on conflict (player_id) do nothing;

    select * into v_economy
    from public.player_economy
    where player_id = p_player_id
    for update;

    v_balance := coalesce(v_economy.zp_balance, 0) + v_amount;

    update public.player_economy
    set zp_balance = v_balance,
        lifetime_zp = coalesce(lifetime_zp, 0) + v_amount,
        updated_at = now()
    where player_id = p_player_id;

    insert into public.economy_ledger
      (player_id, transaction_type, amount, balance_after, reference_id, description)
    values
      (p_player_id, 'daily_streak_reward', v_amount, v_balance,
       'daily-streak:' || v_today::text,
       'Daily Streak Day ' || v_day::text || ' reward: ' || v_amount::text || ' ZP');

    v_reward_metadata := jsonb_build_object('zpBalanceAfter', v_balance);
  else
    -- Secure unbiased draw over 10,000 integer basis-point outcomes.
    loop
      v_bytes := extensions.gen_random_bytes(4);
      v_roll :=
          get_byte(v_bytes, 0)::bigint * 16777216
        + get_byte(v_bytes, 1)::bigint * 65536
        + get_byte(v_bytes, 2)::bigint * 256
        + get_byte(v_bytes, 3)::bigint;
      exit when v_roll < 4294960000;
    end loop;
    v_roll := v_roll % 10000;

    if v_roll < 3500 then
      v_reward_type := 'zap';
      -- Uniform 1..10 whole ZAP, with rejection sampling.
      loop
        v_bytes := extensions.gen_random_bytes(4);
        v_roll :=
            get_byte(v_bytes, 0)::bigint * 16777216
          + get_byte(v_bytes, 1)::bigint * 65536
          + get_byte(v_bytes, 2)::bigint * 256
          + get_byte(v_bytes, 3)::bigint;
        exit when v_roll < 4294967290;
      end loop;
      v_amount := 1 + (v_roll % 10)::integer;

      insert into app_private.player_zap_wallets (player_id)
      values (p_player_id)
      on conflict (player_id) do nothing;

      select balance into v_balance
      from app_private.player_zap_wallets
      where player_id = p_player_id
      for update;

      v_balance := v_balance + v_amount;

      update app_private.player_zap_wallets
      set balance = v_balance,
          lifetime_earned = lifetime_earned + v_amount,
          updated_at = now()
      where player_id = p_player_id;

      insert into app_private.zap_ledger
        (player_id, entry_type, amount, balance_after, source,
         source_reference, idempotency_key, description)
      values
        (p_player_id, 'credit', v_amount, v_balance, 'daily_streak',
         v_today::text, 'daily-streak-zap:' || v_today::text,
         'Daily Streak Day ' || v_day::text || ' reward');

    elsif v_roll < 6900 then
      v_reward_type := 'boost';
      v_entitlement_id := gen_random_uuid();

      insert into app_private.player_reward_entitlements
        (id, player_id, reward_type, reward_code, source, source_reference,
         idempotency_key, metadata)
      values
        (v_entitlement_id, p_player_id, 'fragment_mining_boost',
         'fragment_mining_2x_6h', 'daily_streak', v_today::text,
         'daily-streak-boost:' || v_today::text,
         jsonb_build_object('multiplier', 2, 'duration_seconds', 21600,
           'activation_policy', 'player_activation'));

      v_reward_metadata := jsonb_build_object(
        'entitlementId', v_entitlement_id,
        'multiplier', 2, 'durationSeconds', 21600,
        'activationPolicy', 'player_activation'
      );

    elsif v_roll < 9900 then
      v_reward_type := 'mystery_box';

      loop
        v_bytes := extensions.gen_random_bytes(4);
        v_roll :=
            get_byte(v_bytes, 0)::bigint * 16777216
          + get_byte(v_bytes, 1)::bigint * 65536
          + get_byte(v_bytes, 2)::bigint * 256
          + get_byte(v_bytes, 3)::bigint;
        exit when v_roll < 4294960000;
      end loop;
      v_box_roll := (v_roll % 100)::integer;
      v_box_tier := case when v_box_roll < 80 then 'standard' else 'premium' end;

      v_reward_metadata := public.grant_mystery_box(
        p_player_id,
        v_box_tier,
        'daily_streak',
        v_today::text,
        'daily-streak-box:' || v_today::text
      );

    else
      v_reward_type := 'temporary_agent';
      v_entitlement_id := gen_random_uuid();

      insert into app_private.player_reward_entitlements
        (id, player_id, reward_type, reward_code, source, source_reference,
         idempotency_key, metadata)
      values
        (v_entitlement_id, p_player_id, 'daily_streak_agent',
         'free_agent_1_24h', 'daily_streak', v_today::text,
         'daily-streak-agent:' || v_today::text,
         jsonb_build_object('agent', 'agent_1', 'duration_seconds', 86400,
           'activation_policy', 'player_activation'));

      v_reward_metadata := jsonb_build_object(
        'entitlementId', v_entitlement_id,
        'agent', 'agent_1', 'durationSeconds', 86400,
        'activationPolicy', 'player_activation'
      );
    end if;
  end if;

  insert into app_private.daily_streak_claims
    (player_id, claim_date, streak_day, reward_type, reward_amount, reward_metadata)
  values
    (p_player_id, v_today, v_day, v_reward_type, v_amount, v_reward_metadata)
  returning * into v_claim;

  update app_private.player_daily_streak_state
  set current_streak_day = v_day,
      best_streak_day = greatest(best_streak_day, v_day),
      last_claim_date = v_today,
      cycle_completed_at = case when v_day = 30 then now() else cycle_completed_at end,
      updated_at = now()
  where player_id = p_player_id
  returning * into v_state;

  return jsonb_build_object(
    'success', true, 'alreadyClaimed', false,
    'claimId', v_claim.id, 'claimDate', v_today,
    'streakDay', v_day, 'rewardType', v_reward_type,
    'rewardAmount', v_amount, 'rewardMetadata', v_reward_metadata,
    'claimedAt', v_claim.claimed_at,
    'currentStreakDay', v_state.current_streak_day,
    'bestStreakDay', v_state.best_streak_day
  );
end;
$function$;

revoke all on function public.claim_daily_streak(uuid) from public, anon, authenticated;
grant execute on function public.claim_daily_streak(uuid) to service_role;

create or replace function public.get_daily_streak_state(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_state app_private.player_daily_streak_state%rowtype;
  v_today date := (now() at time zone 'utc')::date;
  v_claim app_private.daily_streak_claims%rowtype;
begin
  if p_player_id is null
     or not exists (select 1 from public.players p where p.id = p_player_id)
  then
    raise exception 'Player profile not found';
  end if;

  select * into v_state
  from app_private.player_daily_streak_state
  where player_id = p_player_id;

  if not found then
    return jsonb_build_object(
      'currentStreakDay', 0, 'bestStreakDay', 0,
      'lastClaimDate', null, 'claimedToday', false,
      'nextStreakDay', 1, 'claimDate', v_today
    );
  end if;

  select * into v_claim
  from app_private.daily_streak_claims
  where player_id = p_player_id and claim_date = v_today;

  return jsonb_build_object(
    'currentStreakDay', v_state.current_streak_day,
    'bestStreakDay', v_state.best_streak_day,
    'lastClaimDate', v_state.last_claim_date,
    'claimedToday', found,
    'nextStreakDay', case
      when v_state.last_claim_date is null
        or v_state.last_claim_date < v_today - 1
        or v_state.current_streak_day >= 30 then 1
      when v_state.last_claim_date = v_today then v_state.current_streak_day
      else v_state.current_streak_day + 1
    end,
    'claimDate', v_today,
    'lastRewardType', v_claim.reward_type,
    'lastRewardAmount', v_claim.reward_amount
  );
end;
$function$;

revoke all on function public.get_daily_streak_state(uuid) from public, anon, authenticated;
grant execute on function public.get_daily_streak_state(uuid) to service_role;
