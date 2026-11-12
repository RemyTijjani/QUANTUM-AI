-- Stage 6: player registrations and server-owned event participation state.
create table if not exists public.game_event_participations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.game_events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'registered'
    check (status in ('registered', 'in_progress', 'completed', 'submitted', 'withdrawn')),
  progress jsonb not null default '{}'::jsonb
    check (jsonb_typeof(progress) = 'object'),
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (event_id, player_id)
);

create index if not exists game_event_participations_player_idx
  on public.game_event_participations (player_id, registered_at desc);
create index if not exists game_event_participations_event_idx
  on public.game_event_participations (event_id, registered_at desc);

alter table public.game_event_participations enable row level security;

revoke all on public.game_event_participations from anon, authenticated;
grant select on public.game_event_participations to authenticated;
grant select, insert, update, delete on public.game_event_participations to service_role;

drop policy if exists "Players can read their own event participation"
  on public.game_event_participations;
create policy "Players can read their own event participation"
  on public.game_event_participations
  for select
  to authenticated
  using (player_id = (select auth.uid()));
