CREATE OR REPLACE FUNCTION public.is_valid_onclicka_callback_secret(p_secret_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, app_private, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app_private.onclicka_callback_credentials
    WHERE secret_hash = p_secret_hash AND enabled = true
  );
$$;
REVOKE ALL ON FUNCTION public.is_valid_onclicka_callback_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_onclicka_callback_secret(text) TO service_role;