-- Require fragment maintenance on the same four-hour cadence as its mining window.
-- The trusted server remains the source of all timestamps.
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
  -- of the same request return the first committed event.
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
      cooldown_until = now() + interval '4 hours',
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
    'cooldownUntil', v_event.created_at + interval '4 hours',
    'coreMiningUntil', v_event.created_at + interval '4 hours'
  );
end;
$$;

revoke all on function public.fix_fragment_trusted(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.fix_fragment_trusted(uuid, text, uuid) to service_role;
