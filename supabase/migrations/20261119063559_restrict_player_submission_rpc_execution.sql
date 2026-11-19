-- Historical Stage 5 grant-tightening attempt.
-- Follow-up inspection confirmed these SECURITY DEFINER RPCs intentionally use
-- auth.uid(), validate the caller's player identity, and are the authenticated
-- client submission path. The immediately following migration
-- 20261119063636_restore_guarded_player_submission_rpc_access.sql restores
-- authenticated EXECUTE while keeping PUBLIC and anon revoked.
-- Keep this migration in history; do not replay it independently.

REVOKE ALL PRIVILEGES
  ON FUNCTION public.submit_creator_ops_submission(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.submit_creator_ops_submission(text, text)
  TO service_role;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.submit_x_follow_submission(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.submit_x_follow_submission(text)
  TO service_role;
