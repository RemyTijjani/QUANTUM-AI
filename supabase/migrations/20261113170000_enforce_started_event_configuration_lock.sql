-- Stage 5/6: enforce event configuration immutability at the database layer.
-- API-side checks improve UX, but triggers close concurrent-request race windows.

create or replace function public.guard_started_game_event_configuration()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.starts_at is not null and old.starts_at <= now() then
      raise exception 'An event cannot be deleted after it starts';
    end if;
    return old;
  end if;

  if old.starts_at is not null and old.starts_at <= now() then
    if new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at
       or new.timezone is distinct from old.timezone
       or new.reward_zp is distinct from old.reward_zp
       or new.reward_zap is distinct from old.reward_zap
       or new.min_participants is distinct from old.min_participants
       or new.max_participants is distinct from old.max_participants
       or new.objectives is distinct from old.objectives
       or new.requirements is distinct from old.requirements
       or new.participation_rules is distinct from old.participation_rules then
      raise exception 'Event schedule, rewards, capacity, and participation rules are locked once the event starts';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists game_events_started_configuration_lock
  on public.game_events;

create trigger game_events_started_configuration_lock
before update or delete on public.game_events
for each row
execute function public.guard_started_game_event_configuration();


create or replace function public.guard_started_game_event_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event_id uuid;
  v_starts_at timestamptz;
begin
  if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then
    raise exception 'An event activity cannot be moved to another event';
  end if;

  if tg_op = 'DELETE' then
    v_event_id := old.event_id;
  else
    v_event_id := new.event_id;
  end if;

  -- During an event deletion, the parent row may already be invisible to
  -- cascading child deletes. Permit that cascade; direct child deletion still
  -- finds and locks its parent event.
  select starts_at
    into v_starts_at
    from public.game_events
    where id = v_event_id
    for update;

  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'Event not found';
  end if;

  if v_starts_at is not null and v_starts_at <= now() then
    raise exception 'Event activities are locked once the event starts';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists game_event_activities_started_lock
  on public.game_event_activities;

create trigger game_event_activities_started_lock
before insert or update or delete on public.game_event_activities
for each row
execute function public.guard_started_game_event_activity();

revoke all on function public.guard_started_game_event_configuration() from public, anon, authenticated;
revoke all on function public.guard_started_game_event_activity() from public, anon, authenticated;
