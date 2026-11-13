-- Harden Creator Ops submissions at the database boundary.
-- Accept only published Creator missions and links on the configured platform.
-- A partial unique index prevents concurrent duplicate pending submissions.

CREATE UNIQUE INDEX IF NOT EXISTS creator_ops_one_pending_per_player_mission
  ON public.creator_ops_submissions (player_id, mission_id)
  WHERE status = 'pending' AND player_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.submit_creator_ops_submission(
  p_mission_id text,
  p_link_url text
)
RETURNS SETOF public.creator_ops_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id uuid;
  v_referral_code text;
  v_reward integer;
  v_platform text;
  v_mission_status text;
  v_link_url text;
BEGIN
  v_player_id := auth.uid();

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_link_url := btrim(p_link_url);

  IF v_link_url IS NULL
     OR v_link_url = ''
     OR length(v_link_url) > 2048
     OR v_link_url ~ '[[:space:]]'
     OR v_link_url !~* '^https?://'
  THEN
    RAISE EXCEPTION 'Invalid submission link';
  END IF;

  SELECT p.referral_code
    INTO v_referral_code
  FROM public.players AS p
  WHERE p.id = v_player_id;

  IF NOT FOUND OR v_referral_code IS NULL THEN
    RAISE EXCEPTION 'Player profile not found';
  END IF;

  SELECT
    mt.reward,
    COALESCE(NULLIF(lower(btrim(mt.platform)), ''), 'youtube'),
    lower(btrim(mt.status))
  INTO v_reward, v_platform, v_mission_status
  FROM public.mission_tasks AS mt
  WHERE mt.id = p_mission_id
    AND mt.kind = 'creator';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Creator mission not found';
  END IF;

  IF v_mission_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'Creator mission is not currently published';
  END IF;

  IF v_reward IS NULL OR v_reward < 0 THEN
    RAISE EXCEPTION 'Invalid mission reward';
  END IF;

  IF v_platform NOT IN ('youtube', 'tiktok') THEN
    RAISE EXCEPTION 'Unsupported creator platform';
  END IF;

  -- Exact host matching prevents lookalike domains such as youtube.com.example.org.
  IF v_platform = 'youtube'
     AND v_link_url !~* '^https?://(www\.)?(youtube\.com|youtu\.be)(/|[?#]|$)'
  THEN
    RAISE EXCEPTION 'Submit a valid YouTube or youtu.be link for this mission';
  END IF;

  IF v_platform = 'tiktok'
     AND v_link_url !~* '^https?://(www\.|m\.|vm\.|vt\.)?tiktok\.com(/|[?#]|$)'
  THEN
    RAISE EXCEPTION 'Submit a valid TikTok link for this mission';
  END IF;

  RETURN QUERY
  INSERT INTO public.creator_ops_submissions (
    mission_id,
    player_referral_code,
    link_url,
    platform,
    reward_zp,
    status,
    player_id
  )
  VALUES (
    p_mission_id,
    v_referral_code,
    v_link_url,
    v_platform,
    v_reward,
    'pending',
    v_player_id
  )
  ON CONFLICT (player_id, mission_id)
    WHERE status = 'pending' AND player_id IS NOT NULL
  DO NOTHING
  RETURNING *;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A pending submission already exists for this mission';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_creator_ops_submission(text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_creator_ops_submission(text, text)
  TO authenticated, service_role;
