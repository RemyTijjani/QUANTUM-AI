-- Stage 5: keep player-submission RPCs behind the authenticated mission-actions Edge Function.
-- The Edge Function validates the caller with auth.getUser(), derives the player
-- identity from that verified session, and invokes these RPCs using service_role.
-- Direct authenticated execution would bypass that server-side validation path.
-- Preserve SECURITY DEFINER and the pinned search_path; restrict EXECUTE to service_role.

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
