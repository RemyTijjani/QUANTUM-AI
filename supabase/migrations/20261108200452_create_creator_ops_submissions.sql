/*
# Create creator_ops_submissions table for Task-to-Earn missions

## Purpose
Stores link submissions from the Missions tab's "Creator Ops" category (TikTok/YouTube link submissions).
Admins review these submissions and approve/reject them to manage ZP payouts.

## Security
- Enable RLS on `creator_ops_submissions`.
- Grant SELECT, INSERT, UPDATE, DELETE to `anon, authenticated`; policies are open (single-tenant app).
*/

CREATE TABLE IF NOT EXISTS creator_ops_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id text NOT NULL,
  player_referral_code text NOT NULL,
  link_url text NOT NULL,
  platform text NOT NULL DEFAULT 'youtube',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reward_iq integer NOT NULL DEFAULT 0,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE creator_ops_submissions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON creator_ops_submissions TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_creator_ops_status ON creator_ops_submissions (status);
CREATE INDEX IF NOT EXISTS idx_creator_ops_referral ON creator_ops_submissions (player_referral_code);

DROP POLICY IF EXISTS "anon_select_submissions" ON creator_ops_submissions;
CREATE POLICY "anon_select_submissions" ON creator_ops_submissions FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_submissions" ON creator_ops_submissions;
CREATE POLICY "anon_insert_submissions" ON creator_ops_submissions FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_submissions" ON creator_ops_submissions;
CREATE POLICY "anon_update_submissions" ON creator_ops_submissions FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_submissions" ON creator_ops_submissions;
CREATE POLICY "anon_delete_submissions" ON creator_ops_submissions FOR DELETE
TO anon, authenticated USING (true);
