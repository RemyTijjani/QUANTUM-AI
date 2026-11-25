CREATE TABLE IF NOT EXISTS public.history_archive_prune_control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  backfill_completed_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  last_run_at timestamptz,
  last_result jsonb
);
ALTER TABLE public.history_archive_prune_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.history_archive_prune_control FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.history_archive_prune_control TO service_role;
INSERT INTO public.history_archive_prune_control (id) VALUES (true) ON CONFLICT (id) DO NOTHING;