/*
# Create referral_sub_nodes table for tracking real referrals

## Security
- Enable RLS on `referral_sub_nodes`. Policies are open for anon/authenticated (superseded by the telegram auth migration).
*/

CREATE TABLE IF NOT EXISTS referral_sub_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_code text NOT NULL,
  recruit_code text NOT NULL,
  recruit_name text NOT NULL,
  synced boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE referral_sub_nodes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON referral_sub_nodes TO anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_recruit_unique ON referral_sub_nodes (recruit_code);
CREATE INDEX IF NOT EXISTS idx_referral_referrer_synced ON referral_sub_nodes (referrer_code, synced);

DROP POLICY IF EXISTS "anon_select_referrals" ON referral_sub_nodes;
CREATE POLICY "anon_select_referrals" ON referral_sub_nodes FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_referrals" ON referral_sub_nodes;
CREATE POLICY "anon_insert_referrals" ON referral_sub_nodes FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_referrals" ON referral_sub_nodes;
CREATE POLICY "anon_update_referrals" ON referral_sub_nodes FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_referrals" ON referral_sub_nodes;
CREATE POLICY "anon_delete_referrals" ON referral_sub_nodes FOR DELETE
TO anon, authenticated USING (true);
