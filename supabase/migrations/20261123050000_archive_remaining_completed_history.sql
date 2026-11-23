CREATE TABLE IF NOT EXISTS public.history_archive_other_control (
  table_name text PRIMARY KEY,
  after_eligible_at timestamptz,
  after_id uuid,
  last_archived_at timestamptz,
  last_batch_count integer NOT NULL DEFAULT 0
);
ALTER TABLE public.history_archive_other_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.history_archive_other_control FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.history_archive_other_control TO service_role;

INSERT INTO public.history_archive_other_control (table_name)
VALUES ('fragment_mining_accruals'),('creator_ops_submissions'),('x_follow_submissions'),
       ('expedition_audit_log'),('game_event_participation_audit')
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
    RETURN QUERY
      SELECT t.id, t.credited_at, to_jsonb(t)
      FROM public.fragment_mining_accruals t
      WHERE t.credited_at IS NOT NULL
        AND t.release_at <= now() - interval '6 hours'
        AND t.credited_at <= now() - interval '6 hours'
        AND (p_after_eligible_at IS NULL OR (t.credited_at,t.id) > (p_after_eligible_at,p_after_id))
      ORDER BY t.credited_at,t.id
      LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'creator_ops_submissions' THEN
    RETURN QUERY
      SELECT t.id, t.reviewed_at, to_jsonb(t)
      FROM public.creator_ops_submissions t
      WHERE t.status IN ('approved','rejected')
        AND t.reviewed_at IS NOT NULL
        AND t.reviewed_at <= now() - interval '6 hours'
        AND (p_after_eligible_at IS NULL OR (t.reviewed_at,t.id) > (p_after_eligible_at,p_after_id))
      ORDER BY t.reviewed_at,t.id
      LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'x_follow_submissions' THEN
    RETURN QUERY
      SELECT t.id, t.reviewed_at, to_jsonb(t)
      FROM public.x_follow_submissions t
      WHERE t.status IN ('approved','rejected')
        AND t.reviewed_at IS NOT NULL
        AND t.reviewed_at <= now() - interval '6 hours'
        AND (p_after_eligible_at IS NULL OR (t.reviewed_at,t.id) > (p_after_eligible_at,p_after_id))
      ORDER BY t.reviewed_at,t.id
      LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'expedition_audit_log' THEN
    RETURN QUERY
      SELECT t.id, t.created_at, to_jsonb(t)
      FROM public.expedition_audit_log t
      WHERE t.created_at IS NOT NULL
        AND t.created_at <= now() - interval '6 hours'
        AND (p_after_eligible_at IS NULL OR (t.created_at,t.id) > (p_after_eligible_at,p_after_id))
      ORDER BY t.created_at,t.id
      LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSIF p_table_name = 'game_event_participation_audit' THEN
    RETURN QUERY
      SELECT t.id, t.created_at, to_jsonb(t)
      FROM public.game_event_participation_audit t
      WHERE t.created_at IS NOT NULL
        AND t.created_at <= now() - interval '6 hours'
        AND (p_after_eligible_at IS NULL OR (t.created_at,t.id) > (p_after_eligible_at,p_after_id))
      ORDER BY t.created_at,t.id
      LIMIT LEAST(GREATEST(COALESCE(p_batch_size,200),1),200);
  ELSE
    RAISE EXCEPTION 'Table is not approved for history archiving';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.history_archive_other_batch(text,timestamptz,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.history_archive_other_batch(text,timestamptz,uuid,integer) TO service_role;
