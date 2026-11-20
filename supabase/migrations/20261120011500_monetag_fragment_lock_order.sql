-- Keep Monetag unlock row locking consistent with begin_fragment_unlock:
-- lock the player Fragment state first, then the unlock session.

CREATE OR REPLACE FUNCTION public.try_complete_monetag_fragment_unlock(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_session public.fragment_unlock_sessions%rowtype;
  v_state public.player_fragment_gameplay_state%rowtype;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_session
  FROM public.fragment_unlock_sessions
  WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
  END IF;

  SELECT * INTO v_state
  FROM public.player_fragment_gameplay_state
  WHERE player_id = v_session.player_id
    AND fragment_id = v_session.fragment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'fragment_state_missing');
  END IF;

  SELECT * INTO v_session
  FROM public.fragment_unlock_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
  END IF;

  IF v_session.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'completed', true, 'alreadyCompleted', true, 'fragmentId', v_session.fragment_id);
  END IF;
  IF v_session.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_pending');
  END IF;
  IF v_session.expires_at <= v_now THEN
    UPDATE public.fragment_unlock_sessions SET status = 'expired'
      WHERE id = v_session.id AND status = 'pending';
    RETURN jsonb_build_object('success', false, 'reason', 'session_expired');
  END IF;
  IF v_session.ad_provider <> 'monetag' OR v_session.fragment_id <> 'right' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'provider_or_fragment_mismatch');
  END IF;
  IF v_session.monetag_valued_at IS NULL OR v_session.sdk_completed_at IS NULL THEN
    RETURN jsonb_build_object('success', true, 'completed', false, 'pendingVerification', true);
  END IF;

  IF v_state.status = 'locked' THEN
    UPDATE public.player_fragment_gameplay_state
      SET status = 'unlocked', updated_at = v_now
      WHERE player_id = v_session.player_id AND fragment_id = v_session.fragment_id;
  ELSIF v_state.status <> 'unlocked' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'fragment_not_locked');
  END IF;

  UPDATE public.fragment_unlock_sessions
    SET status = 'completed', completed_at = v_now
    WHERE id = v_session.id AND status = 'pending';

  RETURN jsonb_build_object('success', true, 'completed', true, 'alreadyCompleted', false, 'fragmentId', v_session.fragment_id, 'completedAt', v_now);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_monetag_fragment_sdk_completed(p_player_id uuid, p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_session public.fragment_unlock_sessions%rowtype;
  v_state public.player_fragment_gameplay_state%rowtype;
BEGIN
  SELECT * INTO v_session
  FROM public.fragment_unlock_sessions
  WHERE id = p_session_id AND player_id = p_player_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
  END IF;

  SELECT * INTO v_state
  FROM public.player_fragment_gameplay_state
  WHERE player_id = p_player_id AND fragment_id = v_session.fragment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'fragment_state_missing');
  END IF;

  SELECT * INTO v_session
  FROM public.fragment_unlock_sessions
  WHERE id = p_session_id AND player_id = p_player_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
  END IF;

  IF v_session.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'completed', true, 'alreadyCompleted', true, 'fragmentId', v_session.fragment_id);
  END IF;
  IF v_session.status <> 'pending' OR v_session.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_pending');
  END IF;
  IF v_session.ad_provider <> 'monetag' OR v_session.fragment_id <> 'right' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'provider_or_fragment_mismatch');
  END IF;

  UPDATE public.fragment_unlock_sessions
    SET sdk_completed_at = COALESCE(sdk_completed_at, clock_timestamp())
    WHERE id = p_session_id;

  RETURN public.try_complete_monetag_fragment_unlock(p_session_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_monetag_fragment_valued_postback(p_ymid text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_session public.fragment_unlock_sessions%rowtype;
  v_state public.player_fragment_gameplay_state%rowtype;
BEGIN
  SELECT * INTO v_session
  FROM public.fragment_unlock_sessions
  WHERE monetag_ymid = p_ymid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
  END IF;

  SELECT * INTO v_state
  FROM public.player_fragment_gameplay_state
  WHERE player_id = v_session.player_id AND fragment_id = v_session.fragment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'fragment_state_missing');
  END IF;

  SELECT * INTO v_session
  FROM public.fragment_unlock_sessions
  WHERE id = v_session.id AND monetag_ymid = p_ymid
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
  END IF;

  IF v_session.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'completed', true, 'alreadyCompleted', true, 'fragmentId', v_session.fragment_id);
  END IF;
  IF v_session.status <> 'pending' OR v_session.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_pending');
  END IF;
  IF v_session.ad_provider <> 'monetag' OR v_session.fragment_id <> 'right' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'provider_or_fragment_mismatch');
  END IF;

  UPDATE public.fragment_unlock_sessions
    SET monetag_valued_at = COALESCE(monetag_valued_at, clock_timestamp())
    WHERE id = v_session.id;

  RETURN public.try_complete_monetag_fragment_unlock(v_session.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.try_complete_monetag_fragment_unlock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_monetag_fragment_sdk_completed(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_monetag_fragment_valued_postback(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_complete_monetag_fragment_unlock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_monetag_fragment_sdk_completed(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_monetag_fragment_valued_postback(text) TO service_role;
