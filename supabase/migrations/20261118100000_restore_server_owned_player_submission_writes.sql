-- Restore server-owned writes for player-submitted missions.
-- The previous "move_player_submission_rpcs_under_rls" migration reintroduced
-- direct INSERT grants. A player could then forge approved Creator Ops rows
-- (including reviewed_at), which the expedition evidence trigger trusts.
-- Preserve player-owned reads and route submissions through validated RPCs.

ALTER FUNCTION public.submit_creator_ops_submission(text, text)
  SECURITY DEFINER;
ALTER FUNCTION public.submit_creator_ops_submission(text, text)
  SET search_path TO 'pg_catalog', 'public', 'pg_temp';

ALTER FUNCTION public.submit_x_follow_submission(text)
  SECURITY DEFINER;
ALTER FUNCTION public.submit_x_follow_submission(text)
  SET search_path TO 'pg_catalog', 'public', 'pg_temp';

REVOKE ALL PRIVILEGES ON TABLE public.creator_ops_submissions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.creator_ops_submissions TO authenticated;

DROP POLICY IF EXISTS creator_ops_submissions_insert_own
  ON public.creator_ops_submissions;
DROP POLICY IF EXISTS "creator_ops_submissions_insert_own"
  ON public.creator_ops_submissions;
DROP POLICY IF EXISTS insert_own_submissions
  ON public.creator_ops_submissions;

CREATE POLICY creator_ops_submissions_select_own
  ON public.creator_ops_submissions
  FOR SELECT TO authenticated
  USING (player_id = (SELECT auth.uid()));

GRANT EXECUTE ON FUNCTION public.submit_creator_ops_submission(text, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_creator_ops_submission(text, text)
  FROM PUBLIC, anon;

REVOKE ALL PRIVILEGES ON TABLE public.x_follow_submissions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.x_follow_submissions TO authenticated;

DROP POLICY IF EXISTS x_follow_submissions_insert_own
  ON public.x_follow_submissions;
DROP POLICY IF EXISTS "x_follow_submissions_insert_own"
  ON public.x_follow_submissions;

CREATE POLICY x_follow_submissions_select_own
  ON public.x_follow_submissions
  FOR SELECT TO authenticated
  USING (player_id = (SELECT auth.uid()));

GRANT EXECUTE ON FUNCTION public.submit_x_follow_submission(text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_x_follow_submission(text)
  FROM PUBLIC, anon;
