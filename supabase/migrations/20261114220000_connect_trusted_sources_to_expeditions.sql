-- Connect trusted, server-recorded activity to Expedition individual progress.
-- Objective source mapping:
--   game      -> fragment_fixed
--   milestone -> daily_uplink_claim
--   community -> creator_ops_approved
-- A config.trusted_source value may explicitly override the mapping.
-- This migration records verified progress only; it never issues Expedition rewards.

create table if not exists public.expedition_trusted_evidence (
  id uuid primary key default gen_random_uuid(),
  expedition_id uuid not null references public.expeditions(id) on delete cascade,
  objective_id uuid not null references public.expedition_objectives(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  source_type text not null check (source_type in ('fragment_fixed','daily_uplink_claim','creator_ops_approved')),
  source_record_id text not null,
  occurred_at timestamptz not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  unique (objective_id, source_type, source_record_id)
);

create index if not exists expedition_trusted_evidence_player_idx
  on public.expedition_trusted_evidence (expedition_id, player_id, objective_id);

alter table public.expedition_trusted_evidence enable row level security;
revoke all on table public.expedition_trusted_evidence from public, anon, authenticated;
grant select, insert, update, delete on table public.expedition_trusted_evidence to service_role;

create or replace function public.record_trusted_expedition_evidence(
  p_player_id uuid,
  p_source_type text,
  p_source_record_id text,
  p_occurred_at timestamptz,
  p_source_evidence jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_objective record;
  v_evidence_id uuid;
  v_count integer;
  v_changed integer := 0;
  v_expected_source text;
begin
  if p_player_id is null
     or p_source_type not in ('fragment_fixed','daily_uplink_claim','creator_ops_approved')
     or nullif(btrim(p_source_record_id), '') is null
     or p_occurred_at is null
     or jsonb_typeof(coalesce(p_source_evidence, '{}'::jsonb)) <> 'object'
  then
    raise exception 'Invalid trusted Expedition evidence';
  end if;

  for v_objective in
    select o.id as objective_id, o.expedition_id, o.completion_scope,
           o.objective_type, o.config, e.starts_at, e.ends_at, e.status
    from public.expedition_objectives o
    join public.expeditions e on e.id = o.expedition_id
    where e.status = 'active'
      and (e.starts_at is null or p_occurred_at >= e.starts_at)
      and (e.ends_at is null or p_occurred_at <= e.ends_at)
      and o.completion_scope in ('individual','both')
      and coalesce(
        nullif(o.config ->> 'trusted_source',''),
        case o.objective_type
          when 'game' then 'fragment_fixed'
          when 'milestone' then 'daily_uplink_claim'
          when 'community' then 'creator_ops_approved'
          else null
        end
      ) = p_source_type
      and exists (
        select 1
        from public.expedition_participations p
        where p.expedition_id = o.expedition_id
          and p.player_id = p_player_id
          and p.status <> 'withdrawn'
          and p.registered_at <= p_occurred_at
      )
  loop
    v_evidence_id := null;
    insert into public.expedition_trusted_evidence (
      expedition_id, objective_id, player_id, source_type,
      source_record_id, occurred_at, evidence
    ) values (
      v_objective.expedition_id, v_objective.objective_id, p_player_id,
      p_source_type, p_source_record_id, p_occurred_at,
      coalesce(p_source_evidence, '{}'::jsonb)
    )
    on conflict (objective_id, source_type, source_record_id) do nothing
    returning id into v_evidence_id;

    if v_evidence_id is null then
      continue;
    end if;

    select count(*)::integer into v_count
    from public.expedition_trusted_evidence te
    where te.objective_id = v_objective.objective_id
      and te.player_id = p_player_id;

    insert into public.expedition_objective_progress (
      expedition_id, objective_id, player_id, status,
      contribution_count, evidence, verified_by, verified_at
    ) values (
      v_objective.expedition_id, v_objective.objective_id, p_player_id,
      'verified', v_count,
      jsonb_build_object(
        'method', 'trusted_server_source',
        'sourceType', p_source_type,
        'latestSourceRecordId', p_source_record_id,
        'latestOccurredAt', p_occurred_at,
        'trustedEvidenceCount', v_count
      ),
      'trusted_system:' || p_source_type,
      now()
    )
    on conflict (objective_id, player_id) do update
      set status = 'verified',
          contribution_count = excluded.contribution_count,
          evidence = excluded.evidence,
          verified_by = excluded.verified_by,
          verified_at = coalesce(public.expedition_objective_progress.verified_at, excluded.verified_at),
          updated_at = now();

    insert into public.expedition_audit_log (
      expedition_id, actor, action, before_state, after_state
    ) values (
      v_objective.expedition_id,
      'trusted_system:' || p_source_type,
      'objective_individual_auto_verified',
      jsonb_build_object('objective_id', v_objective.objective_id),
      jsonb_build_object(
        'objective_id', v_objective.objective_id,
        'player_id', p_player_id,
        'source_type', p_source_type,
        'source_record_id', p_source_record_id,
        'verified_at', now()
      )
    );

    perform public.refresh_expedition_eligibility(v_objective.expedition_id);
    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$function$;

create or replace function public.on_expedition_fragment_fixed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.action_type = 'fragment_fixed' then
    perform public.record_trusted_expedition_evidence(
      new.player_id, 'fragment_fixed', new.id::text, new.created_at,
      jsonb_build_object('fragmentId', new.fragment_id, 'actionEventId', new.id)
    );
  end if;
  return new;
end;
$function$;

create or replace function public.on_expedition_daily_uplink_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.record_trusted_expedition_evidence(
    new.player_id, 'daily_uplink_claim',
    new.player_id::text || ':' || new.claim_date::text,
    new.claimed_at,
    jsonb_build_object('claimDate', new.claim_date, 'rewardZp', new.reward_zp)
  );
  return new;
end;
$function$;

create or replace function public.on_expedition_creator_ops_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'approved'
     and new.reviewed_at is not null
     and new.player_id is not null then
    if tg_op = 'INSERT' or old.status is distinct from 'approved' then
      perform public.record_trusted_expedition_evidence(
        new.player_id, 'creator_ops_approved', new.id::text, new.reviewed_at,
        jsonb_build_object(
          'submissionId', new.id,
          'missionId', new.mission_id,
          'platform', new.platform,
          'contentId', new.content_id,
          'reviewedAt', new.reviewed_at
        )
      );
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists expedition_fragment_fix_evidence on public.gameplay_action_events;
create trigger expedition_fragment_fix_evidence
after insert on public.gameplay_action_events
for each row execute function public.on_expedition_fragment_fixed();

drop trigger if exists expedition_daily_uplink_evidence on public.daily_uplink_claims;
create trigger expedition_daily_uplink_evidence
after insert on public.daily_uplink_claims
for each row execute function public.on_expedition_daily_uplink_claim();

drop trigger if exists expedition_creator_ops_approval_evidence on public.creator_ops_submissions;
create trigger expedition_creator_ops_approval_evidence
after insert or update of status, reviewed_at on public.creator_ops_submissions
for each row execute function public.on_expedition_creator_ops_approved();

revoke all on function public.record_trusted_expedition_evidence(uuid,text,text,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.on_expedition_fragment_fixed() from public, anon, authenticated;
revoke all on function public.on_expedition_daily_uplink_claim() from public, anon, authenticated;
revoke all on function public.on_expedition_creator_ops_approved() from public, anon, authenticated;
grant execute on function public.record_trusted_expedition_evidence(uuid,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.on_expedition_fragment_fixed() to service_role;
grant execute on function public.on_expedition_daily_uplink_claim() to service_role;
grant execute on function public.on_expedition_creator_ops_approved() to service_role;
