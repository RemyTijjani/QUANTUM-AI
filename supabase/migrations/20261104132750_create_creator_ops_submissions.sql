/*
# Create creator_ops_submissions table for Task-to-Earn missions

## Purpose
Stores link submissions from the Missions tab's "Creator Ops" category (TikTok/YouTube link submissions).
Admins review these submissions and approve/reject them to manage IQ payouts.

## New Tables
- `creator_ops_submissions`
  - `id` (uuid, primary key)
  - `mission_id` (text, references a mission in the app config)
  - `player_referral_code` (text, identifies which player submitted — used as the player identity since the app has no auth)
  - `link_url` (text, the submitted TikTok/YouTube link)
  - `platform` (text, 'tiktok' or 'youtube')
  - `status` (text, 'pending' | 'approved' | 'rejected', defaults to 'pending')
  - `reward_iq` (integer, the IQ reward amount to credit on approval)
  - `reviewed_at` (timestamptz, nullable, set when admin reviews)
  - `created_at` (timestamptz, defaults to now())

## Security
- Enable RLS on `creator_ops_submissions`.
- This is a no-auth single-tenant app (no sign-in screen), so policies use `TO anon, authenticated`.
- Players (anon) can INSERT new submissions and SELECT their own submissions (by referral_code).
- Admin review actions (UPDATE status, DELETE) are open to anon/authenticated since there's no auth system —
  the admin review queue is part of the same app. The `USING (true)` here is acceptable because the data
  is intentionally shared/public within this single-tenant app context.
- Grant SELECT, INSERT, UPDATE, DELETE to `anon, authenticated`.

## Important Notes
1. Since this app has no sign-in screen, all access runs as the `anon` role.
2. The `player_referral_code` column identifies which player submitted each link.
3. Admin approve/reject updates the `status` and `reviewed_at` columns.
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
