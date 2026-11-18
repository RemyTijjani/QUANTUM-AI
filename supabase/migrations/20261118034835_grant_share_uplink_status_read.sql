-- The mission status endpoint needs read-only access to the one-time claim marker.
GRANT SELECT ON TABLE public.share_uplink_mission_claims TO service_role;
