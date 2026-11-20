-- Harden the SECURITY DEFINER event reward function's execution path.
-- Keep pg_catalog first, then the trusted application schema, with pg_temp last.
-- This changes only the function-level setting; the function body and grants remain unchanged.
ALTER FUNCTION public.admin_approve_event_participant_reward(uuid, text)
  SET search_path TO pg_catalog, public, pg_temp;
