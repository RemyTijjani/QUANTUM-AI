-- Event capacity controls and safe, bounded bulk Creator Ops approval.
alter table public.game_events
  add column if not exists min_participants integer,
  add column if not exists max_participants integer;

alter table public.game_events
  drop constraint if exists game_events_participant_limits_check;

alter table public.game_events
  add constraint game_events_participant_limits_check
  check (
    (min_participants is null or min_participants >= 1)
    and (max_participants is null or max_participants >= 1)
    and (min_participants is null or max_participants is null or min_participants <= max_participants)
  );

-- Registration is serialized per event so concurrent requests cannot exceed max_participants.
create or replace function public.register_for_game_event(
  p_event_id uuid,
  p_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.game_events%rowtype;
  v_existing public.game_event_participations%rowtype;
  v_count integer;
  v_has_existing boolean := false;
  v_inserted public.game_event_participations%rowtype;
begin
  select * into v_event
  from public.game_events
  where id = p_event_id
  for update;

  if not found or v_event.status <> 'published'
     or v_event.starts_at is null or v_event.ends_at is null
     or v_event.ends_at <= now() then
    return jsonb_build_object('success', false, 'reason', 'event_closed');
  end if;

  select * into v_existing
  from public.game_event_participations
  where event_id = p_event_id and player_id = p_player_id;
  v_has_existing := found;

  if v_has_existing and v_existing.status <> 'withdrawn' then
    return jsonb_build_object(
      'success', true,
      'alreadyRegistered', true,
      'participation', to_jsonb(v_existing)
    );
  end if;

  select count(*)::integer into v_count
  from public.game_event_participations
  where event_id = p_event_id and status <> 'withdrawn';

  if v_event.max_participants is not null and v_count >= v_event.max_participants then
    return jsonb_build_object(
      'success', false,
      'reason', 'event_full',
      'participantCount', v_count,
      'maxParticipants', v_event.max_participants
    );
  end if;

  if v_has_existing then
    update public.game_event_participations
      set status = 'registered', progress = '{}'::jsonb,
          registered_at = now(), updated_at = now(), completed_at = null
      where id = v_existing.id
      returning * into v_inserted;
  else
    insert into public.game_event_participations (event_id, player_id)
      values (p_event_id, p_player_id)
      returning * into v_inserted;
  end if;

  return jsonb_build_object(
    'success', true,
    'alreadyRegistered', false,
    'participation', to_jsonb(v_inserted),
    'participantCount', v_count + 1
  );
end;
$$;

revoke all on function public.register_for_game_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_for_game_event(uuid, uuid) to service_role;

-- Each selected submission is reviewed through the existing atomic review function.
-- Per-item exception blocks isolate failures while preserving successful approvals.
create or replace function public.admin_bulk_approve_creator_submissions(
  p_submission_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_approved integer := 0;
  v_failed integer := 0;
begin
  if p_submission_ids is null or cardinality(p_submission_ids) < 1
     or cardinality(p_submission_ids) > 100 then
    raise exception 'Select between 1 and 100 submissions';
  end if;

  for v_id in
    select distinct item
    from unnest(p_submission_ids) as item
  loop
    begin
      v_result := public.admin_review_creator_submission(v_id, 'approved');
      if coalesce((v_result->>'success')::boolean, false) then
        v_approved := v_approved + 1;
        v_results := v_results || jsonb_build_array(
          jsonb_build_object('submissionId', v_id, 'success', true, 'rewardZp', coalesce((v_result->>'rewardZp')::bigint, 0))
        );
      else
        v_failed := v_failed + 1;
        v_results := v_results || jsonb_build_array(
          jsonb_build_object('submissionId', v_id, 'success', false, 'reason', 'not_pending_or_review_failed')
        );
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object('submissionId', v_id, 'success', false, 'reason', 'review_failed')
      );
    end;
  end loop;

  return jsonb_build_object(
    'success', true,
    'approvedCount', v_approved,
    'failedCount', v_failed,
    'results', v_results
  );
end;
$$;

revoke all on function public.admin_bulk_approve_creator_submissions(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_bulk_approve_creator_submissions(uuid[]) to service_role;
