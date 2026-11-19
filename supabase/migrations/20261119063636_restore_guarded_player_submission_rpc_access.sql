-- Preserve the authenticated player submission RPCs.
-- Both SECURITY DEFINER functions derive the player identity from auth.uid(),
-- reject null identities, validate the published mission/content, and use a
-- pinned search_path. They are intentionally callable by authenticated players.
-- Keep anonymous/public execution revoked and retain service_role for trusted ops.

REVOKE ALL PRIVILEGES
  ON FUNCTION public.submit_creator_ops_submission(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION public.submit_creator_ops_submission(text, text)
  TO authenticated, service_role;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.submit_x_follow_submission(text)
  FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION public.submit_x_follow_submission(text)
  TO authenticated, service_role;
