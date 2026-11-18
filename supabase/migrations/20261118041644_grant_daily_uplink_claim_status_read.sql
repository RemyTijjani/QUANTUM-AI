-- mission-actions reads a player's Daily Uplink claim marker with the
-- service-role client. Keep this table private from player roles while
-- allowing the trusted Edge Function to read it.
GRANT SELECT ON TABLE public.daily_uplink_claims TO service_role;
