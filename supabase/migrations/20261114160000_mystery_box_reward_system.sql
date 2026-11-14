-- Stage 6: secure Mystery Box inventory, versioned reward pools, and atomic opening.
-- Source-only until separately approved for Preview application.
-- No existing balances or player records are modified by this migration.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated, service_role;

create table app_private.player_zap_wallets (
  player_id uuid primary key references auth.users(id) on delete cascade,
  balance numeric(20,0) not null default 0 check (balance >= 0),
  lifetime_earned numeric(20,0) not null default 0 check (lifetime_earned >= 0),
  lifetime_spent numeric(20,0) not null default 0 check (lifetime_spent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_private.zap_ledger (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete cascade,
  entry_type text not null check (entry_type in ('credit', 'debit', 'reversal', 'admin_adjustment')),
  amount numeric(20,0) not null check (amount > 0),
  balance_after numeric(20,0) not null check (balance_after >= 0),
  source text not null,
  source_reference text not null,
  idempotency_key text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (player_id, idempotency_key)
);

create index zap_ledger_player_created_idx
  on app_private.zap_ledger (player_id, created_at desc);

create table app_private.player_reward_entitlements (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete cascade,
  reward_type text not null check (reward_type in ('mystery_box', 'fragment_mining_boost')),
  reward_code text not null,
  source text not null,
  source_reference text not null,
  idempotency_key text not null,
  status text not null default 'available'
    check (status in ('available', 'active', 'opened', 'consumed', 'expired', 'revoked')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  granted_at timestamptz not null default now(),
  activated_at timestamptz,
  expires_at timestamptz,
  consumed_at timestamptz,
  unique (player_id, idempotency_key)
);

create index player_reward_entitlements_inventory_idx
  on app_private.player_reward_entitlements (player_id, status, granted_at desc);

create table app_private.mystery_box_reward_catalog (
  pool_version integer not null check (pool_version > 0),
  box_tier text not null check (box_tier in ('standard', 'premium')),
  reward_code text not null,
  reward_type text not null check (reward_type in ('zp', 'zap', 'boost')),
  amount integer,
  weight_bps integer not null check (weight_bps between 1 and 10000),
  created_at timestamptz not null default now(),
  primary key (pool_version, box_tier, reward_code),
  check (
    (reward_type = 'zp' and amount is not null and amount between 100 and 1000 and amount % 100 = 0)
    or (reward_type = 'zap' and box_tier = 'premium' and amount is not null and amount = 0)
    or (reward_type = 'boost' and box_tier = 'premium' and amount is not null and amount = 0)
  )
);

create table app_private.mystery_box_openings (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null unique references app_private.player_reward_entitlements(id),
  player_id uuid not null references auth.users(id) on delete cascade,
  box_tier text not null check (box_tier in ('standard', 'premium')),
  pool_version integer not null,
  reward_code text not null,
  reward_type text not null check (reward_type in ('zp', 'zap', 'boost')),
  zp_amount integer,
  zap_amount integer,
  boost_entitlement_id uuid references app_private.player_reward_entitlements(id),
  zp_balance_after numeric(20,0),
  zap_balance_after numeric(20,0),
  opened_at timestamptz not null default now(),
  check (
    (reward_type = 'zp' and zp_amount is not null and zp_amount between 100 and 1000 and zap_amount is null and boost_entitlement_id is null)
    or (reward_type = 'zap' and zap_amount is not null and zap_amount between 1 and 10 and zp_amount is null and boost_entitlement_id is null)
    or (reward_type = 'boost' and zp_amount is null and zap_amount is null and boost_entitlement_id is not null)
  )
);

create index mystery_box_openings_player_opened_idx
  on app_private.mystery_box_openings (player_id, opened_at desc);

alter table app_private.player_zap_wallets enable row level security;
alter table app_private.zap_ledger enable row level security;
alter table app_private.player_reward_entitlements enable row level security;
alter table app_private.mystery_box_reward_catalog enable row level security;
alter table app_private.mystery_box_openings enable row level security;

revoke all on all tables in schema app_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema app_private from public, anon, authenticated, service_role;

-- Version 1 Standard Box: all 10 ZP prizes, no ZAP and no boost.
insert into app_private.mystery_box_reward_catalog
  (pool_version, box_tier, reward_code, reward_type, amount, weight_bps)
values
  (1, 'standard', 'zp_100',  'zp',    100, 2000),
  (1, 'standard', 'zp_200',  'zp',    200, 1800),
  (1, 'standard', 'zp_300',  'zp',    300, 1500),
  (1, 'standard', 'zp_400',  'zp',    400, 1200),
  (1, 'standard', 'zp_500',  'zp',    500, 1000),
  (1, 'standard', 'zp_600',  'zp',    600,  800),
  (1, 'standard', 'zp_700',  'zp',    700,  600),
  (1, 'standard', 'zp_800',  'zp',    800,  500),
  (1, 'standard', 'zp_900',  'zp',    900,  300),
  (1, 'standard', 'zp_1000', 'zp',   1000,  300);

-- Version 1 Premium Box: 80% ZP, 10% ZAP, 10% six-hour 2x Fragment Mining boost.
insert into app_private.mystery_box_reward_catalog
  (pool_version, box_tier, reward_code, reward_type, amount, weight_bps)
values
  (1, 'premium', 'zp_100',  'zp',    100,  200),
  (1, 'premium', 'zp_200',  'zp',    200,  300),
  (1, 'premium', 'zp_300',  'zp',    300,  400),
  (1, 'premium', 'zp_400',  'zp',    400,  500),
  (1, 'premium', 'zp_500',  'zp',    500,  600),
  (1, 'premium', 'zp_600',  'zp',    600,  800),
  (1, 'premium', 'zp_700',  'zp',    700, 1000),
  (1, 'premium', 'zp_800',  'zp',    800, 1200),
  (1, 'premium', 'zp_900',  'zp',    900, 1400),
  (1, 'premium', 'zp_1000', 'zp',   1000, 1600),
  (1, 'premium', 'zap_1_10', 'zap',   0, 1000),
  (1, 'premium', 'fragment_mining_2x_6h', 'boost', 0, 1000);

-- Fail migration construction if either published pool is not exactly 100%.
do $$
declare
  v_standard integer;
  v_premium integer;
begin
  select coalesce(sum(weight_bps), 0) into v_standard
  from app_private.mystery_box_reward_catalog
  where pool_version = 1 and box_tier = 'standard';

  select coalesce(sum(weight_bps), 0) into v_premium
  from app_private.mystery_box_reward_catalog
  where pool_version = 1 and box_tier = 'premium';

  if v_standard <> 10000 or v_premium <> 10000 then
    raise exception 'Mystery Box pool weights must each total 10000 basis points';
  end if;
end;
$$;

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
     or p_source not in ('daily_streak', 'mystery_discovery', 'expedition', 'admin_compensation')
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

create or replace function public.get_mystery_box_inventory(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_available jsonb;
  v_history jsonb;
begin
  if p_player_id is null
     or not exists (select 1 from public.players p where p.id = p_player_id)
  then
    raise exception 'Player profile not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'entitlementId', e.id,
    'boxTier', e.metadata ->> 'box_tier',
    'grantedAt', e.granted_at,
    'source', e.source
  ) order by e.granted_at desc), '[]'::jsonb)
  into v_available
  from app_private.player_reward_entitlements e
  where e.player_id = p_player_id
    and e.reward_type = 'mystery_box'
    and e.status = 'available';

  select coalesce(jsonb_agg(jsonb_build_object(
    'openingId', o.id,
    'entitlementId', o.entitlement_id,
    'boxTier', o.box_tier,
    'rewardCode', o.reward_code,
    'rewardType', o.reward_type,
    'zpAmount', o.zp_amount,
    'zapAmount', o.zap_amount,
    'openedAt', o.opened_at
  ) order by o.opened_at desc), '[]'::jsonb)
  into v_history
  from (
    select *
    from app_private.mystery_box_openings
    where player_id = p_player_id
    order by opened_at desc
    limit 50
  ) o;

  return jsonb_build_object(
    'availableBoxes', v_available,
    'recentOpenings', v_history
  );
end;
$function$;

create or replace function public.open_mystery_box(
  p_player_id uuid,
  p_entitlement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, extensions, pg_temp
as $function$
declare
  v_box app_private.player_reward_entitlements%rowtype;
  v_existing app_private.mystery_box_openings%rowtype;
  v_prize app_private.mystery_box_reward_catalog%rowtype;
  v_opening_id uuid := gen_random_uuid();
  v_boost_entitlement_id uuid;
  v_tier text;
  v_pool_version integer;
  v_bytes bytea;
  v_uint bigint;
  v_roll integer;
  v_zp_balance numeric(20,0);
  v_zap_balance numeric(20,0);
  v_reward_label text;
begin
  if p_player_id is null or p_entitlement_id is null then
    raise exception 'Player and box entitlement are required';
  end if;

  select *
    into v_box
    from app_private.player_reward_entitlements
    where id = p_entitlement_id
      and player_id = p_player_id
      and reward_type = 'mystery_box'
    for update;

  if not found then
    raise exception 'Mystery Box entitlement not found';
  end if;

  if v_box.status = 'opened' then
    select *
      into v_existing
      from app_private.mystery_box_openings
      where entitlement_id = v_box.id;

    if not found then
      raise exception 'Opened box has no recorded reward; manual review required';
    end if;

    return jsonb_build_object(
      'success', true,
      'alreadyOpened', true,
      'openingId', v_existing.id,
      'boxTier', v_existing.box_tier,
      'rewardCode', v_existing.reward_code,
      'rewardType', v_existing.reward_type,
      'zpAmount', v_existing.zp_amount,
      'zapAmount', v_existing.zap_amount,
      'zpBalanceAfter', v_existing.zp_balance_after,
      'zapBalanceAfter', v_existing.zap_balance_after,
      'boostEntitlementId', v_existing.boost_entitlement_id
    );
  end if;

  if v_box.status <> 'available' then
    raise exception 'Mystery Box is not available to open';
  end if;

  v_tier := v_box.metadata ->> 'box_tier';
  v_pool_version := coalesce((v_box.metadata ->> 'pool_version')::integer, 0);

  if v_tier is null or v_tier not in ('standard', 'premium') or v_pool_version <= 0 then
    raise exception 'Mystery Box reward configuration is invalid';
  end if;

  -- Draw an unbiased integer in [0, 9999] using pgcrypto random bytes.
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_uint :=
        get_byte(v_bytes, 0)::bigint * 16777216
      + get_byte(v_bytes, 1)::bigint * 65536
      + get_byte(v_bytes, 2)::bigint * 256
      + get_byte(v_bytes, 3)::bigint;
    exit when v_uint < 4294960000;
  end loop;
  v_roll := (v_uint % 10000)::integer;

  select
      c.pool_version, c.box_tier, c.reward_code, c.reward_type,
      c.amount, c.weight_bps, c.created_at
    into v_prize
    from (
      select catalog.*,
        sum(catalog.weight_bps) over (
          order by catalog.reward_code
          rows between unbounded preceding and current row
        ) as cumulative_weight
      from app_private.mystery_box_reward_catalog catalog
      where catalog.pool_version = v_pool_version
        and catalog.box_tier = v_tier
    ) c
    where c.cumulative_weight > v_roll
    order by c.reward_code
    limit 1;

  if not found then
    raise exception 'Mystery Box reward pool is missing or invalid';
  end if;

  if v_prize.reward_type = 'zp' then
    insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
    values (p_player_id, 0, 0, 0)
    on conflict (player_id) do nothing;

    select coalesce(pe.zp_balance, 0)
      into v_zp_balance
      from public.player_economy pe
      where pe.player_id = p_player_id
      for update;

    v_zp_balance := v_zp_balance + v_prize.amount;

    update public.player_economy
      set zp_balance = v_zp_balance,
          lifetime_zp = coalesce(lifetime_zp, 0) + v_prize.amount,
          updated_at = now()
      where player_id = p_player_id;

    insert into public.economy_ledger (
      player_id, transaction_type, amount, balance_after, reference_id, description
    )
    values (
      p_player_id,
      'mystery_box_reward',
      v_prize.amount,
      v_zp_balance,
      'mystery-box:' || v_box.id::text,
      'Mystery Box ' || v_tier || ' reward: ' || v_prize.amount::text || ' ZP'
    );
  elsif v_prize.reward_type = 'zap' then
    -- The only ZAP prize in pool version 1 is Premium's approved 10% outcome.
    insert into app_private.player_zap_wallets (player_id)
    values (p_player_id)
    on conflict (player_id) do nothing;

    select w.balance
      into v_zap_balance
      from app_private.player_zap_wallets w
      where w.player_id = p_player_id
      for update;

    -- Draw a uniform whole-number ZAP amount from 1 through 10.
    -- Rejection sampling avoids modulo bias.
    loop
      v_bytes := extensions.gen_random_bytes(4);
      v_uint :=
          get_byte(v_bytes, 0)::bigint * 16777216
        + get_byte(v_bytes, 1)::bigint * 65536
        + get_byte(v_bytes, 2)::bigint * 256
        + get_byte(v_bytes, 3)::bigint;
      exit when v_uint < 4294967290;
    end loop;
    v_prize.amount := 1 + (v_uint % 10)::integer;
    v_zap_balance := v_zap_balance + v_prize.amount;

    update app_private.player_zap_wallets
      set balance = v_zap_balance,
          lifetime_earned = lifetime_earned + v_prize.amount,
          updated_at = now()
      where player_id = p_player_id;

    insert into app_private.zap_ledger (
      player_id, entry_type, amount, balance_after, source,
      source_reference, idempotency_key, description
    )
    values (
      p_player_id, 'credit', v_prize.amount, v_zap_balance,
      'mystery_box', v_box.id::text, 'mystery-box-zap:' || v_box.id::text,
      'Premium Mystery Box ZAP prize'
    );
  elsif v_prize.reward_type = 'boost' then
    v_boost_entitlement_id := gen_random_uuid();

    insert into app_private.player_reward_entitlements (
      id, player_id, reward_type, reward_code, source, source_reference,
      idempotency_key, metadata
    )
    values (
      v_boost_entitlement_id,
      p_player_id,
      'fragment_mining_boost',
      'fragment_mining_2x_6h',
      'mystery_box',
      v_opening_id::text,
      'mystery-box-boost:' || v_box.id::text,
      jsonb_build_object(
        'multiplier', 2,
        'duration_seconds', 21600,
        'activation_policy', 'player_activation',
        'pool_version', v_pool_version
      )
    );
  else
    raise exception 'Unsupported Mystery Box reward type';
  end if;

  update app_private.player_reward_entitlements
    set status = 'opened',
        consumed_at = now()
    where id = v_box.id;

  insert into app_private.mystery_box_openings (
    id, entitlement_id, player_id, box_tier, pool_version,
    reward_code, reward_type, zp_amount, zap_amount,
    boost_entitlement_id, zp_balance_after, zap_balance_after
  )
  values (
    v_opening_id, v_box.id, p_player_id, v_tier, v_pool_version,
    v_prize.reward_code, v_prize.reward_type,
    case when v_prize.reward_type = 'zp' then v_prize.amount end,
    case when v_prize.reward_type = 'zap' then v_prize.amount end,
    v_boost_entitlement_id, v_zp_balance, v_zap_balance
  );

  v_reward_label := case
    when v_prize.reward_type = 'zp' then v_prize.amount::text || ' ZP'
    when v_prize.reward_type = 'zap' then v_prize.amount::text || ' ZAP'
    else '2× Fragment Mining boost (6 hours after activation)'
  end;

  return jsonb_build_object(
    'success', true,
    'alreadyOpened', false,
    'openingId', v_opening_id,
    'boxTier', v_tier,
    'rewardCode', v_prize.reward_code,
    'rewardType', v_prize.reward_type,
    'rewardLabel', v_reward_label,
    'zpAmount', case when v_prize.reward_type = 'zp' then v_prize.amount end,
    'zapAmount', case when v_prize.reward_type = 'zap' then v_prize.amount end,
    'zpBalanceAfter', v_zp_balance,
    'zapBalanceAfter', v_zap_balance,
    'boostEntitlementId', v_boost_entitlement_id
  );
end;
$function$;

revoke all on function public.grant_mystery_box(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_mystery_box_inventory(uuid) from public, anon, authenticated;
revoke all on function public.open_mystery_box(uuid, uuid) from public, anon, authenticated;

grant execute on function public.grant_mystery_box(uuid, text, text, text, text) to service_role;
grant execute on function public.get_mystery_box_inventory(uuid) to service_role;
grant execute on function public.open_mystery_box(uuid, uuid) to service_role;
