/*
# Create mission_tasks table

## Plain-English summary
Stores the mission catalog that operatives see and admins manage. Admins can add,
edit, and delete tasks through the admin dashboard.

## New tables
- `mission_tasks` (id text PK slug, kind, title, description, reward, platform, action_url, created_at)

## Seed data
The eight existing missions are inserted with their current ids so that existing
submissions keep pointing at the right mission.

## Security
- RLS enabled. Authenticated users can read the catalog.
- No client insert/update/delete; admin writes go through the admin-api function (service role).

## Important notes
1. Seed inserts use ON CONFLICT DO NOTHING so re-running is safe.
*/

CREATE TABLE IF NOT EXISTS mission_tasks (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('daily', 'social', 'creator')),
  title text NOT NULL,
  description text NOT NULL,
  reward integer NOT NULL CHECK (reward >= 0),
  platform text CHECK (platform IN ('tiktok', 'youtube')),
  action_url text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE mission_tasks ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON mission_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON mission_tasks TO service_role;

DROP POLICY IF EXISTS "select_mission_tasks" ON mission_tasks;
CREATE POLICY "select_mission_tasks" ON mission_tasks FOR SELECT
  TO authenticated USING (true);

INSERT INTO mission_tasks (id, kind, title, description, reward, platform, action_url) VALUES
  ('daily-uplink', 'daily', 'Daily Uplink', 'Check in with ZORD OS for today.', 100, NULL, NULL),
  ('ad-quota', 'daily', 'Ad Feed Quota', 'Watch 3 interstitial feeds today.', 150, NULL, NULL),
  ('agent-uptime', 'daily', 'Agent Uptime', 'Keep a ZORD agent running.', 200, NULL, NULL),
  ('join-intel', 'social', 'Join the ZORD Intel Channel', 'Get field reports from the grid.', 250, NULL, 'https://t.me/zord_intel'),
  ('follow-signal', 'social', 'Follow the Signal Feed', 'Catch every fragment drop as it breaks.', 250, NULL, 'https://x.com/zord_agent'),
  ('share-uplink', 'social', 'Broadcast Your Uplink', 'Send your referral link to another operative.', 300, NULL, NULL),
  ('creator-tiktok', 'creator', 'TikTok Content Drop', 'Submit a TikTok link featuring ZORD Autonomous Agent.', 500, 'tiktok', NULL),
  ('creator-youtube', 'creator', 'YouTube Content Drop', 'Submit a YouTube link featuring ZORD Autonomous Agent.', 500, 'youtube', NULL)
ON CONFLICT (id) DO NOTHING;
