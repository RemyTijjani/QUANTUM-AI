-- Stage 5: persistent, cross-instance throttling for shared admin credentials.
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

CREATE OR REPLACE FUNCTION public.admin_check_login_rate_limit(p_key_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.admin_login_rate_limits%ROWTYPE;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid rate-limit key';
  END IF;

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
      WHERE key_hash = p_key_hash;
    RETURN jsonb_build_object('allowed', true, 'retryAfterSeconds', 0);
  END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'retryAfterSeconds', greatest(1, ceil(extract(epoch FROM (v_row.locked_until - now())))::integer)
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'retryAfterSeconds', 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_record_login_failure(p_key_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid rate-limit key';
  END IF;

  INSERT INTO public.admin_login_rate_limits (
    key_hash, failed_attempts, window_started_at, locked_until, updated_at
  )
  VALUES (p_key_hash, 1, now(), NULL, now())
  ON CONFLICT (key_hash) DO UPDATE
    SET failed_attempts = CASE
          WHEN admin_login_rate_limits.window_started_at <= now() - interval '15 minutes'
            THEN 1
          ELSE least(5, admin_login_rate_limits.failed_attempts + 1)
        END,
        window_started_at = CASE
          WHEN admin_login_rate_limits.window_started_at <= now() - interval '15 minutes'
            THEN now()
          ELSE admin_login_rate_limits.window_started_at
        END,
        locked_until = CASE
          WHEN (
            CASE
              WHEN admin_login_rate_limits.window_started_at <= now() - interval '15 minutes'
                THEN 1
              ELSE least(5, admin_login_rate_limits.failed_attempts + 1)
            END
          ) >= 5 THEN now() + interval '15 minutes'
          ELSE NULL
        END,
        updated_at = now();
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

REVOKE ALL ON FUNCTION public.admin_check_login_rate_limit(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_record_login_failure(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_clear_login_failures(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_check_login_rate_limit(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_login_failure(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_clear_login_failures(text)
  TO service_role;
