-- Atomically issue prepared Expedition ZP/ZAP rewards after a final eligibility check.
CREATE OR REPLACE FUNCTION public.admin_issue_expedition_rewards(
  p_expedition_id uuid,
  p_admin_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_expedition public.expeditions%ROWTYPE;
  v_reward public.expedition_rewards%ROWTYPE;
  v_issuance public.expedition_reward_issuances%ROWTYPE;
  v_participation public.expedition_participations%ROWTYPE;
  v_economy public.player_economy%ROWTYPE;
  v_zap_result jsonb;
  v_balance numeric;
  v_ledger_reference text;
  v_issued integer := 0;
  v_voided integer := 0;
BEGIN
  IF p_admin_actor IS NULL OR length(trim(p_admin_actor)) = 0 THEN
    RAISE EXCEPTION 'Administrator identity is required';
  END IF;

  SELECT * INTO v_expedition
  FROM public.expeditions
  WHERE id = p_expedition_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expedition not found';
  END IF;
  IF v_expedition.status <> 'completed' THEN
    RAISE EXCEPTION 'Rewards can only be issued after the Expedition is completed';
  END IF;

  PERFORM public.refresh_expedition_eligibility(p_expedition_id);

  SELECT * INTO v_reward
  FROM public.expedition_rewards
  WHERE expedition_id = p_expedition_id
  FOR UPDATE;

  IF NOT FOUND OR v_reward.reward_type NOT IN ('zp', 'zap') OR v_reward.amount <= 0 THEN
    RAISE EXCEPTION 'A valid ZP or ZAP reward must be configured';
  END IF;

  FOR v_issuance IN
    SELECT *
    FROM public.expedition_reward_issuances
    WHERE expedition_id = p_expedition_id AND status = 'pending'
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    IF v_issuance.reward_id <> v_reward.id
       OR v_issuance.reward_type <> v_reward.reward_type
       OR v_issuance.amount <> v_reward.amount THEN
      RAISE EXCEPTION 'Pending reward configuration changed; issuance % requires review', v_issuance.id;
    END IF;

    SELECT * INTO v_participation
    FROM public.expedition_participations
    WHERE expedition_id = p_expedition_id
      AND player_id = v_issuance.player_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_participation.status <> 'eligible'
       OR v_participation.reward_eligible IS DISTINCT FROM true THEN
      UPDATE public.expedition_reward_issuances
      SET status = 'voided'
      WHERE id = v_issuance.id AND status = 'pending';
      v_voided := v_voided + 1;
      CONTINUE;
    END IF;

    IF v_issuance.reward_type = 'zp' THEN
      INSERT INTO public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
      VALUES (v_issuance.player_id, 0, 0, 0)
      ON CONFLICT (player_id) DO NOTHING;

      SELECT * INTO v_economy
      FROM public.player_economy
      WHERE player_id = v_issuance.player_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Player ZP economy record could not be created';
      END IF;

      v_balance := coalesce(v_economy.zp_balance, 0) + v_issuance.amount;

      UPDATE public.player_economy
      SET zp_balance = v_balance,
          lifetime_zp = coalesce(lifetime_zp, 0) + v_issuance.amount,
          updated_at = now()
      WHERE player_id = v_issuance.player_id;

      INSERT INTO public.economy_ledger (
        player_id, transaction_type, amount, balance_after, reference_id, description
      ) VALUES (
        v_issuance.player_id, 'expedition_reward', v_issuance.amount,
        v_balance, v_issuance.id::text,
        'Eligible reward for Expedition: ' || v_expedition.title
      ) RETURNING id::text INTO v_ledger_reference;
    ELSE
      v_zap_result := public.apply_player_zap_ledger_entry(
        v_issuance.player_id,
        'credit',
        v_issuance.amount,
        'expedition_reward',
        v_issuance.id::text,
        v_issuance.idempotency_key,
        'Eligible reward for Expedition: ' || v_expedition.title
      );

      IF coalesce((v_zap_result->>'success')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'ZAP ledger did not confirm reward issuance %', v_issuance.id;
      END IF;
      v_ledger_reference := v_zap_result->>'entryId';
    END IF;

    UPDATE public.expedition_reward_issuances
    SET status = 'issued',
        ledger_reference = v_ledger_reference,
        issued_at = now()
    WHERE id = v_issuance.id AND status = 'pending';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reward issuance state changed unexpectedly for %', v_issuance.id;
    END IF;

    v_issued := v_issued + 1;
  END LOOP;

  INSERT INTO public.expedition_audit_log (
    expedition_id, actor, action, after_state
  ) VALUES (
    p_expedition_id,
    trim(p_admin_actor),
    'expedition_rewards_issued',
    jsonb_build_object(
      'issued_count', v_issued,
      'voided_count', v_voided,
      'reward_type', v_reward.reward_type,
      'amount_per_player', v_reward.amount
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'expeditionId', p_expedition_id,
    'issuedCount', v_issued,
    'voidedCount', v_voided,
    'rewardType', v_reward.reward_type,
    'amountPerPlayer', v_reward.amount
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_issue_expedition_rewards(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_issue_expedition_rewards(uuid, text) TO service_role;
