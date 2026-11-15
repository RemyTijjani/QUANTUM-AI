-- Restrict Creator Ops submissions to read-only access for service_role.
-- Admin review remains available through the postgres-owned
-- SECURITY DEFINER function public.admin_review_creator_submission(...).
-- Player submissions remain available through the authenticated
-- SECURITY DEFINER function public.submit_creator_ops_submission(...).

REVOKE ALL PRIVILEGES
  ON TABLE public.creator_ops_submissions
  FROM service_role;

GRANT SELECT
  ON TABLE public.creator_ops_submissions
  TO service_role;
