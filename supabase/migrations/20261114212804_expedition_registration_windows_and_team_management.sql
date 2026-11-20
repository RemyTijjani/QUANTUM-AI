-- Stage 6: Expedition registration windows, automatic lifecycle transitions,
-- and secure service-role team management for the Preview project.

alter table public.expeditions
  add column registration_opens_at timestamptz,
  add column registration_closes_at timestamptz;

alter table public.expeditions
  add constraint expeditions_registration_opens_before_start
    check (registration_opens_at is null or (starts_at is not null and registration_opens_at < starts_at)),
  add constraint expeditions_registration_closes_before_start
    check (registration_closes_at is null or (starts_at is not null and registration_closes_at <= starts_at)),
  add constraint expeditions_registration_window_order
    check (registration_opens_at is null or registration_closes_at is null or registration_closes_at >= registration_opens_at);

create index expeditions_scheduled_lifecycle_idx
  on public.expeditions(status, starts_at, ends_at);

create or replace function public.advance_expedition_lifecycle()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_next_status text;
  v_changed integer := 0;
begin
  for v_row in
    select e.id, e.status, e.starts_at, e.ends_at,
           e.registration_opens_at, e.registration_closes_at
    from public.expeditions e
    where
      (e.status = 'scheduled' and e.starts_at is not null
        and (
          e.starts_at <= now()
          or (coalesce(e.registration_opens_at, e.starts_at) <= now() and e.starts_at > now())
        ))
      or (e.status = 'registration_open' and e.starts_at is not null and e.starts_at <= now())
      or (e.status = 'active' and e.ends_at is not null and e.ends_at <= now())
    order by e.starts_at nulls last, e.id
    for update skip locked
  loop
    v_next_status := case
      when v_row.status = 'active' and v_row.ends_at <= now() then 'completed'
      when v_row.starts_at <= now() then 'active'
      else 'registration_open'
    end;

    update public.expeditions
    set status = v_next_status, updated_at = now()
    where id = v_row.id;

    insert into public.expedition_audit_log
      (expedition_id, actor, action, before_state, after_state)
    values
      (
        v_row.id,
        'system:expedition_scheduler',
        'lifecycle_' || v_next_status,
        jsonb_build_object('status', v_row.status),
        jsonb_build_object('status', v_next_status, 'changed_at', now())
      );

    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$$;

