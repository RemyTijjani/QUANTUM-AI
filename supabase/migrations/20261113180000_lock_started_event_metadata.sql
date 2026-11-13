-- Tighten started-event immutability: protect descriptive metadata and status transitions.
-- Existing trigger from 20261113170000 remains attached to this replaced function.

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
    if new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.category is distinct from old.category
       or new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at
       or new.timezone is distinct from old.timezone
       or new.reward_zp is distinct from old.reward_zp
       or new.reward_zap is distinct from old.reward_zap
       or new.min_participants is distinct from old.min_participants
       or new.max_participants is distinct from old.max_participants
       or new.objectives is distinct from old.objectives
       or new.requirements is distinct from old.requirements
       or new.participation_rules is distinct from old.participation_rules then
      raise exception 'Event details, schedule, rewards, capacity, and participation rules are locked once the event starts';
    end if;

    -- An active event may be cancelled, but never reset to draft or republished
    -- after cancellation. Other status changes are rejected.
    if new.status is distinct from old.status
       and not (old.status <> 'cancelled' and new.status = 'cancelled') then
      raise exception 'A started event may only transition to cancelled';
    end if;
  elsif new.starts_at is not null and new.starts_at <= now() then
    -- Do not allow an update that starts an event to alter its configuration.
    if new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.category is distinct from old.category
       or new.ends_at is distinct from old.ends_at
       or new.timezone is distinct from old.timezone
       or new.reward_zp is distinct from old.reward_zp
       or new.reward_zap is distinct from old.reward_zap
       or new.min_participants is distinct from old.min_participants
       or new.max_participants is distinct from old.max_participants
       or new.objectives is distinct from old.objectives
       or new.requirements is distinct from old.requirements
       or new.participation_rules is distinct from old.participation_rules then
      raise exception 'Event configuration cannot be changed while starting the event';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_started_game_event_configuration()
  from public, anon, authenticated;
