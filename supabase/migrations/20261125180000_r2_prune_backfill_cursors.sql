ALTER TABLE public.history_archive_prune_control
  ADD COLUMN IF NOT EXISTS economy_backfill_cursor text,
  ADD COLUMN IF NOT EXISTS fragment_backfill_cursor text,
  ADD COLUMN IF NOT EXISTS economy_backfill_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fragment_backfill_complete boolean NOT NULL DEFAULT false;
GRANT DELETE ON public.economy_ledger TO service_role;