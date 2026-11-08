/*
# Allow public read of the mission catalog

1. Changes
- Adds a read-only policy on `mission_tasks` so the app can list missions before a player has signed in (for example in preview or before Telegram login completes).

2. Security
- Only SELECT is granted to anon through this policy; no write access is opened.
- The mission catalog contains no per-player data, so public read is intentional.

3. Notes
- The existing authenticated SELECT policy is unchanged.
*/

DROP POLICY IF EXISTS "select_mission_tasks_public" ON public.mission_tasks;
CREATE POLICY "select_mission_tasks_public" ON public.mission_tasks
  FOR SELECT
  TO anon
  USING (true);
