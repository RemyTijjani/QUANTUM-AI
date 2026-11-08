/*
# Allow public read of the mission catalog

## Changes
- Grants SELECT on `mission_tasks` to the anon role and adds a read-only policy for it,
  so the app can list missions before a player has signed in.

## Security
- Only SELECT is granted to anon; no write access is opened.
- The mission catalog contains no per-player data, so public read is intentional.
*/

GRANT SELECT ON public.mission_tasks TO anon;

DROP POLICY IF EXISTS "select_mission_tasks_public" ON public.mission_tasks;
CREATE POLICY "select_mission_tasks_public" ON public.mission_tasks
  FOR SELECT
  TO anon
  USING (true);