create or replace function public.create_expedition_team(
  p_expedition_id uuid,
  p_player_id uuid,
  p_team_name text,
  p_invite_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expedition public.expeditions%rowtype;
  v_team_id uuid;
  v_participation_id uuid;
begin
  if p_player_id is null or p_expedition_id is null then
    raise exception 'Expedition and player are required';
  end if;
  if p_team_name is null or length(btrim(p_team_name)) not between 1 and 80 then
    raise exception 'Team name must be between 1 and 80 characters';
  end if;
  if p_invite_code is null or p_invite_code !~ '^[A-F0-9]{16}$' then
    raise exception 'Invalid invite code format';
  end if;

  select * into v_expedition
  from public.expeditions e
  where e.id = p_expedition_id
  for update;

  if not found then raise exception 'Expedition not found'; end if;
  if v_expedition.participation_mode not in ('team', 'both') then
    raise exception 'This Expedition does not allow team participation';
  end if;
  if v_expedition.status not in ('scheduled', 'registration_open')
    or v_expedition.starts_at is null or v_expedition.starts_at <= now()
    or (v_expedition.registration_opens_at is not null and v_expedition.registration_opens_at > now())
    or (v_expedition.registration_closes_at is not null and v_expedition.registration_closes_at <= now()) then
    raise exception 'Team registration is not open';
  end if;

  insert into public.expedition_teams
    (expedition_id, name, invite_code, leader_player_id)
  values
    (p_expedition_id, btrim(p_team_name), p_invite_code, p_player_id)
  returning id into v_team_id;

  insert into public.expedition_team_members
    (expedition_id, team_id, player_id, role, membership_status)
  values
    (p_expedition_id, v_team_id, p_player_id, 'leader', 'active');

  insert into public.expedition_participations
    (expedition_id, player_id, team_id, status)
  values
    (p_expedition_id, p_player_id, v_team_id, 'registered')
  on conflict (expedition_id, player_id) do update
    set team_id = excluded.team_id, status = 'registered', updated_at = now()
    where public.expedition_participations.team_id is null
      and public.expedition_participations.status in ('registered', 'withdrawn')
  returning id into v_participation_id;

  if v_participation_id is null then
    raise exception 'Player is already registered for this Expedition';
  end if;

  insert into public.expedition_audit_log
    (expedition_id, actor, action, after_state)
  values
    (p_expedition_id, 'player:' || p_player_id::text, 'team_created',
     jsonb_build_object('team_id', v_team_id, 'team_name', btrim(p_team_name)));

  return jsonb_build_object(
    'team_id', v_team_id,
    'expedition_id', p_expedition_id,
    'team_name', btrim(p_team_name),
    'invite_code', p_invite_code,
    'role', 'leader'
  );
end;
$$;

create or replace function public.join_expedition_team(
  p_invite_code text,
  p_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expedition_id uuid;
  v_expedition public.expeditions%rowtype;
  v_team public.expedition_teams%rowtype;
  v_member_count integer;
  v_existing_team_id uuid;
  v_participation_id uuid;
begin
  if p_player_id is null or p_invite_code is null then
    raise exception 'Player and invite code are required';
  end if;

  select t.expedition_id into v_expedition_id
  from public.expedition_teams t
  where t.invite_code = upper(btrim(p_invite_code)) and t.status = 'active';

  if v_expedition_id is null then raise exception 'Invalid or inactive team invite'; end if;

  select * into v_expedition
  from public.expeditions e
  where e.id = v_expedition_id
  for update;

  if not found then raise exception 'Expedition not found'; end if;
  if v_expedition.participation_mode not in ('team', 'both') then
    raise exception 'This Expedition does not allow team participation';
  end if;
  if v_expedition.status not in ('scheduled', 'registration_open')
    or v_expedition.starts_at is null or v_expedition.starts_at <= now()
    or (v_expedition.registration_opens_at is not null and v_expedition.registration_opens_at > now())
    or (v_expedition.registration_closes_at is not null and v_expedition.registration_closes_at <= now()) then
    raise exception 'Team registration is not open';
  end if;

  select * into v_team
  from public.expedition_teams t
  where t.expedition_id = v_expedition_id
    and t.invite_code = upper(btrim(p_invite_code))
    and t.status = 'active'
  for update;

  if not found then raise exception 'Invalid or inactive team invite'; end if;

  select m.team_id into v_existing_team_id
  from public.expedition_team_members m
  where m.expedition_id = v_expedition_id
    and m.player_id = p_player_id
    and m.membership_status = 'active';

  if v_existing_team_id = v_team.id then
    return jsonb_build_object('team_id', v_team.id, 'expedition_id', v_expedition_id, 'joined', true, 'already_member', true);
  elsif v_existing_team_id is not null then
    raise exception 'Player already belongs to another team in this Expedition';
  end if;

  select count(*)::integer into v_member_count
  from public.expedition_team_members m
  where m.team_id = v_team.id and m.membership_status = 'active';

  if v_member_count >= v_expedition.max_team_size then
    raise exception 'This team is full';
  end if;

  insert into public.expedition_participations
    (expedition_id, player_id, team_id, status)
  values
    (v_expedition_id, p_player_id, v_team.id, 'registered')
  on conflict (expedition_id, player_id) do update
    set team_id = excluded.team_id, status = 'registered', updated_at = now()
    where public.expedition_participations.team_id is null
      and public.expedition_participations.status in ('registered', 'withdrawn')
  returning id into v_participation_id;

  if v_participation_id is null then
    raise exception 'Player is already registered for this Expedition';
  end if;

  update public.expedition_team_members
  set team_id = v_team.id, role = 'member', membership_status = 'active', joined_at = now(), left_at = null
  where expedition_id = v_expedition_id and player_id = p_player_id;

  if not found then
    insert into public.expedition_team_members
      (expedition_id, team_id, player_id, role, membership_status)
    values
      (v_expedition_id, v_team.id, p_player_id, 'member', 'active');
  end if;

  insert into public.expedition_audit_log
    (expedition_id, actor, action, after_state)
  values
    (v_expedition_id, 'player:' || p_player_id::text, 'team_joined',
     jsonb_build_object('team_id', v_team.id));

  return jsonb_build_object('team_id', v_team.id, 'expedition_id', v_expedition_id, 'joined', true, 'already_member', false);
end;
$$;

create or replace function public.leave_expedition_team(
  p_expedition_id uuid,
  p_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expedition public.expeditions%rowtype;
  v_team public.expedition_teams%rowtype;
  v_member public.expedition_team_members%rowtype;
  v_member_count integer;
begin
  select * into v_expedition
  from public.expeditions e
  where e.id = p_expedition_id
  for update;

  if not found then raise exception 'Expedition not found'; end if;
  if v_expedition.status not in ('scheduled', 'registration_open')
    or v_expedition.starts_at is null or v_expedition.starts_at <= now()
    or (v_expedition.registration_closes_at is not null and v_expedition.registration_closes_at <= now()) then
    raise exception 'Team membership is locked';
  end if;

  select * into v_member
  from public.expedition_team_members m
  where m.expedition_id = p_expedition_id
    and m.player_id = p_player_id
    and m.membership_status = 'active';

  if not found then raise exception 'Player is not an active team member'; end if;

  select * into v_team
  from public.expedition_teams t
  where t.id = v_member.team_id and t.expedition_id = p_expedition_id
  for update;

  select count(*)::integer into v_member_count
  from public.expedition_team_members m
  where m.team_id = v_team.id and m.membership_status = 'active';

  if v_member.role = 'leader' and v_member_count > 1 then
    raise exception 'Team leader must transfer leadership before leaving';
  end if;

  update public.expedition_team_members
  set membership_status = 'left', left_at = now()
  where id = v_member.id;

  if v_member.role = 'leader' then
    update public.expedition_teams set status = 'disbanded', updated_at = now()
    where id = v_team.id;
  end if;

  update public.expedition_participations
  set team_id = null, status = 'registered', updated_at = now()
  where expedition_id = p_expedition_id and player_id = p_player_id;

  insert into public.expedition_audit_log
    (expedition_id, actor, action, before_state, after_state)
  values
    (p_expedition_id, 'player:' || p_player_id::text, 'team_left',
     jsonb_build_object('team_id', v_team.id),
     jsonb_build_object('team_id', null, 'membership_status', 'left'));

  return jsonb_build_object('expedition_id', p_expedition_id, 'team_id', v_team.id, 'left', true);
end;
$$;

revoke all on function public.advance_expedition_lifecycle() from public, anon, authenticated;
revoke all on function public.create_expedition_team(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.join_expedition_team(text, uuid) from public, anon, authenticated;
revoke all on function public.leave_expedition_team(uuid, uuid) from public, anon, authenticated;

grant execute on function public.advance_expedition_lifecycle() to service_role;
grant execute on function public.create_expedition_team(uuid, uuid, text, text) to service_role;
grant execute on function public.join_expedition_team(text, uuid) to service_role;
grant execute on function public.leave_expedition_team(uuid, uuid) to service_role;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'advance-expedition-lifecycle'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'advance-expedition-lifecycle',
    '* * * * *',
    'select public.advance_expedition_lifecycle();'
  );
end;
$$;
