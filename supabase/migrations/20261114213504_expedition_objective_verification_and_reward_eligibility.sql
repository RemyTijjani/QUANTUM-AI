-- Stage 6: server-side objective verification, individual eligibility,
-- team shared-objective checks, and idempotent pending reward preparation.
alter table public.expedition_objectives
  add column if not exists completion_scope text not null default 'individual';
alter table public.expedition_objectives
  drop constraint if exists expedition_objectives_completion_scope_check;
alter table public.expedition_objectives
  add constraint expedition_objectives_completion_scope_check
  check (completion_scope in ('individual','team','both'));

create index if not exists expedition_objective_progress_review_idx
  on public.expedition_objective_progress (expedition_id, status, created_at)
  where status = 'submitted';
create index if not exists expedition_team_objective_progress_review_idx
  on public.expedition_team_objective_progress (expedition_id, status, created_at)
  where status = 'submitted';

create or replace function public.refresh_expedition_eligibility(p_expedition_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $function$
declare v_min_contributions integer; v_changed integer := 0;
begin
  select e.min_individual_contributions into v_min_contributions
  from public.expeditions e where e.id = p_expedition_id for update;
  if not found then raise exception 'Expedition not found'; end if;

  with contribution_counts as (
    select p.id as participation_id,
      count(distinct op.objective_id)::integer as verified_contributions
    from public.expedition_participations p
    left join public.expedition_objective_progress op
      on op.expedition_id = p.expedition_id and op.player_id = p.player_id and op.status = 'verified'
    left join public.expedition_objectives o
      on o.id = op.objective_id and o.completion_scope in ('individual','both')
    where p.expedition_id = p_expedition_id and p.status <> 'withdrawn'
    group by p.id
  ),
  eligibility as (
    select p.id, coalesce(c.verified_contributions,0) as verified_contributions,
      (coalesce(c.verified_contributions,0) >= v_min_contributions and (
        p.team_id is null or not exists (
          select 1 from public.expedition_objectives required_obj
          where required_obj.expedition_id = p.expedition_id
            and required_obj.is_required = true
            and required_obj.completion_scope in ('team','both')
            and not exists (
              select 1 from public.expedition_team_objective_progress tp
              where tp.expedition_id = p.expedition_id
                and tp.objective_id = required_obj.id
                and tp.team_id = p.team_id and tp.status = 'verified'
            )
        )
      )) as is_eligible
    from public.expedition_participations p
    left join contribution_counts c on c.participation_id = p.id
    where p.expedition_id = p_expedition_id and p.status <> 'withdrawn'
  )
  update public.expedition_participations p
  set individual_contribution_count = e.verified_contributions,
      reward_eligible = e.is_eligible,
      status = case when e.is_eligible then 'eligible'
                    when p.status = 'eligible' then 'in_progress' else p.status end,
      completed_at = case when e.is_eligible then coalesce(p.completed_at, now()) else null end,
      updated_at = now()
  from eligibility e
  where p.id = e.id and (
    p.individual_contribution_count is distinct from e.verified_contributions
    or p.reward_eligible is distinct from e.is_eligible
    or (e.is_eligible and p.status <> 'eligible')
  );
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$function$;

create or replace function public.admin_review_expedition_objective(
  p_progress_id uuid, p_scope text, p_decision text, p_actor text, p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_expedition_id uuid; v_objective_id uuid; v_player_id uuid; v_team_id uuid;
  v_old_status text; v_changed integer := 0;
begin
  if p_scope not in ('individual','team') then raise exception 'Invalid progress scope'; end if;
  if p_decision not in ('verified','rejected') then raise exception 'Decision must be verified or rejected'; end if;
  if nullif(btrim(p_actor), '') is null or length(p_actor) > 120 then raise exception 'A valid admin actor is required'; end if;
  if p_reason is not null and length(p_reason) > 500 then raise exception 'Review reason must be 500 characters or fewer'; end if;

  if p_scope = 'individual' then
    select progress.expedition_id, progress.objective_id, progress.player_id, progress.status
    into v_expedition_id, v_objective_id, v_player_id, v_old_status
    from public.expedition_objective_progress progress where progress.id = p_progress_id for update;
  else
    select progress.expedition_id, progress.objective_id, progress.team_id, progress.status
    into v_expedition_id, v_objective_id, v_team_id, v_old_status
    from public.expedition_team_objective_progress progress where progress.id = p_progress_id for update;
  end if;
  if v_expedition_id is null then raise exception 'Objective submission not found'; end if;
  if v_old_status <> 'submitted' then raise exception 'Only submitted objectives can be reviewed'; end if;

  if p_scope = 'individual' then
    update public.expedition_objective_progress
    set status = p_decision,
      verified_by = case when p_decision = 'verified' then 'admin:' || btrim(p_actor) else null end,
      verified_at = case when p_decision = 'verified' then now() else null end,
      updated_at = now()
    where id = p_progress_id;
  else
    update public.expedition_team_objective_progress
    set status = p_decision,
      verified_by = case when p_decision = 'verified' then 'admin:' || btrim(p_actor) else null end,
      verified_at = case when p_decision = 'verified' then now() else null end,
      updated_at = now()
    where id = p_progress_id;
  end if;

  insert into public.expedition_audit_log (expedition_id, actor, action, reason, before_state, after_state)
  values (v_expedition_id, 'admin:' || btrim(p_actor), 'objective_' || p_scope || '_' || p_decision,
    nullif(btrim(coalesce(p_reason,'')), ''),
    jsonb_build_object('progress_id',p_progress_id,'objective_id',v_objective_id,'status',v_old_status),
    jsonb_build_object('progress_id',p_progress_id,'objective_id',v_objective_id,
      'player_id',v_player_id,'team_id',v_team_id,'status',p_decision,'reviewed_at',now()));
  v_changed := public.refresh_expedition_eligibility(v_expedition_id);
  return jsonb_build_object('success',true,'expedition_id',v_expedition_id,'objective_id',v_objective_id,
    'decision',p_decision,'eligibility_rows_updated',v_changed);
end;
$function$;

create or replace function public.prepare_expedition_reward_issuances(p_expedition_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $function$
declare
  v_status text; v_reward_id uuid; v_reward_type text; v_amount numeric; v_inserted integer := 0;
begin
  select e.status into v_status from public.expeditions e where e.id = p_expedition_id for update;
  if not found then raise exception 'Expedition not found'; end if;
  if v_status <> 'completed' then raise exception 'Rewards can only be prepared after the Expedition is completed'; end if;
  perform public.refresh_expedition_eligibility(p_expedition_id);
  select r.id, r.reward_type, r.amount into v_reward_id, v_reward_type, v_amount
  from public.expedition_rewards r where r.expedition_id = p_expedition_id;
  if v_reward_id is null or v_reward_type = 'none' or v_amount <= 0 then return 0; end if;

  insert into public.expedition_reward_issuances
    (expedition_id, reward_id, player_id, reward_type, amount, status, idempotency_key)
  select p_expedition_id, v_reward_id, p.player_id, v_reward_type, v_amount, 'pending',
    'expedition:' || v_reward_id::text || ':' || p.player_id::text
  from public.expedition_participations p
  where p.expedition_id = p_expedition_id and p.reward_eligible = true and p.status = 'eligible'
  on conflict (reward_id, player_id) do nothing;
  get diagnostics v_inserted = row_count;

  insert into public.expedition_audit_log (expedition_id, actor, action, after_state)
  values (p_expedition_id, 'system:reward-preparation', 'reward_issuances_prepared',
    jsonb_build_object('new_pending_issuances',v_inserted,'reward_type',v_reward_type,'amount_per_player',v_amount));
  return v_inserted;
end;
$function$;

revoke all on function public.refresh_expedition_eligibility(uuid) from public, anon, authenticated;
revoke all on function public.admin_review_expedition_objective(uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.prepare_expedition_reward_issuances(uuid) from public, anon, authenticated;
grant execute on function public.refresh_expedition_eligibility(uuid) to service_role;
grant execute on function public.admin_review_expedition_objective(uuid,text,text,text,text) to service_role;
grant execute on function public.prepare_expedition_reward_issuances(uuid) to service_role;
