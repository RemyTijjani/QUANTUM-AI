-- Settle any final trusted Fragment mining interval before an expired
-- fixed state is reset for a new unlock cycle. This also protects against
-- missed/paused cron executions while preserving the six-hour reward hold.
CREATE OR REPLACE FUNCTION public.begin_fragment_unlock(
  p_player_id uuid,
  p_fragment_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_state public.player_fragment_gameplay_state%ROWTYPE;
  v_session public.fragment_unlock_sessions%ROWTYPE;
BEGIN
  IF p_player_id IS NULL
     OR p_fragment_id IS NULL
     OR p_fragment_id NOT IN ('top', 'bottom', 'left', 'right') THEN
    RAISE EXCEPTION 'Invalid fragment';
  END IF;

  -- This function locks fragment rows in a consistent order. Run it before
  -- taking the target row lock here to avoid cross-fragment deadlocks.
  PERFORM public.accrue_fragment_mining_pending_zp(p_player_id);

  INSERT INTO public.player_fragment_gameplay_state (player_id, fragment_id)
  VALUES (p_player_id, p_fragment_id)
  ON CONFLICT (player_id, fragment_id) DO NOTHING;

  SELECT * INTO v_state
  FROM public.player_fragment_gameplay_state
  WHERE player_id = p_player_id AND fragment_id = p_fragment_id
  FOR UPDATE;

  IF v_state.status = 'fixed' AND v_state.cooldown_until > now() THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'cooldown',
      'cooldownUntil', v_state.cooldown_until
    );
  END IF;

  IF v_state.status = 'fixed' AND v_state.cooldown_until <= now() THEN
    UPDATE public.player_fragment_gameplay_state
    SET status = 'locked', cooldown_until = NULL, updated_at = now()
    WHERE player_id = p_player_id AND fragment_id = p_fragment_id;
    v_state.status := 'locked';
  END IF;

  IF v_state.status = 'unlocked' THEN
    RETURN jsonb_build_object('success', true, 'alreadyUnlocked', true);
  END IF;

  SELECT * INTO v_session
  FROM public.fragment_unlock_sessions
  WHERE player_id = p_player_id
    AND fragment_id = p_fragment_id
    AND status = 'pending'
    AND expires_at > now()
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'alreadyStarted', true,
      'sessionId', v_session.id,
      'startedAt', v_session.started_at,
      'expiresAt', v_session.expires_at
    );
  END IF;

  UPDATE public.fragment_unlock_sessions
  SET status = 'expired'
  WHERE player_id = p_player_id
    AND fragment_id = p_fragment_id
    AND status = 'pending'
    AND expires_at <= now();

  INSERT INTO public.fragment_unlock_sessions (player_id, fragment_id)
  VALUES (p_player_id, p_fragment_id)
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'success', true,
    'alreadyStarted', false,
    'sessionId', v_session.id,
    'startedAt', v_session.started_at,
    'expiresAt', v_session.expires_at
  );
END;
$function$;
