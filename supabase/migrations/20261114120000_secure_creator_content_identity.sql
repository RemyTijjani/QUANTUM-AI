-- Stage 5: enforce Creator Ops content identity and approval-time validation.
-- Creator missions remain repeatable, but one player cannot earn twice for the same
-- platform content ID within the same mission.

ALTER TABLE public.creator_ops_submissions
  ADD COLUMN IF NOT EXISTS content_id text;

CREATE OR REPLACE FUNCTION public.creator_ops_extract_content_id(
  p_platform text,
  p_link_url text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_platform text := lower(btrim(p_platform));
  v_url text := btrim(p_link_url);
  v_match text[];
BEGIN
  IF v_url = '' OR length(v_url) > 2048 OR v_url ~ '[[:space:]]' THEN
    RETURN NULL;
  END IF;

  IF v_platform = 'youtube' THEN
    IF v_url ~* '^https?://(www\.)?youtube\.com/watch([?#]|$)' THEN
      v_match := regexp_match(v_url, '[?&]v=([A-Za-z0-9_-]{11})([&#]|$)', 'i');
      IF v_match IS NOT NULL THEN RETURN v_match[1]; END IF;
      RETURN NULL;
    ELSIF v_url ~* '^https?://youtu\.be/' THEN
      v_match := regexp_match(v_url, '^https?://youtu\.be/([A-Za-z0-9_-]{11})([/?#]|$)', 'i');
      IF v_match IS NOT NULL THEN RETURN v_match[1]; END IF;
      RETURN NULL;
    ELSIF v_url ~* '^https?://(www\.)?youtube\.com/(shorts|embed|live)/' THEN
      v_match := regexp_match(v_url, '^https?://(www\.)?youtube\.com/(shorts|embed|live)/([A-Za-z0-9_-]{11})([/?#]|$)', 'i');
      IF v_match IS NOT NULL THEN RETURN v_match[3]; END IF;
      RETURN NULL;
    END IF;
    RETURN NULL;
  ELSIF v_platform = 'tiktok' THEN
    -- Short-link hosts require an external redirect resolution step and are
    -- deliberately rejected; only canonical video URLs have stable IDs here.
    IF v_url ~* '^https?://(www\.|m\.)?tiktok\.com/@[^/?#]+/video/[0-9]+([/?#]|$)' THEN
      v_match := regexp_match(v_url, '^https?://(www\.|m\.)?tiktok\.com/@[^/?#]+/video/([0-9]+)([/?#]|$)', 'i');
      IF v_match IS NOT NULL THEN RETURN v_match[2]; END IF;
    END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.creator_ops_extract_content_id(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Backfill only URLs whose canonical content identity can be established.
-- Historical non-content URLs remain untouched and cannot be approved again.
UPDATE public.creator_ops_submissions
SET content_id = public.creator_ops_extract_content_id(platform, link_url)
WHERE content_id IS NULL
  AND public.creator_ops_extract_content_id(platform, link_url) IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS creator_ops_unique_player_mission_content
  ON public.creator_ops_submissions (player_id, mission_id, platform, content_id)
  WHERE player_id IS NOT NULL AND content_id IS NOT NULL;

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

REVOKE ALL ON FUNCTION public.submit_creator_ops_submission(text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_creator_ops_submission(text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_review_creator_submission(
  p_submission_id uuid,
  p_decision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_submission public.creator_ops_submissions%ROWTYPE;
  v_economy public.player_economy%ROWTYPE;
  v_mission_platform text;
  v_expected_content_id text;
  v_reward numeric;
  v_new_zp numeric;
  v_new_lifetime numeric;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  SELECT *
    INTO v_submission
    FROM public.creator_ops_submissions
    WHERE id = p_submission_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;

  IF v_submission.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Submission has already been reviewed';
  END IF;

  v_reward := v_submission.reward_zp;

  IF v_reward IS NULL OR v_reward < 0 THEN
    RAISE EXCEPTION 'Invalid submission reward';
  END IF;

  IF p_decision = 'rejected' THEN
    UPDATE public.creator_ops_submissions
      SET status = 'rejected', reviewed_at = now()
      WHERE id = p_submission_id;

    RETURN jsonb_build_object(
      'success', true,
      'decision', 'rejected',
      'rewardZp', v_reward,
      'playerId', v_submission.player_id,
      'playerReferralCode', v_submission.player_referral_code
    );
  END IF;

  IF v_submission.player_id IS NULL THEN
    RAISE EXCEPTION 'Submission has no player ID';
  END IF;

  SELECT COALESCE(NULLIF(lower(btrim(mt.platform)), ''), 'youtube')
    INTO v_mission_platform
  FROM public.mission_tasks mt
  WHERE mt.id = v_submission.mission_id
    AND mt.kind = 'creator';

  IF NOT FOUND OR v_mission_platform NOT IN ('youtube', 'tiktok')
     OR v_submission.platform IS DISTINCT FROM v_mission_platform THEN
    RAISE EXCEPTION 'Submission platform does not match its Creator mission';
  END IF;

  v_expected_content_id :=
    public.creator_ops_extract_content_id(v_submission.platform, v_submission.link_url);

  IF v_expected_content_id IS NULL
     OR v_submission.content_id IS DISTINCT FROM v_expected_content_id THEN
    RAISE EXCEPTION 'Submission does not contain a valid, verified video identity';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.creator_ops_submissions s
    WHERE s.player_id = v_submission.player_id
      AND s.mission_id = v_submission.mission_id
      AND s.platform = v_submission.platform
      AND s.content_id = v_submission.content_id
      AND s.id <> v_submission.id
  ) THEN
    RAISE EXCEPTION 'This video has already been submitted for this mission';
  END IF;

  SELECT *
    INTO v_economy
    FROM public.player_economy
    WHERE player_id = v_submission.player_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player economy record not found';
  END IF;

  v_new_zp := COALESCE(v_economy.zp_balance, 0) + v_reward;
  v_new_lifetime := COALESCE(v_economy.lifetime_zp, 0) + v_reward;

  UPDATE public.player_economy
    SET zp_balance = v_new_zp,
        lifetime_zp = v_new_lifetime,
        updated_at = now()
    WHERE player_id = v_submission.player_id;

  IF v_reward > 0 THEN
    INSERT INTO public.economy_ledger (
      player_id, transaction_type, amount,
      balance_after, reference_id, description
    )
    VALUES (
      v_submission.player_id,
      'creator_ops_reward',
      v_reward,
      v_new_zp,
      'creator_ops:' || p_submission_id::text,
      'Approved Creator Ops mission: ' || v_submission.mission_id
    );
  END IF;

  UPDATE public.creator_ops_submissions
    SET status = 'approved', reviewed_at = now()
    WHERE id = p_submission_id;

  RETURN jsonb_build_object(
    'success', true,
    'decision', 'approved',
    'rewardZp', v_reward,
    'playerId', v_submission.player_id,
    'playerReferralCode', v_submission.player_referral_code
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_review_creator_submission(uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_review_creator_submission(uuid, text)
  TO service_role;
