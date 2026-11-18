-- One-time reward for a genuinely completed direct referral.
-- A copied/shared link alone is not rewarded: a new player must complete
-- Telegram authentication and be recorded in referral_sub_nodes.

CREATE TABLE IF NOT EXISTS public.share_uplink_mission_claims (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  referred_player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  reward_zp integer NOT NULL DEFAULT 300 CHECK (reward_zp = 300),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT share_uplink_mission_claims_no_self_referral
    CHECK (player_id <> referred_player_id)
);

ALTER TABLE public.share_uplink_mission_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.share_uplink_mission_claims FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_share_uplink_mission(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_referred_player_id uuid;
  v_reward integer;
  v_economy public.player_economy%ROWTYPE;
  v_existing public.share_uplink_mission_claims%ROWTYPE;
  v_new_balance numeric;
  v_new_lifetime numeric;
BEGIN
  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'A verified player account is required';
  END IF;

  PERFORM 1
  FROM public.players
  WHERE id = p_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your verified player profile could not be found';
  END IF;

  SELECT * INTO v_existing
  FROM public.share_uplink_mission_claims
  WHERE player_id = p_player_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'alreadyClaimed', true,
      'rewardZp', v_existing.reward_zp,
      'referredPlayerId', v_existing.referred_player_id
    );
  END IF;

  SELECT reward INTO v_reward
  FROM public.mission_tasks
  WHERE id = 'share-uplink'
    AND kind = 'social'
    AND status = 'published'
    AND reward_currency = 'ZP'
    AND unlock_cost_zp = 0
    AND reward = 300;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The referral mission is not configured for its verified reward';
  END IF;

  SELECT recruit_id INTO v_referred_player_id
  FROM public.referral_sub_nodes
  WHERE referrer_id = p_player_id
    AND recruit_id IS NOT NULL
    AND recruit_id <> p_player_id
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF v_referred_player_id IS NULL THEN
    RAISE EXCEPTION 'Complete one verified referral before claiming this reward';
  END IF;

  SELECT * INTO v_economy
  FROM public.player_economy
  WHERE player_id = p_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your verified ZP economy record could not be found';
  END IF;

  v_new_balance := COALESCE(v_economy.zp_balance, 0) + v_reward;
  v_new_lifetime := COALESCE(v_economy.lifetime_zp, 0) + v_reward;

  INSERT INTO public.share_uplink_mission_claims (
    player_id, referred_player_id, reward_zp
  ) VALUES (
    p_player_id, v_referred_player_id, v_reward
  );

  UPDATE public.player_economy
  SET zp_balance = v_new_balance,
      lifetime_zp = v_new_lifetime,
      updated_at = now()
  WHERE player_id = p_player_id;

  INSERT INTO public.economy_ledger (
    player_id, transaction_type, amount, balance_after, reference_id, description
  ) VALUES (
    p_player_id,
    'share_uplink_mission_reward',
    v_reward,
    v_new_balance,
    'share_uplink:' || p_player_id::text,
    'Verified Share Your Uplink mission reward'
  );

  RETURN jsonb_build_object(
    'success', true,
    'alreadyClaimed', false,
    'rewardZp', v_reward,
    'referredPlayerId', v_referred_player_id,
    'balanceAfter', v_new_balance
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_share_uplink_mission(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_share_uplink_mission(uuid) TO service_role;
