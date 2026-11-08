/*
# Telegram Auth: Player identity, RLS, and referral security

## Purpose
Establishes server-enforced player identity via Telegram initData verification.
Each Telegram user maps to a Supabase auth user and a player profile record.
Tightens RLS on existing tables from open-anon to authenticated-and-player-scoped.

## New Tables
- `players` (id = auth user id, telegram_id unique, username, first_name, referral_code unique, created_at)

## New Views
- `player_referrals` - exposes (id, referral_code) from players for referral lookups.

## Modified Tables
- `creator_ops_submissions`: ADD player_id (uuid, FK auth.users, DEFAULT auth.uid())
- `referral_sub_nodes`: ADD recruit_id and referrer_id (uuid, FK auth.users)

## Security Changes
- players: RLS enabled. SELECT own row. UPDATE own row (username, first_name only).
  No client INSERT; player records are created by the telegram-auth function (service role).
- creator_ops_submissions: authenticated-only. SELECT/INSERT own rows. No client UPDATE/DELETE.
- referral_sub_nodes: authenticated-only, scoped to the referrer or recruit.
- All old anon policies dropped and replaced.

## Important Notes
1. Clients cannot insert into players directly.
2. service_role gets full access for edge functions.
*/

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_id bigint NOT NULL,
  username text,
  first_name text,
  referral_code text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_telegram_id ON players (telegram_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_referral_code ON players (referral_code);

CREATE OR REPLACE VIEW player_referrals AS
  SELECT id, referral_code FROM players;

GRANT SELECT ON player_referrals TO authenticated;

ALTER TABLE creator_ops_submissions
  ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE creator_ops_submissions
  ALTER COLUMN player_id SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_creator_ops_player_id ON creator_ops_submissions (player_id);

ALTER TABLE referral_sub_nodes
  ADD COLUMN IF NOT EXISTS recruit_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE referral_sub_nodes
  ALTER COLUMN recruit_id SET DEFAULT auth.uid();

ALTER TABLE referral_sub_nodes
  ADD COLUMN IF NOT EXISTS referrer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_referral_referrer_id ON referral_sub_nodes (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_recruit_id ON referral_sub_nodes (recruit_id);

REVOKE SELECT, INSERT, UPDATE, DELETE ON creator_ops_submissions FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON referral_sub_nodes FROM anon, authenticated;

DROP POLICY IF EXISTS "anon_select_submissions" ON creator_ops_submissions;
DROP POLICY IF EXISTS "anon_insert_submissions" ON creator_ops_submissions;
DROP POLICY IF EXISTS "anon_update_submissions" ON creator_ops_submissions;
DROP POLICY IF EXISTS "anon_delete_submissions" ON creator_ops_submissions;

GRANT SELECT, INSERT ON creator_ops_submissions TO authenticated;

DROP POLICY IF EXISTS "select_own_submissions" ON creator_ops_submissions;
CREATE POLICY "select_own_submissions" ON creator_ops_submissions FOR SELECT
  TO authenticated USING (player_id = auth.uid());

DROP POLICY IF EXISTS "insert_own_submissions" ON creator_ops_submissions;
CREATE POLICY "insert_own_submissions" ON creator_ops_submissions FOR INSERT
  TO authenticated WITH CHECK (player_id = auth.uid());

DROP POLICY IF EXISTS "anon_select_referrals" ON referral_sub_nodes;
DROP POLICY IF EXISTS "anon_insert_referrals" ON referral_sub_nodes;
DROP POLICY IF EXISTS "anon_update_referrals" ON referral_sub_nodes;
DROP POLICY IF EXISTS "anon_delete_referrals" ON referral_sub_nodes;

GRANT SELECT, INSERT ON referral_sub_nodes TO authenticated;
GRANT UPDATE (synced) ON referral_sub_nodes TO authenticated;

DROP POLICY IF EXISTS "select_own_referrals" ON referral_sub_nodes;
CREATE POLICY "select_own_referrals" ON referral_sub_nodes FOR SELECT
  TO authenticated USING (recruit_id = auth.uid() OR referrer_id = auth.uid());

DROP POLICY IF EXISTS "insert_own_referrals" ON referral_sub_nodes;
CREATE POLICY "insert_own_referrals" ON referral_sub_nodes FOR INSERT
  TO authenticated WITH CHECK (recruit_id = auth.uid());

DROP POLICY IF EXISTS "update_synced_own_referrals" ON referral_sub_nodes;
CREATE POLICY "update_synced_own_referrals" ON referral_sub_nodes FOR UPDATE
  TO authenticated USING (referrer_id = auth.uid()) WITH CHECK (referrer_id = auth.uid());

GRANT SELECT ON players TO authenticated;
GRANT UPDATE (username, first_name) ON players TO authenticated;

DROP POLICY IF EXISTS "select_own_profile" ON players;
CREATE POLICY "select_own_profile" ON players FOR SELECT
  TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "update_own_profile" ON players;
CREATE POLICY "update_own_profile" ON players FOR UPDATE
  TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON creator_ops_submissions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON referral_sub_nodes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON players TO service_role;
GRANT SELECT ON player_referrals TO service_role;
