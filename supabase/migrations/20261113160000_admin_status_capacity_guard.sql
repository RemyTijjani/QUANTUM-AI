-- Stage 6: preserve event capacity when administrators restore withdrawn participants.
-- Lock order matches register_for_game_event: event row first, participation row second.

create or replace function public.admin_update_event_participant_status(
  p_participation_id uuid,
  p_status text,
  p_admin_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_event public.game_events%rowtype;
  v_current public.game_event_participations%rowtype;
  v_updated public.game_event_participations%rowtype;
  v_active_count integer;
begin
  if p_status not in ('registered', 'in_progress', 'submitted', 'completed', 'withdrawn') then
    raise exception 'Invalid participant status';
  end if;

  if p_admin_actor is null or length(trim(p_admin_actor)) = 0 then
    raise exception 'Admin actor is required';
  end if;

  -- Read the event reference without locking, then acquire locks in the same
  -- event -> participation order used by the public registration RPC.
  select event_id
    into v_event_id
    from public.game_event_participations
    where id = p_participation_id;

  if not found then
    return null;
  end if;

  select *
    into v_event
    from public.game_events
    where id = v_event_id
    for update;

  if not found then
    raise exception 'Event not found';
  end if;

  select *
    into v_current
    from public.game_event_participations
    where id = p_participation_id
    for update;

  if not found then
    return null;
  end if;

  if v_current.event_id <> v_event_id then
    raise exception 'Participant event changed; retry the request';
  end if;

  -- Restoring a withdrawn participant consumes a capacity slot. Serialize
  -- this check with normal registrations by holding the event row lock.
  if v_current.status = 'withdrawn' and p_status <> 'withdrawn'
     and v_event.max_participants is not null then
    select count(*)::integer
      into v_active_count
      from public.game_event_participations
      where event_id = v_event_id
        and status <> 'withdrawn'
        and id <> p_participation_id;

    if v_active_count >= v_event.max_participants then
      raise exception 'Event participant limit has been reached';
    end if;
  end if;

  update public.game_event_participations
    set status = p_status,
        completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else null end,
        updated_at = now()
    where id = p_participation_id
    returning * into v_updated;

  insert into public.game_event_participation_audit (
    participation_id, event_id, player_id, previous_status, new_status, admin_actor
  ) values (
    v_updated.id,
    v_updated.event_id,
    v_updated.player_id,
    v_current.status,
    v_updated.status,
    trim(p_admin_actor)
  );

  return jsonb_build_object(
    'id', v_updated.id,
    'status', v_updated.status,
    'updated_at', v_updated.updated_at,
    'completed_at', v_updated.completed_at
  );
end;
$$;

revoke all on function public.admin_update_event_participant_status(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_event_participant_status(uuid, text, text)
  to service_role;
