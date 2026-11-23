CREATE TABLE IF NOT EXISTS public.history_archive_control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  cron_token_hash text NOT NULL DEFAULT '',
  checkpoint_created_at timestamptz,
  checkpoint_id uuid,
  high_water_created_at timestamptz,
  high_water_id uuid,
  after_created_at timestamptz,
  after_id uuid,
  lease_token uuid,
  lease_until timestamptz,
  last_archived_at timestamptz,
  last_batch_count integer NOT NULL DEFAULT 0,
  CONSTRAINT history_archive_checkpoint_pair CHECK ((checkpoint_created_at IS NULL) = (checkpoint_id IS NULL)),
  CONSTRAINT history_archive_high_water_pair CHECK ((high_water_created_at IS NULL) = (high_water_id IS NULL)),
  CONSTRAINT history_archive_after_pair CHECK ((after_created_at IS NULL) = (after_id IS NULL))
);

ALTER TABLE public.history_archive_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.history_archive_control FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.history_archive_control TO service_role;
INSERT INTO public.history_archive_control (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.history_archive_get_high_water(
  p_checkpoint_created_at timestamptz,
  p_checkpoint_id uuid,
  p_cutoff timestamptz
)
RETURNS TABLE(id uuid, created_at timestamptz)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT l.id, l.created_at
  FROM public.economy_ledger AS l
  WHERE l.created_at IS NOT NULL
    AND l.created_at <= p_cutoff
    AND (p_checkpoint_created_at IS NULL OR (l.created_at, l.id) > (p_checkpoint_created_at, p_checkpoint_id))
  ORDER BY l.created_at DESC, l.id DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.history_archive_eligible_batch(
  p_checkpoint_created_at timestamptz,
  p_checkpoint_id uuid,
  p_high_water_created_at timestamptz,
  p_high_water_id uuid,
  p_after_created_at timestamptz,
  p_after_id uuid,
  p_batch_size integer
)
RETURNS SETOF public.economy_ledger
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT l.*
  FROM public.economy_ledger AS l
  WHERE l.created_at IS NOT NULL
    AND (p_checkpoint_created_at IS NULL OR (l.created_at, l.id) > (p_checkpoint_created_at, p_checkpoint_id))
    AND (l.created_at, l.id) <= (p_high_water_created_at, p_high_water_id)
    AND (p_after_created_at IS NULL OR (l.created_at, l.id) < (p_after_created_at, p_after_id))
  ORDER BY l.created_at DESC, l.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 200), 1), 200)
$$;

REVOKE ALL ON FUNCTION public.history_archive_get_high_water(timestamptz, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.history_archive_eligible_batch(timestamptz, uuid, timestamptz, uuid, timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.history_archive_get_high_water(timestamptz, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.history_archive_eligible_batch(timestamptz, uuid, timestamptz, uuid, timestamptz, uuid, integer) TO service_role;
