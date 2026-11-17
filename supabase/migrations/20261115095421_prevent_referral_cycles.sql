-- Prevent referral graph cycles while preserving first-attribution-wins behavior.
-- Referral relationships are created only by the trusted telegram-auth flow.
-- A transaction-scoped advisory lock serializes graph checks and inserts so two
-- concurrent registrations cannot independently create opposite edges.

CREATE OR REPLACE FUNCTION public.register_referral(
  p_referrer_tg_id bigint,
  p_referred_tg_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_referrer_id uuid;
  v_recruit_id uuid;
  v_referrer_code text;
  v_recruit_code text;
  v_recruit_name text;
BEGIN
  IF p_referrer_tg_id IS NULL
     OR p_referred_tg_id IS NULL
     OR p_referrer_tg_id = p_referred_tg_id THEN
    RETURN;
  END IF;

  -- All trusted registrations take this same lock before checking the graph.
  -- The table has no client INSERT policy/grant, so this serializes the
  -- supported write path without changing player-facing permissions.
  PERFORM pg_advisory_xact_lock(741852963);

  SELECT id, referral_code
  INTO v_referrer_id, v_referrer_code
  FROM public.players
  WHERE telegram_id = p_referrer_tg_id;

  IF v_referrer_id IS NULL THEN
    RAISE EXCEPTION 'Referrer player not found';
  END IF;

  SELECT id, referral_code,
    COALESCE(
      NULLIF(first_name, ''),
      NULLIF(username, ''),
      telegram_id::text
    )
  INTO v_recruit_id, v_recruit_code, v_recruit_name
  FROM public.players
  WHERE telegram_id = p_referred_tg_id;

  IF v_recruit_id IS NULL THEN
    RAISE EXCEPTION 'Referred player not found';
  END IF;

  -- Preserve first-attribution-wins: an existing recruit cannot be reassigned.
  IF EXISTS (
    SELECT 1
    FROM public.referral_sub_nodes
    WHERE recruit_id = v_recruit_id
       OR recruit_code = v_recruit_code
  ) THEN
    RETURN;
  END IF;

  -- Adding referrer -> recruit would create a cycle if recruit can already
  -- reach referrer by following existing referrer_id -> recruit_id edges.
  -- UNION (rather than UNION ALL) also makes traversal terminate if legacy
  -- data already contains a cycle.
  IF EXISTS (
    WITH RECURSIVE referral_path(player_id) AS (
      SELECT v_recruit_id
      UNION
      SELECT rsn.recruit_id
      FROM public.referral_sub_nodes AS rsn
      JOIN referral_path AS path
        ON rsn.referrer_id = path.player_id
      WHERE rsn.recruit_id IS NOT NULL
    )
    SELECT 1
    FROM referral_path
    WHERE player_id = v_referrer_id
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.referral_sub_nodes (
    referrer_code,
    recruit_code,
    recruit_name,
    synced,
    recruit_id,
    referrer_id
  )
  VALUES (
    v_referrer_code,
    v_recruit_code,
    v_recruit_name,
    false,
    v_recruit_id,
    v_referrer_id
  )
  ON CONFLICT DO NOTHING;
END;
$function$;

-- CREATE OR REPLACE preserves the existing function ACL. Reassert the intended
-- server-only execution boundary explicitly.
REVOKE EXECUTE ON FUNCTION public.register_referral(bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_referral(bigint, bigint)
  TO service_role;
