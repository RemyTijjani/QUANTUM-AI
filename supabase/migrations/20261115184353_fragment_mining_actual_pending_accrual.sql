-- Replace fixed 288-ZP grants with server-timed mining accrual.
-- Each accrual interval is held for six hours from its server-recorded earned_at.
alter table public.player_fragment_gameplay_state
  add column if not exists mining_started_at timestamptz,
  add column if not exists mining_accrued_until timestamptz;

-- Existing mining sessions are not backfilled. If a fragment is currently
-- online, begin trusted accrual from this migration time for its remaining window.
update public.player_fragment_gameplay_state
set mining_started_at = now(),
    mining_accrued_until = now()
where status = 'fixed'
  and core_mining_until > now()
  and mining_accrued_until is null;

create table if not exists public.fragment_mining_accruals (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  fragment_id text not null check (fragment_id in ('top', 'bottom', 'left', 'right')),
  mining_started_at timestamptz not null,
  earned_at timestamptz not null,
  amount numeric(18,2) not null check (amount > 0),
  release_at timestamptz not null,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  unique (player_id, fragment_id, mining_started_at, earned_at),
  check (release_at = earned_at + interval '6 hours')
);

create index if not exists fragment_mining_accruals_due_idx
  on public.fragment_mining_accruals (release_at, player_id)
  where credited_at is null;

create index if not exists fragment_mining_accruals_player_pending_idx
  on public.fragment_mining_accruals (player_id, release_at)
  where credited_at is null;

alter table public.fragment_mining_accruals enable row level security;
revoke all on public.fragment_mining_accruals from public, anon, authenticated;
grant select on public.fragment_mining_accruals to service_role;

-- The old trigger awarded the full four-hour maximum immediately on fixing.
-- Remove it so only elapsed server time can create new pending ZP.
drop trigger if exists enqueue_fragment_mining_reward_after_fix
  on public.gameplay_action_events;

