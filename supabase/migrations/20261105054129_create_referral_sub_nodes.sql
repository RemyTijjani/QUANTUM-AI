/*
# Create referral_sub_nodes table for tracking real referrals

## Purpose
When a new player opens the app via a referral link (https://t.me/zord_agent_bot?startapp=ZORD-XXXXXX),
their device records a referral: the referrer's code and the new player's code. The referrer then polls
this table to discover new sub-nodes that joined through their link, and adds them to their local game state
so kickback earnings start counting.

## New Tables
- `referral_sub_nodes`
  - `id` (uuid, primary key)
  - `referrer_code` (text, the referral code of the player who shared the link)
  - `recruit_code` (text, the referral code of the new player who joined via the link)
  - `recruit_name` (text, display name for the recruit in the referrer's sub-node list)
  - `synced` (boolean, defaults false — set true when the referrer has pulled this referral into their local state)
  - `created_at` (timestamptz, defaults now())

## Security
- Enable RLS on `referral_sub_nodes`.
- This is a no-auth single-tenant app (no sign-in screen), so policies use `TO anon, authenticated`.
- Anyone can INSERT a new referral record (a new player joining via a link).
- Anyone can SELECT unsynced referrals for a given referrer_code (the referrer polling for new sub-nodes).
- Anyone can UPDATE synced=true after polling (marking a referral as consumed).
- `USING (true)` is acceptable because the data is intentionally shared within this single-tenant app —
  referral codes are public identifiers, not secrets.

## Important Notes
1. Since this app has no sign-in screen, all access runs as the `anon` role.
2. The `recruit_code` column has a unique constraint so a player can only be referred once.
3. The referrer polls for rows where `referrer_code` = their code AND `synced` = false.
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
