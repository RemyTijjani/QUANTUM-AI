-- AdsGram Reward URL verification for the Capacitor Fragment (bottom).
-- AdsGram's Reward URL supplies the Telegram user ID; a private bearer token
-- authenticates the callback, and the database also requires the SDK completion
-- signal for the same active, one-time Fragment session.
CREATE SCHEMA IF NOT EXISTS app_private;

ALTER TABLE public.fragment_unlock_sessions
  DROP CONSTRAINT IF EXISTS fragment_unlock_sessions_ad_provider_check;
ALTER TABLE public.fragment_unlock_sessions
  ADD CONSTRAINT fragment_unlock_sessions_ad_provider_check
  CHECK (ad_provider IS NULL OR ad_provider IN ('monetag', 'onclicka', 'adsun', 'adsgram'));

ALTER TABLE public.fragment_unlock_sessions
  ADD COLUMN IF NOT EXISTS adsgram_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS adsgram_sdk_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS adsgram_block_id text;

CREATE TABLE IF NOT EXISTS app_private.adsgram_callback_credentials (
  secret_hash text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.adsgram_callback_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.adsgram_callback_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT ON app_private.adsgram_callback_credentials TO service_role;

-- Disable the retired Adsun callback credential so it can no longer unlock Capacitor.
UPDATE app_private.adsun_callback_credentials SET enabled = false;

INSERT INTO app_private.adsgram_callback_credentials(secret_hash)
VALUES ('0b9fd3921a352cfffc2b1803c0cf7d03719d97dd8251f94ab052a33d8c5c67ce')
ON CONFLICT (secret_hash) DO UPDATE SET enabled = true;

CREATE OR REPLACE FUNCTION public.is_valid_adsgram_callback_secret(p_secret_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, app_private, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_private.adsgram_callback_credentials
    WHERE secret_hash = p_secret_hash AND enabled = true
  );
$$;

CREATE OR REPLACE FUNCTION public.try_complete_adsgram_fragment_unlock(p_session_id uuid)
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
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
  END IF;
  IF v_session.ad_provider <> 'adsgram'
     OR v_session.fragment_id <> 'bottom'
     OR v_session.adsgram_block_id <> '61713' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'provider_or_fragment_mismatch');
  END IF;
  IF v_session.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'completed', true, 'alreadyCompleted', true, 'fragmentId', 'bottom');
  END IF;
  IF v_session.status <> 'pending' OR v_session.expires_at <= v_now THEN
    IF v_session.status = 'pending' AND v_session.expires_at <= v_now THEN
      UPDATE public.fragment_unlock_sessions SET status = 'expired' WHERE id = v_session.id AND status = 'pending';
    END IF;
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_pending');
  END IF;
  IF v_session.adsgram_confirmed_at IS NULL OR v_session.adsgram_sdk_completed_at IS NULL THEN
    RETURN jsonb_build_object('success', true, 'completed', false, 'pendingVerification', true);
  END IF;

  SELECT * INTO v_state
  FROM public.player_fragment_gameplay_state
  WHERE player_id = v_session.player_id AND fragment_id = 'bottom'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'fragment_state_missing');
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

CREATE OR REPLACE FUNCTION public.mark_adsgram_fragment_sdk_completed(
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
  IF v_session.ad_provider <> 'adsgram'
     OR v_session.fragment_id <> 'bottom'
     OR v_session.adsgram_block_id <> '61713' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'provider_or_fragment_mismatch');
  END IF;

  UPDATE public.fragment_unlock_sessions
  SET adsgram_sdk_completed_at = COALESCE(adsgram_sdk_completed_at, clock_timestamp())
  WHERE id = p_session_id;

  RETURN public.try_complete_adsgram_fragment_unlock(p_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_adsgram_fragment_reward(
  p_telegram_id bigint,
  p_block_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_player_id uuid;
  v_session public.fragment_unlock_sessions%rowtype;
BEGIN
  IF p_telegram_id IS NULL OR p_telegram_id <= 0 OR p_block_id <> '61713' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_callback');
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
    AND ad_provider = 'adsgram'
    AND adsgram_block_id = p_block_id
    AND status IN ('pending', 'completed')
    AND (status = 'completed' OR expires_at > clock_timestamp())
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_eligible_session');
  END IF;
  IF v_session.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'completed', true, 'alreadyCompleted', true, 'fragmentId', 'bottom');
  END IF;

  UPDATE public.fragment_unlock_sessions
  SET adsgram_confirmed_at = COALESCE(adsgram_confirmed_at, clock_timestamp())
  WHERE id = v_session.id;

  RETURN public.try_complete_adsgram_fragment_unlock(v_session.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_adsgram_fragment_unlock_status(
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
  WHERE id = p_session_id
    AND player_id = p_player_id
    AND fragment_id = 'bottom'
    AND ad_provider = 'adsgram';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'session_not_found');
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'completed', v_session.status = 'completed'
      AND v_session.adsgram_confirmed_at IS NOT NULL
      AND v_session.adsgram_sdk_completed_at IS NOT NULL,
    'pendingVerification', v_session.status = 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_valid_adsgram_callback_secret(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.try_complete_adsgram_fragment_unlock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_adsgram_fragment_sdk_completed(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_adsgram_fragment_reward(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_adsgram_fragment_unlock_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_adsgram_callback_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.try_complete_adsgram_fragment_unlock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_adsgram_fragment_sdk_completed(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_adsgram_fragment_reward(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_adsgram_fragment_unlock_status(uuid, uuid) TO service_role;
