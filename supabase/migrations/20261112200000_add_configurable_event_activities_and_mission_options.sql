-- Admin-configurable event activities and mission economy metadata.
-- Preview migration only; this does not issue rewards or charge unlock costs.

ALTER TABLE public.game_events
  ADD COLUMN IF NOT EXISTS activities jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'game_events_activities_array_check'
      AND conrelid = 'public.game_events'::regclass
  ) THEN
    ALTER TABLE public.game_events
      ADD CONSTRAINT game_events_activities_array_check
      CHECK (jsonb_typeof(activities) = 'array');
  END IF;
END
$$;

ALTER TABLE public.mission_tasks
  ADD COLUMN IF NOT EXISTS instructions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reward_currency text NOT NULL DEFAULT 'ZP',
  ADD COLUMN IF NOT EXISTS unlock_cost_zp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mission_tasks_reward_currency_check'
      AND conrelid = 'public.mission_tasks'::regclass
  ) THEN
    ALTER TABLE public.mission_tasks
      ADD CONSTRAINT mission_tasks_reward_currency_check
      CHECK (reward_currency IN ('ZP', 'ZAP'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mission_tasks_unlock_cost_zp_check'
      AND conrelid = 'public.mission_tasks'::regclass
  ) THEN
    ALTER TABLE public.mission_tasks
      ADD CONSTRAINT mission_tasks_unlock_cost_zp_check
      CHECK (unlock_cost_zp >= 0);
  END IF;
END
$$;
