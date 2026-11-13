-- Allow approved Creator Ops activities to reference the exact mission they verify.
-- The original constraint only allowed mission_id for activity_type='mission',
-- which caused Creator Ops activity inserts to fail at the database layer.
alter table public.game_event_activities
  drop constraint if exists game_event_activities_mission_type_check;

alter table public.game_event_activities
  add constraint game_event_activities_mission_type_check
  check (
    (
      activity_type in ('mission', 'creator_submission_approved')
      and mission_id is not null
    )
    or
    (
      activity_type not in ('mission', 'creator_submission_approved')
      and mission_id is null
    )
  );
