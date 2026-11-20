-- Correct the contribution counter so team-only objectives never count as
-- an individual contribution. This is an idempotent function replacement.
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
      count(distinct op.objective_id) filter (where o.id is not null)::integer as verified_contributions
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
          where required_obj.expedition_id = p.expedition_id and required_obj.is_required = true
            and required_obj.completion_scope in ('team','both')
            and not exists (
              select 1 from public.expedition_team_objective_progress tp
              where tp.expedition_id = p.expedition_id and tp.objective_id = required_obj.id
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
revoke all on function public.refresh_expedition_eligibility(uuid) from public, anon, authenticated;
grant execute on function public.refresh_expedition_eligibility(uuid) to service_role;
