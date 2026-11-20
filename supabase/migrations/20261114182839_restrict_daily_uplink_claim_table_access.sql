-- Daily Uplink claims are written only by the postgres-owned,
-- SECURITY DEFINER claim_daily_uplink RPC. Edge Functions call the RPC;
-- they do not need direct table privileges.
REVOKE ALL PRIVILEGES
  ON TABLE public.daily_uplink_claims
  FROM service_role;
