-- Stage 7 raffle helper privilege hardening.
-- These internal SECURITY DEFINER helpers are reached only through
-- public service_role-only wrappers and must not retain default PUBLIC EXECUTE.
REVOKE ALL ON FUNCTION app_private.credit_zap_raffle_prize(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.select_raffle_winners(uuid, text, uuid[], numeric[]) FROM PUBLIC, anon, authenticated;
