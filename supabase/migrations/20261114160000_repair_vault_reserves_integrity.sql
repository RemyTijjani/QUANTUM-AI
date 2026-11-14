-- Restore the original Vault reserve invariants on an already-created Preview table.
-- Preserve existing non-null balances; normalize only NULLs to their declared defaults.
UPDATE public.vault_reserves
SET ton_reserve = 0
WHERE ton_reserve IS NULL;

UPDATE public.vault_reserves
SET zp_reserve = 0
WHERE zp_reserve IS NULL;

UPDATE public.vault_reserves
SET updated_at = now()
WHERE updated_at IS NULL;

-- Match the original migration's declared TON precision.
ALTER TABLE public.vault_reserves
  ALTER COLUMN ton_reserve TYPE numeric(18, 4)
  USING ton_reserve::numeric(18, 4);

ALTER TABLE public.vault_reserves
  ALTER COLUMN ton_reserve SET DEFAULT 0,
  ALTER COLUMN ton_reserve SET NOT NULL,
  ALTER COLUMN zp_reserve SET DEFAULT 0,
  ALTER COLUMN zp_reserve SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.vault_reserves'::regclass
      AND conname = 'vault_reserves_id_global_check'
  ) THEN
    ALTER TABLE public.vault_reserves
      ADD CONSTRAINT vault_reserves_id_global_check CHECK (id = 'global');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.vault_reserves'::regclass
      AND conname = 'vault_reserves_ton_reserve_nonnegative_check'
  ) THEN
    ALTER TABLE public.vault_reserves
      ADD CONSTRAINT vault_reserves_ton_reserve_nonnegative_check CHECK (ton_reserve >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.vault_reserves'::regclass
      AND conname = 'vault_reserves_zp_reserve_nonnegative_check'
  ) THEN
    ALTER TABLE public.vault_reserves
      ADD CONSTRAINT vault_reserves_zp_reserve_nonnegative_check CHECK (zp_reserve >= 0);
  END IF;
END
$$;

-- Restore the intended least-privilege table ACL from the original migration.
REVOKE ALL PRIVILEGES ON TABLE public.vault_reserves
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.vault_reserves TO service_role;

-- The original migration seeds this singleton row. Recreate it if it is absent;
-- ON CONFLICT preserves any existing reserve balances.
INSERT INTO public.vault_reserves (id, ton_reserve, zp_reserve)
VALUES ('global', 0, 0)
ON CONFLICT (id) DO NOTHING;
