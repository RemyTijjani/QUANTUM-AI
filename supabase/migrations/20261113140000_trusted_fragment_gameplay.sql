-- Stage 5: server-owned fragment state and immutable gameplay evidence.
-- This does not trust player_game_states.game_state, which remains client-writable.
create table if not exists public.player_fragment_gameplay_state (
  player_id uuid not null references public.players(id) on delete cascade,
  fragment_id text not null check (fragment_id in ('top', 'bottom', 'left', 'right')),
  status text not null default 'locked'
    check (status in ('locked', 'unlocked', 'fixed')),
  cooldown_until timestamptz,
  core_mining_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, fragment_id)
);

create table if not exists public.fragment_unlock_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  fragment_id text not null check (fragment_id in ('top', 'bottom', 'left', 'right')),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'expired', 'cancelled')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  completed_at timestamptz
);

create index if not exists fragment_unlock_sessions_player_idx
  on public.fragment_unlock_sessions (player_id, fragment_id, started_at desc);

create table if not exists public.gameplay_action_events (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  action_type text not null check (action_type in ('fragment_fixed')),
  fragment_id text not null check (fragment_id in ('top', 'bottom', 'left', 'right')),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (player_id, request_id)
);

create index if not exists gameplay_action_events_player_action_idx
  on public.gameplay_action_events (player_id, action_type, created_at desc);

alter table public.player_fragment_gameplay_state enable row level security;
alter table public.fragment_unlock_sessions enable row level security;
alter table public.gameplay_action_events enable row level security;

revoke all on public.player_fragment_gameplay_state from anon, authenticated;
revoke all on public.fragment_unlock_sessions from anon, authenticated;
revoke all on public.gameplay_action_events from anon, authenticated;

grant select, insert, update on public.player_fragment_gameplay_state to service_role;
grant select, insert, update on public.fragment_unlock_sessions to service_role;
grant select, insert on public.gameplay_action_events to service_role;

-- Create a server-timed unlock session. The player identity is resolved by the
-- authenticated Edge Function and passed only through service_role.
create or replace function public.begin_fragment_unlock(
  p_player_id uuid,
  p_fragment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_state public.player_fragment_gameplay_state%rowtype;
  v_session public.fragment_unlock_sessions%rowtype;
begin
  if p_fragment_id is null or p_fragment_id not in ('top', 'bottom', 'left', 'right') then
    raise exception 'Invalid fragment';
  end if;

  insert into public.player_fragment_gameplay_state (player_id, fragment_id)
  values (p_player_id, p_fragment_id)
  on conflict (player_id, fragment_id) do nothing;

  select * into v_state
  from public.player_fragment_gameplay_state
  where player_id = p_player_id and fragment_id = p_fragment_id
  for update;

  if v_state.status = 'fixed' and v_state.cooldown_until > now() then
    return jsonb_build_object(
      'success', false,
      'reason', 'cooldown',
      'cooldownUntil', v_state.cooldown_until
    );
  end if;

  if v_state.status = 'fixed' and v_state.cooldown_until <= now() then
    update public.player_fragment_gameplay_state
      set status = 'locked', cooldown_until = null, updated_at = now()
      where player_id = p_player_id and fragment_id = p_fragment_id;
    v_state.status := 'locked';
  end if;

  if v_state.status = 'unlocked' then
    return jsonb_build_object('success', true, 'alreadyUnlocked', true);
  end if;

  select * into v_session
  from public.fragment_unlock_sessions
  where player_id = p_player_id
    and fragment_id = p_fragment_id
    and status = 'pending'
    and expires_at > now()
  order by started_at desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'success', true,
      'alreadyStarted', true,
      'sessionId', v_session.id,
      'startedAt', v_session.started_at,
      'expiresAt', v_session.expires_at
    );
  end if;

  update public.fragment_unlock_sessions
    set status = 'expired'
    where player_id = p_player_id
      and fragment_id = p_fragment_id
      and status = 'pending'
      and expires_at <= now();

  insert into public.fragment_unlock_sessions (player_id, fragment_id)
  values (p_player_id, p_fragment_id)
  returning * into v_session;

  return jsonb_build_object(
    'success', true,
    'alreadyStarted', false,
    'sessionId', v_session.id,
    'startedAt', v_session.started_at,
    'expiresAt', v_session.expires_at
  );
end;
$$;

