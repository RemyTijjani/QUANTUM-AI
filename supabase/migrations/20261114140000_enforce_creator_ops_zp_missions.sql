-- Stage 6: enforce ZP-only, free Creator Ops missions at the database boundary.
-- Prevent authenticated clients from submitting against a mission configured
-- for ZAP rewards or a ZP unlock fee, even if they bypass the admin UI.

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
  v_reward_currency text;
  v_unlock_cost_zp bigint;
  v_platform text;
  v_mission_status text;
  v_link_url text;
  v_content_id text;
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
    mt.reward_currency,
    mt.unlock_cost_zp,
    COALESCE(NULLIF(lower(btrim(mt.platform)), ''), 'youtube'),
    lower(btrim(mt.status))
  INTO
    v_reward,
    v_reward_currency,
    v_unlock_cost_zp,
    v_platform,
    v_mission_status
  FROM public.mission_tasks AS mt
  WHERE mt.id = p_mission_id
    AND mt.kind = 'creator';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Creator mission not found';
  END IF;

  IF v_mission_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'Creator mission is not currently published';
  END IF;

  IF v_reward_currency IS DISTINCT FROM 'ZP' THEN
    RAISE EXCEPTION 'Creator Ops missions must reward ZP';
  END IF;

  IF v_unlock_cost_zp IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Creator Ops missions must not require ZP to unlock';
  END IF;

  IF v_reward IS NULL OR v_reward < 0 THEN
    RAISE EXCEPTION 'Invalid mission reward';
  END IF;

  IF v_platform NOT IN ('youtube', 'tiktok') THEN
    RAISE EXCEPTION 'Unsupported creator platform';
  END IF;

  v_content_id := public.creator_ops_extract_content_id(v_platform, v_link_url);
  IF v_content_id IS NULL THEN
    IF v_platform = 'youtube' THEN
      RAISE EXCEPTION 'Submit a valid YouTube video, Shorts, or live-video URL';
    ELSE
      RAISE EXCEPTION 'Submit a full TikTok video URL; shortened TikTok links are not accepted';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.creator_ops_submissions s
    WHERE s.player_id = v_player_id
      AND s.mission_id = p_mission_id
      AND s.platform = v_platform
      AND s.content_id = v_content_id
  ) THEN
    RAISE EXCEPTION 'This video has already been submitted for this mission';
  END IF;

  BEGIN
    RETURN QUERY
    INSERT INTO public.creator_ops_submissions (
      mission_id,
      player_referral_code,
      link_url,
      platform,
      content_id,
      reward_zp,
      status,
      player_id
    )
    VALUES (
      p_mission_id,
      v_referral_code,
      v_link_url,
      v_platform,
      v_content_id,
      v_reward,
      'pending',
      v_player_id
    )
    ON CONFLICT (player_id, mission_id)
      WHERE status = 'pending' AND player_id IS NOT NULL
    DO NOTHING
    RETURNING *;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'This video has already been submitted for this mission';
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A pending submission already exists for this mission';
  END IF;
END;
$function$;
