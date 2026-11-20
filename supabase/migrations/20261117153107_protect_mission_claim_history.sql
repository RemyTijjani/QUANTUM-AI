-- Preserve task claim history if an admin archives or attempts to remove a mission.
-- The Admin API now archives tasks; this FK is defense-in-depth against accidental hard deletion.

alter table public.telegram_mission_claims
  drop constraint if exists telegram_mission_claims_mission_id_fkey;

alter table public.telegram_mission_claims
  add constraint telegram_mission_claims_mission_id_fkey
  foreign key (mission_id)
  references public.mission_tasks(id)
  on delete restrict;
