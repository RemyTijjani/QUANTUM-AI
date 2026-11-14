-- Stage 5: prevent service_role from directly changing economy balances or ledger history.
-- Trusted SECURITY DEFINER routines are owned by postgres (the table owner) and
-- remain the only intended write path. Edge Functions retain read access.
--
-- This migration is Preview-branch source only until explicitly applied to Preview.

REVOKE ALL PRIVILEGES
  ON TABLE public.player_economy, public.economy_ledger
  FROM service_role;

GRANT SELECT
  ON TABLE public.player_economy, public.economy_ledger
  TO service_role;
