-- Stage 5: persistent, atomic throttling for shared admin credentials.
-- The Edge Function stores only an HMAC of the Cloudflare-provided client IP
-- and configured admin username. Raw IP addresses and passwords are not stored.

CREATE TABLE public.admin_login_rate_limits (
  key_hash text PRIMARY KEY
    CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  failed_attempts integer NOT NULL DEFAULT 0
    CHECK (failed_attempts BETWEEN 0 AND 5),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_login_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.admin_login_rate_limits
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_begin_login_attempt(p_key_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.admin_login_rate_limits%ROWTYPE;
  v_next_attempt integer;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid rate-limit key';
  END IF;

  -- Keep abandoned IP buckets bounded without storing raw client addresses.
  DELETE FROM public.admin_login_rate_limits
    WHERE updated_at < now() - interval '30 days';

  INSERT INTO public.admin_login_rate_limits (key_hash)
  VALUES (p_key_hash)
  ON CONFLICT (key_hash) DO NOTHING;

  SELECT *
    INTO v_row
    FROM public.admin_login_rate_limits
    WHERE key_hash = p_key_hash
    FOR UPDATE;

  IF v_row.window_started_at <= now() - interval '15 minutes' THEN
    UPDATE public.admin_login_rate_limits
      SET failed_attempts = 0,
          window_started_at = now(),
          locked_until = NULL,
          updated_at = now()
      WHERE key_hash = p_key_hash
    RETURNING * INTO v_row;
  END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'retryAfterSeconds', greatest(1, ceil(extract(epoch FROM (v_row.locked_until - now())))::integer)
    );
  END IF;

  IF v_row.failed_attempts >= 5 THEN
    UPDATE public.admin_login_rate_limits
      SET locked_until = now() + interval '15 minutes',
          updated_at = now()
      WHERE key_hash = p_key_hash;
    RETURN jsonb_build_object('allowed', false, 'retryAfterSeconds', 900);
  END IF;

  v_next_attempt := v_row.failed_attempts + 1;
  UPDATE public.admin_login_rate_limits
    SET failed_attempts = v_next_attempt,
        locked_until = CASE
          WHEN v_next_attempt >= 5 THEN now() + interval '15 minutes'
          ELSE NULL
        END,
        updated_at = now()
    WHERE key_hash = p_key_hash;

  -- Reserve the attempt atomically before credential comparison. This prevents
  -- concurrent requests from racing past the threshold.
  RETURN jsonb_build_object('allowed', true, 'retryAfterSeconds', 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_clear_login_failures(p_key_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid rate-limit key';
  END IF;

  DELETE FROM public.admin_login_rate_limits
    WHERE key_hash = p_key_hash;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_begin_login_attempt(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_clear_login_failures(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_begin_login_attempt(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_clear_login_failures(text)
  TO service_role;
