-- Store event participation instructions as ordinary text, not JSON.
-- Existing JSON values are converted to their textual representation.
alter table public.game_events
  drop constraint if exists game_events_participation_rules_check;

alter table public.game_events
  alter column participation_rules drop default;

alter table public.game_events
  alter column participation_rules type text
  using participation_rules::text;

alter table public.game_events
  alter column participation_rules set default '';

alter table public.game_events
  alter column participation_rules set not null;
