-- OnClicka rewarded-video verification for Capacitor Fragment (bottom).
-- Callback URL carries a high-entropy path token; only its SHA-256 digest is stored.
CREATE SCHEMA IF NOT EXISTS app_private;

ALTER TABLE public.fragment_unlock_sessions
  DROP CONSTRAINT IF EXISTS fragment_unlock_sessions_ad_provider_check;

ALTER TABLE public.fragment_unlock_sessions
  ADD CONSTRAINT fragment_unlock_sessions_ad_provider_check
  CHECK (ad_provider IS NULL OR ad_provider IN ('monetag', 'onclicka'));

ALTER TABLE public.fragment_unlock_sessions
  ADD COLUMN IF NOT EXISTS onclicka_confirmed_at timestamptz;

CREATE TABLE IF NOT EXISTS app_private.onclicka_callback_credentials (
  secret_hash text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.onclicka_callback_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.onclicka_callback_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT ON app_private.onclicka_callback_credentials TO service_role;

INSERT INTO app_private.onclicka_callback_credentials(secret_hash)
VALUES ('de5240ae71ac952fc0676c16c0a8215012d70123ae558f7fa62248a6fe47d7a9')
ON CONFLICT (secret_hash) DO UPDATE SET enabled = true;

CREATE OR REPLACE FUNCTION public.try_complete_onclicka_fragment_unlock(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
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
  WHERE player_id = v_session.player_id AND fragment_id = v_session.fragment_id
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
  IF v_session.status <> 'pending' OR v_session.expires_at <= v_now THEN
    IF v_session.status = 'pending' AND v_session.expires_at <= v_now THEN
      UPDATE public.fragment_unlock_sessions SET status = 'expired' WHERE id = v_session.id AND status = 'pending';
    END IF;
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_pending');
  END IF;
  IF v_session.ad_provider <> 'onclicka' OR v_session.fragment_id <> 'bottom' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'provider_or_fragment_mismatch');
  END IF;
  IF v_session.onclicka_confirmed_at IS NULL OR v_session.sdk_completed_at IS NULL THEN
    RETURN jsonb_build_object('success', true, 'completed', false, 'pendingVerification', true);
  END IF;

  IF v_state.status = 'locked' THEN
    UPDATE public.player_fragment_gameplay_state
      SET status = 'unlocked', updated_at = v_now
      WHERE player_id = v_session.player_id AND fragment_id = 'bottom';
  ELSIF v_state.status <> 'unlocked' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'fragment_not_locked');
  END IF;

  UPDATE public.fragment_unlock_sessions
    SET status = 'completed', completed_at = v_now
    WHERE id = v_session.id AND status = 'pending';

  RETURN jsonb_build_object('success', true, 'completed', true, 'alreadyCompleted', false, 'fragmentId', 'bottom', 'completedAt', v_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_onclicka_fragment_sdk_completed(
  p_player_id uuid,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session public.fragment_unlock_sessions%rowtype;
BEGIN
  SELECT * INTO v_session
  FROM public.fragment_unlock_sessions
  WHERE id = p_session_id AND player_id = p_player_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
  END IF;
  IF v_session.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'completed', true, 'alreadyCompleted', true, 'fragmentId', 'bottom');
  END IF;
  IF v_session.status <> 'pending' OR v_session.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_pending');
  END IF;
  IF v_session.ad_provider <> 'onclicka' OR v_session.fragment_id <> 'bottom' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'provider_or_fragment_mismatch');
  END IF;

  UPDATE public.fragment_unlock_sessions
    SET sdk_completed_at = COALESCE(sdk_completed_at, clock_timestamp())
    WHERE id = p_session_id;

  RETURN public.try_complete_onclicka_fragment_unlock(p_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_onclicka_fragment_view(p_telegram_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_player_id uuid;
  v_session public.fragment_unlock_sessions%rowtype;
BEGIN
  IF p_telegram_id IS NULL OR p_telegram_id <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_telegram_user');
  END IF;

  SELECT id INTO v_player_id
  FROM public.players
  WHERE telegram_id = p_telegram_id;

  IF v_player_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'player_not_found');
  END IF;

  SELECT * INTO v_session
  FROM public.fragment_unlock_sessions
  WHERE player_id = v_player_id
    AND fragment_id = 'bottom'
    AND ad_provider = 'onclicka'
    AND status = 'pending'
    AND expires_at > clock_timestamp()
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_eligible_session');
  END IF;

  UPDATE public.fragment_unlock_sessions
    SET onclicka_confirmed_at = COALESCE(onclicka_confirmed_at, clock_timestamp())
    WHERE id = v_session.id;

  RETURN public.try_complete_onclicka_fragment_unlock(v_session.id);
END;
$$;

REVOKE ALL ON FUNCTION public.try_complete_onclicka_fragment_unlock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_onclicka_fragment_sdk_completed(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_onclicka_fragment_view(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_complete_onclicka_fragment_unlock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_onclicka_fragment_sdk_completed(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_onclicka_fragment_view(bigint) TO service_role;
