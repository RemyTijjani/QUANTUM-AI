/*
# Telegram Auth: Player identity, RLS, and referral security

## Purpose
Establishes server-enforced player identity via Telegram initData verification.
Each Telegram user maps to a Supabase auth user and a player profile record.
Tightens RLS on existing tables from open-anon to authenticated-and-player-scoped.

## New Tables
- `players`
  - id (uuid, PK, FK to auth.users ON DELETE CASCADE)
  - telegram_id (bigint, UNIQUE NOT NULL — Telegram numeric user ID)
  - username (text, nullable — Telegram @username)
  - first_name (text, nullable)
  - referral_code (text, UNIQUE NOT NULL — the player's ZORD-XXXXXX code)
  - created_at (timestamptz, default now())

## New Views
- `player_referrals` — exposes (id, referral_code) from players for referral lookups.
  Any authenticated user can look up a player's ID by referral code. Referral codes
  are public identifiers used in sharing links, so this exposure is intentional.

## Modified Tables
- `creator_ops_submissions`: ADD COLUMN player_id (uuid, FK auth.users, DEFAULT auth.uid())
- `referral_sub_nodes`: ADD COLUMN recruit_id (uuid, FK auth.users, DEFAULT auth.uid())
                        ADD COLUMN referrer_id (uuid, FK auth.users)

## Security Changes
- players: RLS enabled. SELECT own row. UPDATE own row (username, first_name only).
  No client INSERT — player records are created by the telegram-auth edge function
  using the service role key. referral_code is never client-writable.
- creator_ops_submissions: RLS tightened from anon-open to authenticated-only.
  SELECT/INSERT own rows (player_id = auth.uid()). No client UPDATE/DELETE —
  admin review actions go through the admin-api edge function (service role).
- referral_sub_nodes: RLS tightened from anon-open to authenticated-only.
  SELECT rows where caller is referrer or recruit. INSERT where recruit_id = auth.uid().
  UPDATE only the synced column, only where referrer_id = auth.uid().
- player_referrals view: SELECT granted to authenticated (runs as view owner, bypassing
  RLS on players — intentional for public referral code lookups).
- All old anon policies dropped and replaced.

## Important Notes
1. The telegram-auth edge function creates auth users and player records using the
   service role key. Clients cannot insert into players directly.
2. player_id on creator_ops_submissions defaults to auth.uid() so client inserts
   automatically get the authenticated user's ID without passing it explicitly.
3. recruit_id on referral_sub_nodes defaults to auth.uid() similarly.
4. The admin-api edge function uses the service role key to review submissions,
   bypassing RLS. It verifies admin credentials server-side on every call.
5. service_role gets full CRUD on all tables for edge function operations.
*/

-- 1. Create players table
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

-- 2. Create player_referrals view (public lookup of player ID by referral code)
CREATE OR REPLACE VIEW player_referrals AS
  SELECT id, referral_code FROM players;

GRANT SELECT ON player_referrals TO authenticated;

-- 3. Add player_id to creator_ops_submissions
ALTER TABLE creator_ops_submissions
  ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE creator_ops_submissions
  ALTER COLUMN player_id SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_creator_ops_player_id ON creator_ops_submissions (player_id);

-- 4. Add recruit_id and referrer_id to referral_sub_nodes
ALTER TABLE referral_sub_nodes
  ADD COLUMN IF NOT EXISTS recruit_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE referral_sub_nodes
  ALTER COLUMN recruit_id SET DEFAULT auth.uid();

ALTER TABLE referral_sub_nodes
  ADD COLUMN IF NOT EXISTS referrer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_referral_referrer_id ON referral_sub_nodes (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_recruit_id ON referral_sub_nodes (recruit_id);

-- 5. Revoke old broad grants
REVOKE SELECT, INSERT, UPDATE, DELETE ON creator_ops_submissions FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON referral_sub_nodes FROM anon, authenticated;

-- 6. Drop old policies on creator_ops_submissions
DROP POLICY IF EXISTS "anon_select_submissions" ON creator_ops_submissions;
DROP POLICY IF EXISTS "anon_insert_submissions" ON creator_ops_submissions;
DROP POLICY IF EXISTS "anon_update_submissions" ON creator_ops_submissions;
DROP POLICY IF EXISTS "anon_delete_submissions" ON creator_ops_submissions;

-- 7. New grants and policies for creator_ops_submissions
GRANT SELECT, INSERT ON creator_ops_submissions TO authenticated;

CREATE POLICY "select_own_submissions" ON creator_ops_submissions FOR SELECT
  TO authenticated USING (player_id = auth.uid());

CREATE POLICY "insert_own_submissions" ON creator_ops_submissions FOR INSERT
  TO authenticated WITH CHECK (player_id = auth.uid());

-- 8. Drop old policies on referral_sub_nodes
DROP POLICY IF EXISTS "anon_select_referrals" ON referral_sub_nodes;
DROP POLICY IF EXISTS "anon_insert_referrals" ON referral_sub_nodes;
DROP POLICY IF EXISTS "anon_update_referrals" ON referral_sub_nodes;
DROP POLICY IF EXISTS "anon_delete_referrals" ON referral_sub_nodes;

-- 9. New grants and policies for referral_sub_nodes
GRANT SELECT, INSERT ON referral_sub_nodes TO authenticated;
GRANT UPDATE (synced) ON referral_sub_nodes TO authenticated;

CREATE POLICY "select_own_referrals" ON referral_sub_nodes FOR SELECT
  TO authenticated USING (recruit_id = auth.uid() OR referrer_id = auth.uid());

CREATE POLICY "insert_own_referrals" ON referral_sub_nodes FOR INSERT
  TO authenticated WITH CHECK (recruit_id = auth.uid());

CREATE POLICY "update_synced_own_referrals" ON referral_sub_nodes FOR UPDATE
  TO authenticated USING (referrer_id = auth.uid()) WITH CHECK (referrer_id = auth.uid());

-- 10. Players table grants and policies
GRANT SELECT ON players TO authenticated;
GRANT UPDATE (username, first_name) ON players TO authenticated;

CREATE POLICY "select_own_profile" ON players FOR SELECT
  TO authenticated USING (id = auth.uid());

CREATE POLICY "update_own_profile" ON players FOR UPDATE
  TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- 11. Grant service_role access for edge functions
GRANT SELECT, INSERT, UPDATE, DELETE ON creator_ops_submissions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON referral_sub_nodes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON players TO service_role;
GRANT SELECT ON player_referrals TO service_role;