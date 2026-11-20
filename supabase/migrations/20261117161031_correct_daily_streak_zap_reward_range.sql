-- Correct later Daily Streak ZAP rewards to the approved uniform 10–20 whole ZAP range.
CREATE OR REPLACE FUNCTION public.claim_daily_streak(p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private', 'extensions', 'pg_temp'
AS $function$
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
      -- Uniform 10..20 whole ZAP, with rejection sampling.
      loop
        v_bytes := extensions.gen_random_bytes(4);
        v_roll :=
            get_byte(v_bytes, 0)::bigint * 16777216
          + get_byte(v_bytes, 1)::bigint * 65536
          + get_byte(v_bytes, 2)::bigint * 256
          + get_byte(v_bytes, 3)::bigint;
        exit when v_roll < 4294967291;
      end loop;
      v_amount := 10 + (v_roll % 11)::integer;

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
$function$
;
