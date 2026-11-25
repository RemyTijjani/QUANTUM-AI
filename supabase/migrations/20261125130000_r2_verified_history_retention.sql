-- R2-backed retention metadata and exact-match deletion gate.
-- Only economy_ledger and credited fragment_mining_accruals are eligible initially.
-- ZAP/referral ledgers and rows with inbound foreign-key dependencies remain in Supabase.

CREATE TABLE IF NOT EXISTS public.history_archive_manifest (
  archive_key text PRIMARY KEY,
  table_name text NOT NULL,
  archive_type text NOT NULL,
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  row_count integer NOT NULL CHECK (row_count > 0),
  oldest_record_at timestamptz NOT NULL,
  newest_record_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL,
  deletion_status text NOT NULL DEFAULT 'pending'
    CHECK (deletion_status IN ('pending','completed','partial','blocked')),
  deleted_rows integer NOT NULL DEFAULT 0,
  last_delete_checked_at timestamptz,
  last_error text,
  CONSTRAINT history_archive_manifest_time_order
    CHECK (oldest_record_at <= newest_record_at)
);

CREATE INDEX IF NOT EXISTS history_archive_manifest_pending_idx
  ON public.history_archive_manifest (table_name, newest_record_at)
  WHERE deletion_status IN ('pending','partial','blocked');

ALTER TABLE public.history_archive_manifest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.history_archive_manifest FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.history_archive_manifest TO service_role;

CREATE OR REPLACE FUNCTION public.history_archive_delete_verified_batch(
  p_table_name text,
  p_records jsonb,
  p_cutoff timestamptz DEFAULT (now() - interval '90 days')
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record jsonb;
  v_id text;
  v_deleted integer;
  v_exists boolean;
  v_deleted_count integer := 0;
  v_absent_count integer := 0;
  v_changed_count integer := 0;
  v_not_old_count integer := 0;
  v_blocked_count integer := 0;
BEGIN
  IF p_table_name NOT IN ('economy_ledger','fragment_mining_accruals') THEN
    RAISE EXCEPTION 'Table is not approved for verified archival deletion';
  END IF;
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) > 200 THEN
    RAISE EXCEPTION 'Expected an array of at most 200 archived records';
  END IF;

  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records)
  LOOP
    v_id := v_record->>'id';
    IF v_id IS NULL THEN
      v_changed_count := v_changed_count + 1;
      CONTINUE;
    END IF;

    v_deleted := NULL;
    BEGIN
      IF p_table_name = 'economy_ledger' THEN
        EXECUTE
          'DELETE FROM public.economy_ledger t
           WHERE t.id::text = $1
             AND to_jsonb(t) = $2
             AND t.created_at <= $3
           RETURNING 1'
        INTO v_deleted USING v_id, v_record, p_cutoff;
      ELSE
        EXECUTE
          'DELETE FROM public.fragment_mining_accruals t
           WHERE t.id::text = $1
             AND to_jsonb(t) = $2
             AND t.credited_at IS NOT NULL
             AND t.credited_at <= $3
             AND t.release_at <= $3
           RETURNING 1'
        INTO v_deleted USING v_id, v_record, p_cutoff;
      END IF;
    EXCEPTION WHEN foreign_key_violation THEN
      v_blocked_count := v_blocked_count + 1;
      CONTINUE;
    END;

    IF v_deleted = 1 THEN
      v_deleted_count := v_deleted_count + 1;
    ELSE
      IF p_table_name = 'economy_ledger' THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.economy_ledger t WHERE t.id::text = $1)'
          INTO v_exists USING v_id;
      ELSE
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.fragment_mining_accruals t WHERE t.id::text = $1)'
          INTO v_exists USING v_id;
      END IF;

      IF NOT v_exists THEN
        v_absent_count := v_absent_count + 1;
      ELSE
        v_changed_count := v_changed_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'table_name', p_table_name,
    'deleted', v_deleted_count,
    'already_absent', v_absent_count,
    'changed_or_not_matching', v_changed_count,
    'blocked_by_foreign_key', v_blocked_count,
    'not_old_enough', v_not_old_count,
    'cutoff', p_cutoff
  );
END;
$$;

REVOKE ALL ON FUNCTION public.history_archive_delete_verified_batch(text,jsonb,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.history_archive_delete_verified_batch(text,jsonb,timestamptz)
  TO service_role;
