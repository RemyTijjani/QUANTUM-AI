INSERT INTO public.history_archive_other_control (table_name)
VALUES ('raffle_audit_log'),('raffle_winners'),('daily_uplink_claims'),
       ('share_uplink_mission_claims'),('telegram_mission_claims'),('agent_rental_zp_accruals'),('fragment_mining_rewards'),('gameplay_action_events'),('expedition_objective_progress'),('expedition_team_objective_progress'),('expedition_trusted_evidence'),('raffle_entries'),('expedition_participations'),('expedition_reward_issuances'),('expedition_team_members'),('game_event_participations'),('agent_rental_payment_intents'),('player_agent_rentals'),('briefing_attempts'),('briefing_progress'),('briefing_reward_issuances')
ON CONFLICT (table_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.history_archive_other_batch(
  p_table_name text,
  p_after_eligible_at timestamptz,
  p_after_id uuid,
  p_batch_size integer DEFAULT 200
)
RETURNS TABLE(id uuid, eligible_at timestamptz, record jsonb)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_table_name = 'fragment_mining_accruals' THEN
    RETURN QUERY SELECT t.id,t.credited_at,to_jsonb(t) FROM public.fragment_mining_accruals t
    WHERE t.credited_at IS NOT NULL AND t.release_at<=now()-interval '6 hours'
      AND t.credited_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.credited_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.credited_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'creator_ops_submissions' THEN
    RETURN QUERY SELECT t.id,t.reviewed_at,to_jsonb(t) FROM public.creator_ops_submissions t
    WHERE t.status IN ('approved','rejected') AND t.reviewed_at IS NOT NULL
      AND t.reviewed_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.reviewed_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.reviewed_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'x_follow_submissions' THEN
    RETURN QUERY SELECT t.id,t.reviewed_at,to_jsonb(t) FROM public.x_follow_submissions t
    WHERE t.status IN ('approved','rejected') AND t.reviewed_at IS NOT NULL
      AND t.reviewed_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.reviewed_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.reviewed_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'expedition_audit_log' THEN
    RETURN QUERY SELECT t.id,t.created_at,to_jsonb(t) FROM public.expedition_audit_log t
    WHERE t.created_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.created_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.created_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'game_event_participation_audit' THEN
    RETURN QUERY SELECT t.id,t.created_at,to_jsonb(t) FROM public.game_event_participation_audit t
    WHERE t.created_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.created_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.created_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'raffle_audit_log' THEN
    RETURN QUERY SELECT a.id,a.created_at,to_jsonb(a) FROM public.raffle_audit_log a
    JOIN public.raffles r ON r.id=a.raffle_id
    WHERE r.status='drawn' AND a.created_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (a.created_at,a.id)>(p_after_eligible_at,p_after_id))
    ORDER BY a.created_at,a.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'raffle_winners' THEN
    RETURN QUERY SELECT w.id,w.selected_at,to_jsonb(w) FROM public.raffle_winners w
    JOIN public.raffles r ON r.id=w.raffle_id
    WHERE r.status='drawn' AND w.delivery_status='credited'
      AND w.selected_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (w.selected_at,w.id)>(p_after_eligible_at,p_after_id))
    ORDER BY w.selected_at,w.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'daily_uplink_claims' THEN
    RETURN QUERY SELECT md5(t.player_id::text||':'||t.claim_date::text)::uuid,t.claimed_at,to_jsonb(t)
    FROM public.daily_uplink_claims t
    WHERE t.claimed_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.claimed_at,md5(t.player_id::text||':'||t.claim_date::text)::uuid)>(p_after_eligible_at,p_after_id))
    ORDER BY t.claimed_at,md5(t.player_id::text||':'||t.claim_date::text)::uuid
    LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'share_uplink_mission_claims' THEN
    RETURN QUERY SELECT t.player_id,t.claimed_at,to_jsonb(t) FROM public.share_uplink_mission_claims t
    WHERE t.claimed_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.claimed_at,t.player_id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.claimed_at,t.player_id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'telegram_mission_claims' THEN
    RETURN QUERY SELECT t.id,t.claimed_at,to_jsonb(t) FROM public.telegram_mission_claims t
    WHERE t.claimed_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.claimed_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.claimed_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'fragment_mining_rewards' THEN
    RETURN QUERY SELECT t.id,t.credited_at,to_jsonb(t) FROM public.fragment_mining_rewards t
    WHERE t.credited_at IS NOT NULL AND t.release_at<=now()-interval '6 hours'
      AND t.credited_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.credited_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.credited_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'gameplay_action_events' THEN
    RETURN QUERY SELECT t.id,t.created_at,to_jsonb(t) FROM public.gameplay_action_events t
    WHERE t.created_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.created_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.created_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'raffle_entries' THEN
    RETURN QUERY SELECT t.id,t.created_at,to_jsonb(t) FROM public.raffle_entries t
    JOIN public.raffles r ON r.id=t.raffle_id
    WHERE r.status='drawn' AND t.created_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.created_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.created_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'expedition_participations' THEN
    RETURN QUERY SELECT t.id,t.completed_at,to_jsonb(t) FROM public.expedition_participations t
    WHERE t.completed_at IS NOT NULL AND t.completed_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.completed_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.completed_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'expedition_reward_issuances' THEN
    RETURN QUERY SELECT t.id,t.issued_at,to_jsonb(t) FROM public.expedition_reward_issuances t
    WHERE t.issued_at IS NOT NULL AND t.issued_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.issued_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.issued_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'expedition_team_members' THEN
    RETURN QUERY SELECT t.id,t.left_at,to_jsonb(t) FROM public.expedition_team_members t
    WHERE t.left_at IS NOT NULL AND t.membership_status<>'active' AND t.left_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.left_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.left_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'game_event_participations' THEN
    RETURN QUERY SELECT p.id,p.completed_at,to_jsonb(p) FROM public.game_event_participations p
    JOIN public.game_events e ON e.id=p.event_id
    WHERE p.completed_at IS NOT NULL AND p.completed_at<=now()-interval '6 hours'
      AND e.ends_at<=now()-interval '6 hours'
      AND (p.zp_reward_amount IS NULL OR p.zp_reward_approved_at IS NOT NULL)
      AND (p_after_eligible_at IS NULL OR (p.completed_at,p.id)>(p_after_eligible_at,p_after_id))
    ORDER BY p.completed_at,p.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'agent_rental_payment_intents' THEN
    RETURN QUERY SELECT t.id,t.updated_at,to_jsonb(t) FROM public.agent_rental_payment_intents t
    WHERE t.status IN ('paid','confirmed','completed','expired','failed','cancelled','credited','settled')
      AND t.updated_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.updated_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.updated_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'player_agent_rentals' THEN
    RETURN QUERY SELECT t.id,t.expires_at,to_jsonb(t) FROM public.player_agent_rentals t
    WHERE t.status='expired' AND t.expires_at<=now()-interval '6 hours'
      AND t.accrued_through>=t.expires_at
      AND (p_after_eligible_at IS NULL OR (t.expires_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.expires_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'briefing_attempts' THEN
    RETURN QUERY SELECT t.id,t.created_at,to_jsonb(t) FROM public.briefing_attempts t
    WHERE t.created_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.created_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.created_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'briefing_progress' THEN
    RETURN QUERY SELECT t.id,t.completed_at,to_jsonb(t) FROM public.briefing_progress t
    WHERE t.status='completed' AND t.completed_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.completed_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.completed_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'briefing_reward_issuances' THEN
    RETURN QUERY SELECT t.id,t.issued_at,to_jsonb(t) FROM public.briefing_reward_issuances t
    WHERE t.issued_at IS NOT NULL AND t.issued_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.issued_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.issued_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'expedition_objective_progress' THEN
    RETURN QUERY SELECT t.id,t.verified_at,to_jsonb(t) FROM public.expedition_objective_progress t
    JOIN public.expeditions e ON e.id=t.expedition_id
    WHERE e.status IN ('completed','cancelled','closed','finished') AND t.status='verified'
      AND t.verified_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.verified_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.verified_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'expedition_team_objective_progress' THEN
    RETURN QUERY SELECT t.id,t.verified_at,to_jsonb(t) FROM public.expedition_team_objective_progress t
    JOIN public.expeditions e ON e.id=t.expedition_id
    WHERE e.status IN ('completed','cancelled','closed','finished') AND t.status='verified'
      AND t.verified_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.verified_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.verified_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'expedition_trusted_evidence' THEN
    RETURN QUERY SELECT t.id,t.created_at,to_jsonb(t) FROM public.expedition_trusted_evidence t
    JOIN public.expeditions e ON e.id=t.expedition_id
    WHERE e.status IN ('completed','cancelled','closed','finished') AND t.created_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.created_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.created_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'agent_rental_zp_accruals' THEN
    RETURN QUERY SELECT t.id,t.created_at,to_jsonb(t) FROM public.agent_rental_zp_accruals t
    WHERE t.period_end<=now()-interval '6 hours' AND t.created_at<=now()-interval '6 hours'
      AND (p_after_eligible_at IS NULL OR (t.created_at,t.id)>(p_after_eligible_at,p_after_id))
    ORDER BY t.created_at,t.id LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSE
    RAISE EXCEPTION 'Table is not approved for history archiving';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.history_archive_other_batch(text,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.history_archive_other_batch(text,timestamptz,uuid,integer) TO service_role;