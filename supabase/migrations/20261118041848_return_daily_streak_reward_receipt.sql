CREATE OR REPLACE FUNCTION public.get_daily_streak_state(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE
  v_state app_private.player_daily_streak_state%rowtype;
  v_today date := (now() at time zone 'utc')::date;
  v_claim app_private.daily_streak_claims%rowtype;
BEGIN
  IF p_player_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = p_player_id)
  THEN
    RAISE EXCEPTION 'Player profile not found';
  END IF;

  SELECT * INTO v_state
  FROM app_private.player_daily_streak_state
  WHERE player_id = p_player_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'currentStreakDay', 0, 'bestStreakDay', 0,
      'lastClaimDate', null, 'claimedToday', false,
      'nextStreakDay', 1, 'claimDate', v_today
    );
  END IF;

  SELECT * INTO v_claim
  FROM app_private.daily_streak_claims
  WHERE player_id = p_player_id AND claim_date = v_today;

  RETURN jsonb_build_object(
    'currentStreakDay', CASE
      WHEN v_state.last_claim_date IS NULL
        OR v_state.last_claim_date < v_today - 1 THEN 0
      ELSE v_state.current_streak_day
    END,
    'bestStreakDay', v_state.best_streak_day,
    'lastClaimDate', v_state.last_claim_date,
    'claimedToday', FOUND,
    'nextStreakDay', CASE
      WHEN v_state.last_claim_date IS NULL
        OR v_state.last_claim_date < v_today - 1
        OR v_state.current_streak_day >= 30 THEN 1
      WHEN v_state.last_claim_date = v_today THEN v_state.current_streak_day
      ELSE v_state.current_streak_day + 1
    END,
    'claimDate', v_today,
    'lastRewardType', v_claim.reward_type,
    'lastRewardAmount', v_claim.reward_amount,
    'lastRewardMetadata', v_claim.reward_metadata
  );
END;
$function$;
