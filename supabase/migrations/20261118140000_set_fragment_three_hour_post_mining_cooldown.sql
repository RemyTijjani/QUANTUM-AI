CREATE OR REPLACE FUNCTION public.fix_fragment_trusted(
  p_player_id uuid,
  p_fragment_id text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_state public.player_fragment_gameplay_state%rowtype;
  v_event public.gameplay_action_events%rowtype;
  v_now timestamptz := clock_timestamp();
  v_mining_enabled boolean := true;
BEGIN
  IF p_fragment_id IS NULL
     OR p_fragment_id NOT IN ('top', 'bottom', 'left', 'right')
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid fragment action';
  END IF;

  SELECT * INTO v_event
  FROM public.gameplay_action_events
  WHERE player_id = p_player_id AND request_id = p_request_id;

  IF FOUND THEN
    IF v_event.fragment_id <> p_fragment_id THEN
      RETURN jsonb_build_object('success', false, 'reason', 'request_id_conflict');
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'actionEventId', v_event.id,
      'fragmentId', v_event.fragment_id,
      'createdAt', v_event.created_at
    );
  END IF;

  SELECT fragment_mining_enabled INTO v_mining_enabled
  FROM public.global_gameplay_settings
  WHERE id = 'global';

  IF NOT coalesce(v_mining_enabled, true) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'global_mining_paused');
  END IF;

  INSERT INTO public.player_fragment_gameplay_state (player_id, fragment_id)
  VALUES (p_player_id, p_fragment_id)
  ON CONFLICT (player_id, fragment_id) DO NOTHING;

  SELECT * INTO v_state
  FROM public.player_fragment_gameplay_state
  WHERE player_id = p_player_id AND fragment_id = p_fragment_id
  FOR UPDATE;

  SELECT * INTO v_event
  FROM public.gameplay_action_events
  WHERE player_id = p_player_id AND request_id = p_request_id;

  IF FOUND THEN
    IF v_event.fragment_id <> p_fragment_id THEN
      RETURN jsonb_build_object('success', false, 'reason', 'request_id_conflict');
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'actionEventId', v_event.id,
      'fragmentId', v_event.fragment_id,
      'createdAt', v_event.created_at
    );
  END IF;

  IF v_state.status <> 'unlocked' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'fragment_not_unlocked');
  END IF;

  UPDATE public.player_fragment_gameplay_state
  SET status = 'fixed',
      cooldown_until = v_now + interval '7 hours',
      core_mining_until = v_now + interval '4 hours',
      mining_started_at = v_now,
      mining_accrued_until = v_now,
      updated_at = v_now
  WHERE player_id = p_player_id AND fragment_id = p_fragment_id;

  INSERT INTO public.gameplay_action_events (player_id, action_type, fragment_id, request_id)
  VALUES (p_player_id, 'fragment_fixed', p_fragment_id, p_request_id)
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'actionEventId', v_event.id,
    'fragmentId', v_event.fragment_id,
    'createdAt', v_event.created_at,
    'cooldownUntil', v_now + interval '7 hours',
    'coreMiningUntil', v_now + interval '4 hours'
  );
END;
$function$;

COMMENT ON FUNCTION public.fix_fragment_trusted(uuid, text, uuid) IS
  'Starts a four-hour trusted mining window followed by a three-hour Fragment cooldown.';
