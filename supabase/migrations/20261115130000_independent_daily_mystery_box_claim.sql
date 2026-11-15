-- Independent daily Mystery Box claim and repeat-opening eligibility.
-- The free box is separate from Daily Streak. Paid/ad repeat openings use
-- their own shared 2-hour cooldown. Ads remain disabled until AdsGram verifies them.

create table app_private.player_daily_mystery_box_state (
  player_id uuid primary key references auth.users(id) on delete cascade,
  last_claim_at timestamptz,
  entitlement_id uuid references app_private.player_reward_entitlements(id),
  updated_at timestamptz not null default now()
);

alter table app_private.player_daily_mystery_box_state enable row level security;
revoke all on app_private.player_daily_mystery_box_state from public, anon, authenticated, service_role;

create or replace function public.grant_mystery_box(
  p_player_id uuid,
  p_box_tier text,
  p_source text,
  p_source_reference text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, extensions, pg_temp
as $function$
declare
  v_entitlement app_private.player_reward_entitlements%rowtype;
  v_tier text := lower(btrim(p_box_tier));
begin
  if p_player_id is null
     or v_tier is null
     or v_tier not in ('standard', 'premium')
     or p_source is null
     or p_source not in ('daily_streak', 'daily_mystery_box', 'mystery_discovery', 'expedition', 'admin_compensation')
     or nullif(btrim(p_source_reference), '') is null
     or nullif(btrim(p_idempotency_key), '') is null
     or length(p_idempotency_key) > 200
  then
    raise exception 'Invalid Mystery Box grant request';
  end if;

  if not exists (select 1 from public.players p where p.id = p_player_id) then
    raise exception 'Player profile not found';
  end if;

  insert into app_private.player_reward_entitlements (
    player_id, reward_type, reward_code, source, source_reference,
    idempotency_key, metadata
  )
  values (
    p_player_id, 'mystery_box', v_tier || '_mystery_box', p_source,
    p_source_reference, p_idempotency_key,
    jsonb_build_object('box_tier', v_tier, 'pool_version', 1)
  )
  on conflict (player_id, idempotency_key) do nothing
  returning * into v_entitlement;

  if not found then
    select *
      into v_entitlement
      from app_private.player_reward_entitlements
      where player_id = p_player_id
        and idempotency_key = p_idempotency_key;

    if v_entitlement.reward_type <> 'mystery_box'
       or v_entitlement.reward_code <> (v_tier || '_mystery_box')
       or v_entitlement.source <> p_source
       or v_entitlement.source_reference <> p_source_reference
    then
      raise exception 'Idempotency key was already used for a different reward';
    end if;

    return jsonb_build_object(
      'success', true,
      'alreadyGranted', true,
      'entitlementId', v_entitlement.id,
      'boxTier', v_tier,
      'status', v_entitlement.status
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'alreadyGranted', false,
    'entitlementId', v_entitlement.id,
    'boxTier', v_tier,
    'status', v_entitlement.status
  );
end;
$function$;

create or replace function public.claim_daily_mystery_box(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, extensions, pg_temp
as $function$
declare
  v_state app_private.player_daily_mystery_box_state%rowtype;
  v_now timestamptz := now();
  v_bytes bytea;
  v_uint bigint;
  v_roll integer;
  v_tier text;
  v_grant jsonb;
  v_next_claim_at timestamptz;
  v_claim_reference text;
begin
  if p_player_id is null
     or not exists (select 1 from public.players p where p.id = p_player_id)
  then
    raise exception 'Player profile not found';
  end if;

  insert into app_private.player_daily_mystery_box_state (player_id)
  values (p_player_id)
  on conflict (player_id) do nothing;

  select *
    into v_state
    from app_private.player_daily_mystery_box_state
    where player_id = p_player_id
    for update;

  if v_state.last_claim_at is not null
     and v_state.last_claim_at + interval '24 hours' > v_now
  then
    v_next_claim_at := v_state.last_claim_at + interval '24 hours';
    return jsonb_build_object(
      'success', true,
      'alreadyClaimed', true,
      'entitlementId', v_state.entitlement_id,
      'freeClaimAvailable', false,
      'nextFreeClaimAt', v_next_claim_at
    );
  end if;

  -- Uniform 80/20 Standard/Premium tier draw, matching repeat-box odds.
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_uint :=
        get_byte(v_bytes, 0)::bigint * 16777216
      + get_byte(v_bytes, 1)::bigint * 65536
      + get_byte(v_bytes, 2)::bigint * 256
      + get_byte(v_bytes, 3)::bigint;
    exit when v_uint < 4294967200;
  end loop;
  v_roll := (v_uint % 100)::integer;
  v_tier := case when v_roll < 80 then 'standard' else 'premium' end;

  v_claim_reference := 'daily-mystery-box:' || p_player_id::text || ':' ||
    floor(extract(epoch from v_now) * 1000)::bigint::text;

  v_grant := public.grant_mystery_box(
    p_player_id,
    v_tier,
    'daily_mystery_box',
    v_claim_reference,
    v_claim_reference
  );

  v_next_claim_at := v_now + interval '24 hours';

  update app_private.player_daily_mystery_box_state
    set last_claim_at = v_now,
        entitlement_id = (v_grant->>'entitlementId')::uuid,
        updated_at = v_now
    where player_id = p_player_id;

  return jsonb_build_object(
    'success', true,
    'alreadyClaimed', false,
    'entitlementId', v_grant->>'entitlementId',
    'boxTier', v_tier,
    'freeClaimAvailable', false,
    'nextFreeClaimAt', v_next_claim_at
  );
end;
$function$;

create or replace function public.get_mystery_box_repeat_state(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_cooldown_until timestamptz;
  v_zp_balance numeric(20,0);
  v_last_free_claim_at timestamptz;
  v_next_free_claim_at timestamptz;
begin
  if p_player_id is null
     or not exists (select 1 from public.players p where p.id = p_player_id)
  then
    raise exception 'Player profile not found';
  end if;

  select s.cooldown_until
    into v_cooldown_until
    from app_private.player_repeat_mystery_box_state s
    where s.player_id = p_player_id;

  select coalesce(e.zp_balance, 0)
    into v_zp_balance
    from public.player_economy e
    where e.player_id = p_player_id;

  select s.last_claim_at
    into v_last_free_claim_at
    from app_private.player_daily_mystery_box_state s
    where s.player_id = p_player_id;

  v_next_free_claim_at := case
    when v_last_free_claim_at is null then null
    else v_last_free_claim_at + interval '24 hours'
  end;

  return jsonb_build_object(
    'freeClaimAvailable', v_next_free_claim_at is null or v_next_free_claim_at <= now(),
    'lastFreeClaimAt', v_last_free_claim_at,
    'nextFreeClaimAt', v_next_free_claim_at,
    'cooldownUntil', v_cooldown_until,
    'zpBalance', coalesce(v_zp_balance, 0),
    'costZp', 500,
    'cooldownSeconds', 7200,
    'standardChance', 80,
    'premiumChance', 20,
    'adsEnabled', false
  );
end;
$function$;

create or replace function public.open_repeat_mystery_box(
  p_player_id uuid,
  p_method text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, extensions, pg_temp
as $function$
declare
  v_state app_private.player_repeat_mystery_box_state%rowtype;
  v_existing app_private.repeat_mystery_box_requests%rowtype;
  v_economy public.player_economy%rowtype;
  v_entitlement_id uuid := gen_random_uuid();
  v_tier text;
  v_bytes bytea;
  v_uint bigint;
  v_roll integer;
  v_balance_after_cost numeric(20,0);
  v_cooldown_until timestamptz;
  v_result jsonb;
begin
  if p_player_id is null
     or p_request_id is null
     or p_method is null
     or p_method not in ('zp', 'ad')
     or not exists (select 1 from public.players p where p.id = p_player_id)
  then
    raise exception 'Invalid repeat Mystery Box request';
  end if;

  if p_method = 'ad' then
    return jsonb_build_object(
      'success', false,
      'code', 'adsgram_not_configured',
      'message', 'Rewarded ads are not enabled yet. AdsGram verification will be added later.'
    );
  end if;

  insert into app_private.player_repeat_mystery_box_state (player_id)
  values (p_player_id)
  on conflict (player_id) do nothing;

  select *
    into v_state
    from app_private.player_repeat_mystery_box_state
    where player_id = p_player_id
    for update;

  select *
    into v_existing
    from app_private.repeat_mystery_box_requests
    where player_id = p_player_id
      and request_id = p_request_id;

  if found then
    return v_existing.result;
  end if;

  if v_state.cooldown_until is not null and v_state.cooldown_until > now() then
    return jsonb_build_object(
      'success', false,
      'code', 'cooldown_active',
      'cooldownUntil', v_state.cooldown_until,
      'message', 'A Mystery Box was opened recently. Please wait for the shared 2-hour cooldown.'
    );
  end if;

  insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
  values (p_player_id, 0, 0, 0)
  on conflict (player_id) do nothing;

  select *
    into v_economy
    from public.player_economy
    where player_id = p_player_id
    for update;

  if coalesce(v_economy.zp_balance, 0) < 500 then
    return jsonb_build_object(
      'success', false,
      'code', 'insufficient_zp',
      'zpBalance', coalesce(v_economy.zp_balance, 0),
      'costZp', 500,
      'message', 'You need at least 500 ZP to open a repeat Mystery Box.'
    );
  end if;

  v_balance_after_cost := v_economy.zp_balance - 500;

  update public.player_economy
    set zp_balance = v_balance_after_cost,
        updated_at = now()
    where player_id = p_player_id;

  insert into public.economy_ledger (
    player_id, transaction_type, amount, balance_after, reference_id, description
  )
  values (
    p_player_id,
    'mystery_box_repeat_purchase',
    -500,
    v_balance_after_cost,
    'repeat-mystery-box:' || p_request_id::text,
    'Repeat Mystery Box opening fee'
  );

  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_uint :=
        get_byte(v_bytes, 0)::bigint * 16777216
      + get_byte(v_bytes, 1)::bigint * 65536
      + get_byte(v_bytes, 2)::bigint * 256
      + get_byte(v_bytes, 3)::bigint;
    exit when v_uint < 4294967200;
  end loop;
  v_roll := (v_uint % 100)::integer;
  v_tier := case when v_roll < 80 then 'standard' else 'premium' end;

  insert into app_private.player_reward_entitlements (
    id, player_id, reward_type, reward_code, source, source_reference,
    idempotency_key, metadata
  )
  values (
    v_entitlement_id,
    p_player_id,
    'mystery_box',
    v_tier || '_mystery_box',
    'repeat_purchase',
    p_request_id::text,
    'repeat-box:' || p_request_id::text,
    jsonb_build_object('box_tier', v_tier, 'pool_version', 1, 'paid_with', 'zp')
  );

  v_result := public.open_mystery_box(p_player_id, v_entitlement_id);
  v_cooldown_until := now() + interval '2 hours';

  v_result := v_result || jsonb_build_object(
    'repeatPurchase', true,
    'costZp', 500,
    'zpBalanceAfterCost', v_balance_after_cost,
    'cooldownUntil', v_cooldown_until,
    'tierChance', jsonb_build_object('standard', 80, 'premium', 20)
  );

  update app_private.player_repeat_mystery_box_state
    set cooldown_until = v_cooldown_until,
        updated_at = now()
    where player_id = p_player_id;

  insert into app_private.repeat_mystery_box_requests (
    player_id, request_id, method, result
  )
  values (p_player_id, p_request_id, p_method, v_result);

  return v_result;
end;
$function$;

revoke all on function public.claim_daily_mystery_box(uuid) from public, anon, authenticated;
revoke all on function public.get_mystery_box_repeat_state(uuid) from public, anon, authenticated;
revoke all on function public.open_repeat_mystery_box(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_daily_mystery_box(uuid) to service_role;
grant execute on function public.get_mystery_box_repeat_state(uuid) to service_role;
grant execute on function public.open_repeat_mystery_box(uuid, text, uuid) to service_role;
