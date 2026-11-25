ALTER TABLE public.history_archive_prune_control
  ADD COLUMN IF NOT EXISTS retrieval_verified_at timestamptz;