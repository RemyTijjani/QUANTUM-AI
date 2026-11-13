-- Stage 5 security hardening:
-- pin the SECURITY DEFINER participant-status RPC search_path to trusted schemas.
-- This prevents caller-controlled schema resolution for unqualified objects.
ALTER FUNCTION public.admin_update_event_participant_status(uuid, text, text)
  SET search_path TO pg_catalog, public, pg_temp;
