-- Authoritative per-player Task-to-Earn status and counter summary.
-- Reads only published, free missions and derives completion from trusted records.

create or replace function public.get_player_mission_task_statuses()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_player_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_player_id is null then
    raise exception 'Authentication required';
  end if;

  with visible_tasks as (
    select
      mt.id,
      case
        when mt.kind = 'daily' and mt.id = 'daily-uplink' then
          case when exists (
            select 1 from public.daily_uplink_claims c
            where c.player_id = v_player_id
              and c.claim_date = (now() at time zone 'utc')::date
          ) then 'claimed' else 'ready' end
        when mt.kind = 'daily' and mt.id = 'agent-uptime' then
          case
            when exists (
              select 1 from public.agent_uptime_mission_claims c
              where c.player_id = v_player_id
                and c.claim_date = (now() at time zone 'utc')::date
            ) then 'claimed'
            when exists (
              select 1 from public.player_agent_rentals r
              where r.player_id = v_player_id
                and r.status = 'active'
                and r.starts_at <= now() - interval '12 hours'
                and r.expires_at > now()
            ) then 'ready'
            else 'locked'
          end
        when mt.kind = 'social' and nullif(trim(mt.telegram_chat_id), '') is not null then
          case when exists (
            select 1 from public.telegram_mission_claims c
            where c.player_id = v_player_id and c.mission_id = mt.id
          ) then 'claimed' else 'ready' end
        when mt.kind = 'creator' then
          case
            when exists (
              select 1 from public.creator_ops_submissions s
              where s.player_id = v_player_id and s.mission_id = mt.id
                and s.status = 'approved'
            ) then 'claimed'
            when exists (
              select 1 from public.creator_ops_submissions s
              where s.player_id = v_player_id and s.mission_id = mt.id
                and s.status = 'pending'
            ) then 'pending'
            else 'ready'
          end
        else 'locked'
      end as player_status
    from public.mission_tasks mt
    where mt.status = 'published'
      and mt.kind in ('daily', 'social', 'creator')
      and mt.reward_currency in ('ZP', 'ZAP')
      and mt.unlock_cost_zp = 0
      and mt.reward > 0
  ),
  summary as (
    select
      count(*)::integer as total,
      count(*) filter (where player_status = 'ready')::integer as ready,
      count(*) filter (where player_status = 'claimed')::integer as claimed
    from visible_tasks
  )
  select jsonb_build_object(
    'available', greatest(0, summary.total - summary.claimed),
    'ready', summary.ready,
    'claimed', summary.claimed,
    'statuses', coalesce((
      select jsonb_object_agg(id, player_status) from visible_tasks
    ), '{}'::jsonb)
  )
  into v_result
  from summary;

  return coalesce(v_result, jsonb_build_object(
    'available', 0, 'ready', 0, 'claimed', 0, 'statuses', '{}'::jsonb
  ));
end;
$function$;

revoke all on function public.get_player_mission_task_statuses() from public, anon;
grant execute on function public.get_player_mission_task_statuses() to authenticated, service_role;
