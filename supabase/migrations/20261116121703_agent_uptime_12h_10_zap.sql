-- Stage 5: verified Agent Uptime mission (12 continuous hours -> 10 ZAP).
-- The reward is issued only by the service-role claim path after checking a live rental.

update public.mission_tasks
set title = 'Agent Uptime',
    description = 'Keep a paid ZORD agent continuously active for 12 hours.',
    reward = 10,
    reward_currency = 'ZAP',
    unlock_cost_zp = 0,
    status = 'published',
    requirements = jsonb_build_array(jsonb_build_object(
      'type', 'active_agent_rental',
      'continuous_hours', 12
    )),
    objectives = jsonb_build_array(jsonb_build_object(
      'type', 'verified_agent_uptime',
      'continuous_hours', 12
    )),
    updated_at = now()
where id = 'agent-uptime'
  and kind = 'daily';

create table if not exists public.agent_uptime_mission_claims (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  claim_date date not null,
  rental_id uuid not null references public.player_agent_rentals(id),
  rental_started_at timestamptz not null,
  reward_zap numeric(18, 6) not null check (reward_zap = 10),
  claimed_at timestamptz not null default now(),
  unique (player_id, claim_date)
);

alter table public.agent_uptime_mission_claims enable row level security;
revoke all on public.agent_uptime_mission_claims from public, anon, authenticated;
grant all on public.agent_uptime_mission_claims to service_role;

create or replace function public.claim_agent_uptime_mission(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app_private', 'pg_temp'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_claim_date date := (v_now at time zone 'utc')::date;
  v_rental public.player_agent_rentals%rowtype;
  v_claim public.agent_uptime_mission_claims%rowtype;
  v_reward numeric := 10;
  v_ledger jsonb;
begin
  if p_player_id is null or not exists (
    select 1 from public.players p where p.id = p_player_id
  ) then
    raise exception 'Player identity is required';
  end if;

  if not exists (
    select 1
    from public.mission_tasks mt
    where mt.id = 'agent-uptime'
      and mt.kind = 'daily'
      and mt.status = 'published'
      and mt.reward = 10
      and mt.reward_currency = 'ZAP'
      and mt.unlock_cost_zp = 0
  ) then
    raise exception 'Agent Uptime mission is not configured for ZAP claims';
  end if;

  select r.*
    into v_rental
    from public.player_agent_rentals r
    where r.player_id = p_player_id
      and r.status = 'active'
      and r.starts_at <= v_now - interval '12 hours'
      and r.expires_at > v_now
    order by r.starts_at asc
    limit 1
    for update;

  if not found then
    raise exception 'A paid agent must remain continuously active for 12 hours before claiming';
  end if;

  insert into public.agent_uptime_mission_claims (
    player_id, claim_date, rental_id, rental_started_at, reward_zap
  ) values (
    p_player_id, v_claim_date, v_rental.id, v_rental.starts_at, v_reward
  )
  on conflict (player_id, claim_date) do nothing
  returning * into v_claim;

  if not found then
    select * into v_claim
    from public.agent_uptime_mission_claims
    where player_id = p_player_id and claim_date = v_claim_date;

    return jsonb_build_object(
      'success', true,
      'alreadyClaimed', true,
      'claimDate', v_claim.claim_date,
      'claimedAt', v_claim.claimed_at,
      'rewardZap', v_claim.reward_zap
    );
  end if;

  v_ledger := public.apply_player_zap_ledger_entry(
    p_player_id,
    'credit',
    v_reward,
    'agent_uptime_mission',
    'agent-uptime:' || v_claim_date::text,
    'agent-uptime:' || p_player_id::text || ':' || v_claim_date::text,
    'Agent Uptime mission: 12 hours of continuous active rental'
  );

  return jsonb_build_object(
    'success', true,
    'alreadyClaimed', false,
    'claimDate', v_claim.claim_date,
    'claimedAt', v_claim.claimed_at,
    'rewardZap', v_reward,
    'balanceAfter', v_ledger->'balanceAfter'
  );
end;
$function$;

revoke all on function public.claim_agent_uptime_mission(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_agent_uptime_mission(uuid)
  to service_role;
