-- Admin operations: player announcements, trusted global mining controls,
-- and a safe PostgREST schema-cache refresh.
create table if not exists public.zord_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 4000),
  in_app_enabled boolean not null default true,
  telegram_enabled boolean not null default false,
  telegram_sent integer not null default 0 check (telegram_sent >= 0),
  telegram_failed integer not null default 0 check (telegram_failed >= 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists zord_announcements_active_idx
  on public.zord_announcements (created_at desc)
  where in_app_enabled = true;
alter table public.zord_announcements enable row level security;
revoke all on public.zord_announcements from public, anon, authenticated;
grant select on public.zord_announcements to authenticated;
create policy "Authenticated players can read active in-app announcements"
  on public.zord_announcements for select to authenticated
  using (in_app_enabled = true and (expires_at is null or expires_at > now()));

create table if not exists public.global_gameplay_settings (
  id text primary key check (id = 'global'),
  fragment_mining_enabled boolean not null default true,
  fragment_mining_rate_multiplier numeric(5,2) not null default 1.00
    check (fragment_mining_rate_multiplier between 0.10 and 5.00),
  paused_at timestamptz,
  updated_by text not null default 'system',
  updated_at timestamptz not null default now()
);
insert into public.global_gameplay_settings (id)
values ('global')
on conflict (id) do nothing;
alter table public.global_gameplay_settings enable row level security;
revoke all on public.global_gameplay_settings from public, anon, authenticated;
grant select, insert, update on public.global_gameplay_settings to service_role;

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
  v_enabled boolean := true;
  v_rate_multiplier numeric := 1.00;
begin
  select fragment_mining_enabled, fragment_mining_rate_multiplier
    into v_enabled, v_rate_multiplier
  from public.global_gameplay_settings
  where id = 'global';

  if not coalesce(v_enabled, true) then
    return 0;
  end if;

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
    if v_end <= v_start then continue; end if;

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

    v_fragment_ranges := tstzmultirange(tstzrange(v_start, v_end, '[)')) - v_agent_ranges;

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
      into v_active_seconds from unnest(v_fragment_ranges) as r;
    select coalesce(sum(extract(epoch from upper(r) - lower(r))), 0)
      into v_boosted_seconds from unnest(v_boosted_ranges) as r;

    v_amount := round((v_active_seconds + v_boosted_seconds) * 0.02 * coalesce(v_rate_multiplier, 1.00), 2);

    if v_amount > 0 then
      insert into public.fragment_mining_accruals (
        player_id, fragment_id, mining_started_at, earned_at, amount, release_at
      ) values (
        v_state.player_id, v_state.fragment_id, v_state.mining_started_at,
        v_end, v_amount, v_end + interval '6 hours'
      )
      on conflict (player_id, fragment_id, mining_started_at, earned_at) do nothing;
      v_rows := v_rows + 1;
    end if;

    update public.player_fragment_gameplay_state
    set mining_accrued_until = v_end, updated_at = clock_timestamp()
    where player_id = v_state.player_id and fragment_id = v_state.fragment_id;
  end loop;
  return v_rows;
end;
$function$;

revoke all on function public.accrue_fragment_mining_pending_zp(uuid) from public, anon, authenticated;
grant execute on function public.accrue_fragment_mining_pending_zp(uuid) to service_role;

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
  v_mining_enabled boolean := true;
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
    return jsonb_build_object('success', true, 'duplicate', true,
      'actionEventId', v_event.id, 'fragmentId', v_event.fragment_id, 'createdAt', v_event.created_at);
  end if;

  select fragment_mining_enabled into v_mining_enabled
  from public.global_gameplay_settings where id = 'global';
  if not coalesce(v_mining_enabled, true) then
    return jsonb_build_object('success', false, 'reason', 'global_mining_paused');
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
    return jsonb_build_object('success', true, 'duplicate', true,
      'actionEventId', v_event.id, 'fragmentId', v_event.fragment_id, 'createdAt', v_event.created_at);
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

  insert into public.gameplay_action_events (player_id, action_type, fragment_id, request_id)
  values (p_player_id, 'fragment_fixed', p_fragment_id, p_request_id)
  returning * into v_event;

  return jsonb_build_object('success', true, 'duplicate', false,
    'actionEventId', v_event.id, 'fragmentId', v_event.fragment_id,
    'createdAt', v_event.created_at,
    'cooldownUntil', v_now + interval '4 hours',
    'coreMiningUntil', v_now + interval '4 hours');
end;
$function$;

revoke all on function public.fix_fragment_trusted(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.fix_fragment_trusted(uuid, text, uuid) to service_role;

create or replace function public.admin_get_global_gameplay_settings()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
  select jsonb_build_object(
    'success', true,
    'fragmentMiningEnabled', fragment_mining_enabled,
    'fragmentMiningRateMultiplier', fragment_mining_rate_multiplier,
    'pausedAt', paused_at,
    'updatedBy', updated_by,
    'updatedAt', updated_at
  )
  from public.global_gameplay_settings where id = 'global';
$function$;

create or replace function public.admin_set_global_gameplay_settings(
  p_enabled boolean,
  p_rate_multiplier numeric,
  p_admin_username text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_current public.global_gameplay_settings%rowtype;
  v_now timestamptz := clock_timestamp();
  v_pause_duration interval;
begin
  if p_enabled is null or p_rate_multiplier is null
     or p_rate_multiplier < 0.10 or p_rate_multiplier > 5.00
     or round(p_rate_multiplier, 2) <> p_rate_multiplier
     or p_admin_username is null or length(trim(p_admin_username)) = 0 then
    raise exception 'Invalid global gameplay settings';
  end if;

  select * into v_current
  from public.global_gameplay_settings where id = 'global'
  for update;

  if v_current.fragment_mining_enabled
     and (not p_enabled or p_rate_multiplier <> v_current.fragment_mining_rate_multiplier) then
    perform public.accrue_fragment_mining_pending_zp(null);
  end if;

  if not v_current.fragment_mining_enabled and p_enabled then
    if v_current.paused_at is null then
      raise exception 'Mining pause timestamp is missing; cannot safely resume';
    end if;
    v_pause_duration := greatest(interval '0 seconds', v_now - v_current.paused_at);
    update public.player_fragment_gameplay_state
    set mining_accrued_until = mining_accrued_until + v_pause_duration,
        core_mining_until = core_mining_until + v_pause_duration,
        cooldown_until = case when cooldown_until is null then null else cooldown_until + v_pause_duration end,
        updated_at = v_now
    where status = 'fixed'
      and mining_started_at is not null
      and mining_accrued_until is not null;
  end if;

  update public.global_gameplay_settings
  set fragment_mining_enabled = p_enabled,
      fragment_mining_rate_multiplier = p_rate_multiplier,
      paused_at = case when p_enabled then null when v_current.fragment_mining_enabled then v_now else v_current.paused_at end,
      updated_by = trim(p_admin_username),
      updated_at = v_now
  where id = 'global';

  return public.admin_get_global_gameplay_settings();
end;
$function$;

create or replace function public.admin_flush_api_schema_cache()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  perform pg_notify('pgrst', 'reload schema');
  return jsonb_build_object('success', true, 'flushedAt', clock_timestamp(),
    'scope', 'PostgREST API schema cache');
end;
$function$;

revoke all on function public.admin_get_global_gameplay_settings() from public, anon, authenticated;
revoke all on function public.admin_set_global_gameplay_settings(boolean, numeric, text) from public, anon, authenticated;
revoke all on function public.admin_flush_api_schema_cache() from public, anon, authenticated;
grant execute on function public.admin_get_global_gameplay_settings() to service_role;
grant execute on function public.admin_set_global_gameplay_settings(boolean, numeric, text) to service_role;
grant execute on function public.admin_flush_api_schema_cache() to service_role;
