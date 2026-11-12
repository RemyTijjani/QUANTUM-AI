-- Stage 6: persist administrator review history for event participant status changes.
create table if not exists public.game_event_participation_audit (
  id uuid primary key default gen_random_uuid(),
  participation_id uuid references public.game_event_participations(id) on delete set null,
  event_id uuid references public.game_events(id) on delete set null,
  player_id uuid references public.players(id) on delete set null,
  previous_status text not null,
  new_status text not null
    check (new_status in ('registered', 'in_progress', 'submitted', 'completed', 'withdrawn')),
  admin_actor text not null,
  created_at timestamptz not null default now()
);

create index if not exists game_event_participation_audit_event_idx
  on public.game_event_participation_audit (event_id, created_at desc);
create index if not exists game_event_participation_audit_participation_idx
  on public.game_event_participation_audit (participation_id, created_at desc);

alter table public.game_event_participation_audit enable row level security;
revoke all on public.game_event_participation_audit from anon, authenticated;
grant select, insert on public.game_event_participation_audit to service_role;

create or replace function public.admin_update_event_participant_status(
  p_participation_id uuid,
  p_status text,
  p_admin_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_participation public.game_event_participations%rowtype;
  updated_participation public.game_event_participations%rowtype;
begin
  if p_status not in ('registered', 'in_progress', 'submitted', 'completed', 'withdrawn') then
    raise exception 'Invalid participant status';
  end if;

  if p_admin_actor is null or length(trim(p_admin_actor)) = 0 then
    raise exception 'Admin actor is required';
  end if;

  select *
    into current_participation
    from public.game_event_participations
    where id = p_participation_id
    for update;

  if not found then
    return null;
  end if;

  update public.game_event_participations
    set status = p_status,
        completed_at = case when p_status = 'completed' then now() else null end,
        updated_at = now()
    where id = p_participation_id
    returning * into updated_participation;

  insert into public.game_event_participation_audit (
    participation_id, event_id, player_id, previous_status, new_status, admin_actor
  ) values (
    updated_participation.id,
    updated_participation.event_id,
    updated_participation.player_id,
    current_participation.status,
    updated_participation.status,
    trim(p_admin_actor)
  );

  return jsonb_build_object(
    'id', updated_participation.id,
    'status', updated_participation.status,
    'updated_at', updated_participation.updated_at,
    'completed_at', updated_participation.completed_at
  );
end;
$$;

revoke all on function public.admin_update_event_participant_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_update_event_participant_status(uuid, text, text) to service_role;