create or replace function public.fix_fragment_trusted(
  p_player_id uuid,
  p_fragment_id text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_state public.player_fragment_gameplay_state%rowtype;
  v_event public.gameplay_action_events%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_fragment_id is null
     or p_fragment_id not in ('top', 'bottom', 'left', 'right')
     or p_request_id is null then
    raise exception 'Invalid fragment action';
  end if;

  select * into v_event
  from public.gameplay_action_events
  where player_id = p_player_id and request_id = p_request_id;

  if found then
    if v_event.fragment_id <> p_fragment_id then
      return jsonb_build_object('success', false, 'reason', 'request_id_conflict');
    end if;
    return jsonb_build_object(
      'success', true, 'duplicate', true,
      'actionEventId', v_event.id, 'fragmentId', v_event.fragment_id,
      'createdAt', v_event.created_at
    );
  end if;

  insert into public.player_fragment_gameplay_state (player_id, fragment_id)
  values (p_player_id, p_fragment_id)
  on conflict (player_id, fragment_id) do nothing;

  select * into v_state
  from public.player_fragment_gameplay_state
  where player_id = p_player_id and fragment_id = p_fragment_id
  for update;

  select * into v_event
  from public.gameplay_action_events
  where player_id = p_player_id and request_id = p_request_id;

  if found then
    if v_event.fragment_id <> p_fragment_id then
      return jsonb_build_object('success', false, 'reason', 'request_id_conflict');
    end if;
    return jsonb_build_object(
      'success', true, 'duplicate', true,
      'actionEventId', v_event.id, 'fragmentId', v_event.fragment_id,
      'createdAt', v_event.created_at
    );
  end if;

  if v_state.status <> 'unlocked' then
    return jsonb_build_object('success', false, 'reason', 'fragment_not_unlocked');
  end if;

  update public.player_fragment_gameplay_state
  set status = 'fixed',
      cooldown_until = v_now + interval '4 hours',
      core_mining_until = v_now + interval '4 hours',
      mining_started_at = v_now,
      mining_accrued_until = v_now,
      updated_at = v_now
  where player_id = p_player_id and fragment_id = p_fragment_id;

  insert into public.gameplay_action_events (
    player_id, action_type, fragment_id, request_id
  ) values (
    p_player_id, 'fragment_fixed', p_fragment_id, p_request_id
  )
  returning * into v_event;

  return jsonb_build_object(
    'success', true, 'duplicate', false,
    'actionEventId', v_event.id, 'fragmentId', v_event.fragment_id,
    'createdAt', v_event.created_at,
    'cooldownUntil', v_now + interval '4 hours',
    'coreMiningUntil', v_now + interval '4 hours'
  );
end;
$function$;

revoke all on function public.fix_fragment_trusted(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.fix_fragment_trusted(uuid, text, uuid) to service_role;

-- Accrue only elapsed time measured by PostgreSQL. Active agent rentals suppress
-- Fragment mining exactly as the game rules do. Active 2x Fragment boosts add
-- one extra base-rate share for the portion of time they overlap.
create or replace function public.accrue_fragment_mining_pending_zp(p_player_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_state public.player_fragment_gameplay_state%rowtype;
  v_end timestamptz;
  v_start timestamptz;
  v_agent_ranges tstzmultirange;
  v_boost_ranges tstzmultirange;
  v_fragment_ranges tstzmultirange;
  v_boosted_ranges tstzmultirange;
  v_active_seconds numeric;
  v_boosted_seconds numeric;
  v_amount numeric(18,2);
  v_rows integer := 0;
begin
  for v_state in
    select *
    from public.player_fragment_gameplay_state
    where status = 'fixed'
      and mining_started_at is not null
      and mining_accrued_until is not null
      and core_mining_until > mining_accrued_until
      and (p_player_id is null or player_id = p_player_id)
    order by player_id, fragment_id
    for update
  loop
    v_start := v_state.mining_accrued_until;
    v_end := least(clock_timestamp(), v_state.core_mining_until);

    if v_end <= v_start then
      continue;
    end if;

    select coalesce(
      range_agg(tstzrange(greatest(starts_at, v_start), least(expires_at, v_end), '[)')),
      '{}'::tstzmultirange
    )
    into v_agent_ranges
    from public.player_agent_rentals
    where player_id = v_state.player_id
      and status = 'active'
      and starts_at < v_end
      and expires_at > v_start;

    v_fragment_ranges :=
      tstzmultirange(tstzrange(v_start, v_end, '[)')) - v_agent_ranges;

    select coalesce(
      range_agg(tstzrange(greatest(activated_at, v_start), least(expires_at, v_end), '[)')),
      '{}'::tstzmultirange
    )
    into v_boost_ranges
    from app_private.player_reward_entitlements
    where player_id = v_state.player_id
      and reward_type = 'fragment_mining_boost'
      and reward_code = 'fragment_mining_2x_6h'
      and status = 'active'
      and activated_at is not null
      and expires_at > v_start
      and activated_at < v_end;

    v_boosted_ranges := v_fragment_ranges * v_boost_ranges;

    select coalesce(sum(extract(epoch from upper(r) - lower(r))), 0)
    into v_active_seconds
    from unnest(v_fragment_ranges) as r;

    select coalesce(sum(extract(epoch from upper(r) - lower(r))), 0)
    into v_boosted_seconds
    from unnest(v_boosted_ranges) as r;

    v_amount := round((v_active_seconds + v_boosted_seconds) * 0.02, 2);

    if v_amount > 0 then
      insert into public.fragment_mining_accruals (
        player_id, fragment_id, mining_started_at, earned_at,
        amount, release_at
      ) values (
        v_state.player_id, v_state.fragment_id, v_state.mining_started_at,
        v_end, v_amount, v_end + interval '6 hours'
      )
      on conflict (player_id, fragment_id, mining_started_at, earned_at)
      do nothing;
      v_rows := v_rows + 1;
    end if;

    update public.player_fragment_gameplay_state
    set mining_accrued_until = v_end,
        updated_at = clock_timestamp()
    where player_id = v_state.player_id
      and fragment_id = v_state.fragment_id;
  end loop;

  return v_rows;
end;
$function$;

revoke all on function public.accrue_fragment_mining_pending_zp(uuid) from public, anon, authenticated;
grant execute on function public.accrue_fragment_mining_pending_zp(uuid) to service_role;

create or replace function public.release_fragment_mining_accruals(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_reward public.fragment_mining_accruals%rowtype;
  v_balance numeric(18,2);
  v_count integer := 0;
  v_total numeric(18,2) := 0;
begin
  if p_player_id is null then
    raise exception 'Player ID is required';
  end if;

  insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
  values (p_player_id, 0, 0, 0)
  on conflict (player_id) do nothing;

  perform 1 from public.player_economy
  where player_id = p_player_id
  for update;

  for v_reward in
    select *
    from public.fragment_mining_accruals
    where player_id = p_player_id
      and credited_at is null
      and release_at <= clock_timestamp()
    order by release_at, id
    for update
  loop
    update public.player_economy
    set zp_balance = coalesce(zp_balance, 0) + v_reward.amount,
        lifetime_zp = coalesce(lifetime_zp, 0) + v_reward.amount,
        updated_at = clock_timestamp()
    where player_id = p_player_id
    returning zp_balance into v_balance;

    insert into public.economy_ledger (
      player_id, transaction_type, amount, balance_after, reference_id, description
    ) values (
      p_player_id, 'fragment_mining_reward', v_reward.amount, v_balance,
      v_reward.id::text,
      'Verified ZP from ' || upper(v_reward.fragment_id) || ' Fragment mining (six-hour hold completed)'
    );

    update public.fragment_mining_accruals
    set credited_at = clock_timestamp()
    where id = v_reward.id and credited_at is null;

    v_count := v_count + 1;
    v_total := v_total + v_reward.amount;
  end loop;

  return jsonb_build_object('success', true, 'creditedCount', v_count, 'creditedAmount', v_total);
end;
$function$;

revoke all on function public.release_fragment_mining_accruals(uuid) from public, anon, authenticated;
grant execute on function public.release_fragment_mining_accruals(uuid) to service_role;

create or replace function public.release_all_matured_fragment_zp()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_player_id uuid;
  v_players_processed integer := 0;
begin
  perform public.accrue_fragment_mining_pending_zp(null);

  for v_player_id in
    select distinct player_id
    from public.fragment_mining_accruals
    where credited_at is null
      and release_at <= clock_timestamp()
    order by player_id
  loop
    perform public.release_fragment_mining_accruals(v_player_id);
    v_players_processed := v_players_processed + 1;
  end loop;

  -- Retain compatibility with any legacy, already-created Fragment rewards.
  for v_player_id in
    select distinct player_id
    from public.fragment_mining_rewards
    where credited_at is null
      and release_at <= clock_timestamp()
    order by player_id
  loop
    perform public.release_matured_fragment_zp(v_player_id);
    v_players_processed := v_players_processed + 1;
  end loop;

  return v_players_processed;
end;
$function$;

revoke all on function public.release_all_matured_fragment_zp() from public, anon, authenticated, service_role;
