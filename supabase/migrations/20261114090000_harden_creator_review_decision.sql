-- Stage 5: make Creator Ops review decisions fail closed at the database boundary.
-- A NULL decision must never fall through to the approval path in PL/pgSQL.

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

  SELECT *
    INTO v_economy
    FROM public.player_economy
    WHERE player_id = v_submission.player_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player economy record not found';
  END IF;

  v_new_zp := v_economy.zp_balance + v_reward;
  v_new_lifetime := v_economy.lifetime_zp + v_reward;

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
