-- Consolidated production migration for the free Shield and Processor fragments.
-- Both fragments use the same server-enforced five-second unlock flow.
CREATE OR REPLACE FUNCTION public.complete_free_fragment_unlock(
  p_player_id uuid,
  p_session_id uuid
)
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
  IF p_player_id IS NULL OR p_session_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_request');
  END IF;

  SELECT * INTO v_session
  FROM public.fragment_unlock_sessions
  WHERE id = p_session_id AND player_id = p_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
  END IF;

  IF v_session.fragment_id NOT IN ('top', 'left') OR v_session.ad_provider IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'provider_or_fragment_mismatch');
  END IF;

  IF v_session.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'completed', true,
      'alreadyCompleted', true,
      'fragmentId', v_session.fragment_id
    );
  END IF;

  IF v_session.status <> 'pending' OR v_session.expires_at <= v_now THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_pending');
  END IF;

  IF v_session.started_at > v_now - interval '5 seconds' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'wait_required',
      'retryAfterSeconds',
      greatest(1, ceil(extract(epoch from (v_session.started_at + interval '5 seconds' - v_now)))::integer)
    );
  END IF;

  SELECT * INTO v_state
  FROM public.player_fragment_gameplay_state
  WHERE player_id = p_player_id AND fragment_id = v_session.fragment_id
  FOR UPDATE;

  IF NOT FOUND OR v_state.status <> 'locked' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'fragment_not_locked');
  END IF;

  UPDATE public.player_fragment_gameplay_state
  SET status = 'unlocked', updated_at = v_now
  WHERE player_id = p_player_id AND fragment_id = v_session.fragment_id;

  UPDATE public.fragment_unlock_sessions
  SET status = 'completed', completed_at = v_now
  WHERE id = p_session_id AND status = 'pending';

  RETURN jsonb_build_object(
    'success', true,
    'completed', true,
    'alreadyCompleted', false,
    'fragmentId', v_session.fragment_id,
    'completedAt', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_free_fragment_unlock(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_free_fragment_unlock(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.complete_free_fragment_unlock(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_free_fragment_unlock(uuid, uuid) TO service_role;
