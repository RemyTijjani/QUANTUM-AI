CREATE TABLE IF NOT EXISTS vault_reserves (
  id text PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  ton_reserve numeric(18, 4) NOT NULL DEFAULT 0 CHECK (ton_reserve >= 0),
  zp_reserve bigint NOT NULL DEFAULT 0 CHECK (zp_reserve >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vault_reserves ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON vault_reserves TO service_role;

INSERT INTO vault_reserves (id, ton_reserve, zp_reserve) VALUES ('global', 0, 0)
ON CONFLICT (id) DO NOTHING;