-- Complete only after the server has observed at least three seconds.
-- This is a server-timed placeholder, NOT proof of a third-party ad impression.
create or replace function public.complete_fragment_unlock(
  p_player_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_session public.fragment_unlock_sessions%rowtype;
  v_state public.player_fragment_gameplay_state%rowtype;
begin
  select * into v_session
  from public.fragment_unlock_sessions
  where id = p_session_id and player_id = p_player_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'session_not_found');
  end if;

  if v_session.status = 'completed' then
    return jsonb_build_object('success', true, 'alreadyCompleted', true, 'fragmentId', v_session.fragment_id);
  end if;

  if v_session.status <> 'pending' then
    return jsonb_build_object('success', false, 'reason', 'session_not_pending');
  end if;

  if v_session.expires_at <= now() then
    update public.fragment_unlock_sessions set status = 'expired' where id = v_session.id;
    return jsonb_build_object('success', false, 'reason', 'session_expired');
  end if;

  if v_session.started_at > now() - interval '3 seconds' then
    return jsonb_build_object(
      'success', false,
      'reason', 'wait_required',
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (v_session.started_at + interval '3 seconds' - now())))::integer)
    );
  end if;

  select * into v_state
  from public.player_fragment_gameplay_state
  where player_id = p_player_id and fragment_id = v_session.fragment_id
  for update;

  if not found or v_state.status <> 'locked' then
    return jsonb_build_object('success', false, 'reason', 'fragment_not_locked');
  end if;

  update public.player_fragment_gameplay_state
    set status = 'unlocked', updated_at = now()
    where player_id = p_player_id and fragment_id = v_session.fragment_id;

  update public.fragment_unlock_sessions
    set status = 'completed', completed_at = now()
    where id = v_session.id;

  return jsonb_build_object(
    'success', true,
    'alreadyCompleted', false,
    'fragmentId', v_session.fragment_id,
    'completedAt', now()
  );
end;
$$;

-- A fragment can be fixed only after a server-authorized unlock.
-- Cooldown and mining-session timestamps are generated by PostgreSQL.
create or replace function public.fix_fragment_trusted(
  p_player_id uuid,
  p_fragment_id text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_state public.player_fragment_gameplay_state%rowtype;
  v_event public.gameplay_action_events%rowtype;
begin
  if p_fragment_id not in ('top', 'bottom', 'left', 'right') or p_request_id is null then
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
      'success', true,
      'duplicate', true,
      'actionEventId', v_event.id,
      'fragmentId', v_event.fragment_id,
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

  -- Re-check idempotency after taking the state lock so concurrent retries
  -- of the same request return the first committed event rather than failing.
  select * into v_event
  from public.gameplay_action_events
  where player_id = p_player_id and request_id = p_request_id;

  if found then
    if v_event.fragment_id <> p_fragment_id then
      return jsonb_build_object('success', false, 'reason', 'request_id_conflict');
    end if;
    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'actionEventId', v_event.id,
      'fragmentId', v_event.fragment_id,
      'createdAt', v_event.created_at
    );
  end if;

  if v_state.status <> 'unlocked' then
    return jsonb_build_object('success', false, 'reason', 'fragment_not_unlocked');
  end if;

  update public.player_fragment_gameplay_state
    set status = 'fixed',
        cooldown_until = now() + interval '3 hours',
        core_mining_until = now() + interval '4 hours',
        updated_at = now()
    where player_id = p_player_id and fragment_id = p_fragment_id;

  insert into public.gameplay_action_events (
    player_id, action_type, fragment_id, request_id
  ) values (
    p_player_id, 'fragment_fixed', p_fragment_id, p_request_id
  )
  returning * into v_event;

  return jsonb_build_object(
    'success', true,
    'duplicate', false,
    'actionEventId', v_event.id,
    'fragmentId', v_event.fragment_id,
    'createdAt', v_event.created_at,
    'cooldownUntil', now() + interval '3 hours',
    'coreMiningUntil', now() + interval '4 hours'
  );
end;
$$;

revoke all on function public.begin_fragment_unlock(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_fragment_unlock(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fix_fragment_trusted(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.begin_fragment_unlock(uuid, text) to service_role;
grant execute on function public.complete_fragment_unlock(uuid, uuid) to service_role;
grant execute on function public.fix_fragment_trusted(uuid, text, uuid) to service_role;
