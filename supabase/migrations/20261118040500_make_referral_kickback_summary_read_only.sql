-- Keep player-economy GET requests read-only. Referral maturity and
-- monthly-budget allocation are handled by the scheduled one-minute worker.
CREATE OR REPLACE FUNCTION app_private.get_player_referral_kickbacks(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'app_private', 'pg_temp'
AS $function$
DECLARE
  v_claimable numeric(24,6);
  v_pending numeric(24,6);
  v_lifetime numeric(24,6);
  v_claimed numeric(24,6);
  v_recent jsonb;
BEGIN
  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'Player ID is required';
  END IF;

  SELECT
    COALESCE(SUM(GREATEST(allocated_amount - claimed_amount, 0)), 0),
    COALESCE(SUM(CASE WHEN status IN ('pending', 'verified', 'held')
      THEN GREATEST(amount - allocated_amount, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status <> 'reversed' THEN amount ELSE 0 END), 0)
  INTO v_claimable, v_pending, v_lifetime
  FROM app_private.referral_kickback_entries
  WHERE recipient_player_id = p_player_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_claimed
  FROM app_private.referral_kickback_claims
  WHERE player_id = p_player_id;

  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT
      l.created_at,
      jsonb_build_object(
        'id', l.id,
        'eventType', l.event_type,
        'amount', l.amount,
        'createdAt', l.created_at,
        'referralLevel', e.referral_level,
        'status', e.status,
        'sourceEventType', e.source_event_type,
        'sourceEventId', e.source_event_id
      ) AS item
    FROM app_private.referral_kickback_ledger l
    LEFT JOIN app_private.referral_kickback_entries e ON e.id = l.entry_id
    WHERE l.player_id = p_player_id
    ORDER BY l.created_at DESC
    LIMIT 20
  ) x;

  RETURN jsonb_build_object(
    'pendingZp', v_pending,
    'claimableZp', v_claimable,
    'claimableWholeZp', floor(v_claimable),
    'lifetimeEarnedZp', v_lifetime,
    'lifetimeClaimedZp', v_claimed,
    'recentActivity', v_recent
  );
END;
$function$;
