-- Repeatable Mystery Box openings: 500 ZP, one shared 2-hour cooldown.
-- Requires today's Daily Streak claim before repeat openings are unlocked.
-- AdsGram remains disabled until provider-side verification is implemented.

create table app_private.player_repeat_mystery_box_state (
  player_id uuid primary key references auth.users(id) on delete cascade,
  cooldown_until timestamptz,
  updated_at timestamptz not null default now()
);

create table app_private.repeat_mystery_box_requests (
  player_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  method text not null check (method in ('zp', 'ad')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (player_id, request_id)
);

alter table app_private.player_repeat_mystery_box_state enable row level security;
alter table app_private.repeat_mystery_box_requests enable row level security;
revoke all on app_private.player_repeat_mystery_box_state from public, anon, authenticated, service_role;
revoke all on app_private.repeat_mystery_box_requests from public, anon, authenticated, service_role;

create or replace function public.get_mystery_box_repeat_state(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_cooldown_until timestamptz;
  v_zp_balance numeric(20,0);
  v_daily_claimed boolean;
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

  select exists (
    select 1
    from app_private.daily_streak_claims c
    where c.player_id = p_player_id
      and c.claim_date = (now() at time zone 'utc')::date
  ) into v_daily_claimed;

  return jsonb_build_object(
    'dailyClaimedToday', coalesce(v_daily_claimed, false),
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

  if not exists (
    select 1
    from app_private.daily_streak_claims c
    where c.player_id = p_player_id
      and c.claim_date = (now() at time zone 'utc')::date
  ) then
    return jsonb_build_object(
      'success', false,
      'code', 'daily_claim_required',
      'message', 'Claim today’s Daily Streak reward before opening a repeat box.'
    );
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

  -- Uniform 80/20 tier draw using rejection sampling.
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

  -- This existing trusted RPC chooses and grants the prize inside this same
  -- database transaction. Any failure rolls back the fee and cooldown too.
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

revoke all on function public.get_mystery_box_repeat_state(uuid) from public, anon, authenticated;
revoke all on function public.open_repeat_mystery_box(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.get_mystery_box_repeat_state(uuid) to service_role;
grant execute on function public.open_repeat_mystery_box(uuid, text, uuid) to service_role;
