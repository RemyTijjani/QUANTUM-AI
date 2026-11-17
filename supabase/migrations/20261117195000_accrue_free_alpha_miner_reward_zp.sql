-- Settle the 24-hour free Alpha Miner entitlement into verified ZP, without representing it as a paid rental.
create table if not exists app_private.player_reward_agent_zp_accruals (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null references app_private.player_reward_entitlements(id) on delete restrict,
  player_id uuid not null references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  rate_per_second numeric(8,3) not null check (rate_per_second = 0.100),
  amount numeric(30,9) not null check (amount > 0),
  created_at timestamptz not null default clock_timestamp(),
  constraint player_reward_agent_zp_accruals_period_check check (period_end > period_start),
  constraint player_reward_agent_zp_accruals_idempotency_key unique (entitlement_id, period_start, period_end)
);
create index if not exists player_reward_agent_zp_accruals_player_period_idx
  on app_private.player_reward_agent_zp_accruals (player_id, period_end desc);
alter table app_private.player_reward_agent_zp_accruals enable row level security;
revoke all on app_private.player_reward_agent_zp_accruals from public, anon, authenticated, service_role;

create or replace function public.accrue_temporary_agent_zp(p_player_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'app_private', 'pg_temp'
as $function$
declare
  v_entitlement app_private.player_reward_entitlements%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := clock_timestamp();
  v_rate numeric(8,3) := 0.100;
  v_amount numeric(30,9);
  v_accrual_id uuid;
  v_balance numeric;
  v_credited_count integer := 0;
  v_expired_count integer := 0;
  v_total numeric(30,9) := 0;
begin
  if p_player_id is not null
     and not exists (select 1 from public.players p where p.id = p_player_id) then
    raise exception 'Player was not found';
  end if;

  for v_entitlement in
    select e.*
    from app_private.player_reward_entitlements e
    where e.reward_type = 'daily_streak_agent'
      and e.reward_code = 'free_agent_1_24h'
      and e.status in ('active', 'expired')
      and e.activated_at is not null
      and e.expires_at is not null
      and e.expires_at > e.activated_at
      and (p_player_id is null or e.player_id = p_player_id)
      and least(v_now, e.expires_at) > coalesce(
        (select max(a.period_end)
         from app_private.player_reward_agent_zp_accruals a
         where a.entitlement_id = e.id),
        e.activated_at
      )
    order by e.player_id, e.activated_at, e.id
    for update of e skip locked
  loop
    select coalesce(max(a.period_end), v_entitlement.activated_at)
      into v_start
    from app_private.player_reward_agent_zp_accruals a
    where a.entitlement_id = v_entitlement.id;

    v_end := least(v_now, v_entitlement.expires_at);
    if v_end > v_start then
      v_amount := round(extract(epoch from (v_end - v_start))::numeric * v_rate, 9);

      if v_amount > 0 then
        insert into app_private.player_reward_agent_zp_accruals (
          entitlement_id, player_id, period_start, period_end, rate_per_second, amount
        ) values (
          v_entitlement.id, v_entitlement.player_id, v_start, v_end, v_rate, v_amount
        )
        on conflict (entitlement_id, period_start, period_end) do nothing
        returning id into v_accrual_id;

        if v_accrual_id is not null then
          insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
          values (v_entitlement.player_id, 0, 0, 0)
          on conflict (player_id) do nothing;

          perform 1
          from public.player_economy
          where player_id = v_entitlement.player_id
          for update;

          update public.player_economy
          set zp_balance = coalesce(zp_balance, 0) + v_amount,
              lifetime_zp = coalesce(lifetime_zp, 0) + v_amount,
              updated_at = v_now
          where player_id = v_entitlement.player_id
          returning zp_balance into v_balance;

          insert into public.economy_ledger (
            player_id, transaction_type, amount, balance_after, reference_id, description
          ) values (
            v_entitlement.player_id,
            'daily_streak_agent_mining_reward',
            v_amount,
            v_balance,
            'daily_streak_agent_accrual:' || v_accrual_id::text,
            'Free Alpha Miner reward accrual (0.1 ZP/second for up to 24 hours)'
          );

          v_credited_count := v_credited_count + 1;
          v_total := v_total + v_amount;
        end if;
      end if;
    end if;

    if v_entitlement.expires_at <= v_now and v_entitlement.status = 'active' then
      update app_private.player_reward_entitlements
      set status = 'expired'
      where id = v_entitlement.id and status = 'active';
      v_expired_count := v_expired_count + 1;
    end if;

    v_accrual_id := null;
  end loop;

  return jsonb_build_object(
    'success', true,
    'creditedCount', v_credited_count,
    'creditedAmount', v_total,
    'expiredCount', v_expired_count
  );
end;
$function$;

revoke all on function public.accrue_temporary_agent_zp(uuid) from public, anon, authenticated;
grant execute on function public.accrue_temporary_agent_zp(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.get_player_reward_entitlements(p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
declare
  v_rewards jsonb;
begin
  if p_player_id is null
     or not exists (select 1 from public.players p where p.id = p_player_id)
  then
    raise exception 'Player profile not found';
  end if;

  perform public.accrue_temporary_agent_zp(p_player_id);

  update app_private.player_reward_entitlements
  set status = 'expired'
  where player_id = p_player_id
    and status = 'active'
    and expires_at is not null
    and expires_at <= now()
    and reward_type in ('fragment_mining_boost', 'daily_streak_agent');

  select coalesce(jsonb_agg(jsonb_build_object(
    'entitlementId', e.id,
    'rewardType', e.reward_type,
    'rewardCode', e.reward_code,
    'status', e.status,
    'grantedAt', e.granted_at,
    'activatedAt', e.activated_at,
    'expiresAt', e.expires_at,
    'metadata', e.metadata
  ) order by
    case when e.status = 'active' then 0 else 1 end,
    e.granted_at desc
  ), '[]'::jsonb)
  into v_rewards
  from app_private.player_reward_entitlements e
  where e.player_id = p_player_id
    and e.reward_type in ('fragment_mining_boost', 'daily_streak_agent')
    and e.status in ('available', 'active');

  return jsonb_build_object('success', true, 'rewards', v_rewards);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.accrue_agent_rental_zp(p_player_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_rental public.player_agent_rentals%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := clock_timestamp();
  v_rate numeric(8, 3);
  v_amount numeric(30, 9);
  v_accrual_id uuid;
  v_balance numeric;
  v_credited_count integer := 0;
  v_expired_count integer := 0;
  v_total numeric(30, 9) := 0;
  v_temporary_result jsonb;
begin
  if p_player_id is not null
     and not exists (select 1 from public.players p where p.id = p_player_id) then
    raise exception 'Player was not found';
  end if;

  for v_rental in
    select r.*
    from public.player_agent_rentals r
    where r.status = 'active'
      and (p_player_id is null or r.player_id = p_player_id)
      and (
        r.accrued_through < least(v_now, r.expires_at)
        or r.expires_at <= v_now
      )
    order by r.player_id, r.agent_type, r.id
    for update skip locked
  loop
    v_start := v_rental.accrued_through;
    v_end := least(v_now, v_rental.expires_at);
    v_rate := case v_rental.agent_type
      when 'alpha_miner' then 0.100
      when 'overclocked_core' then 0.300
    end;

    if v_end > v_start then
      v_amount := round(extract(epoch from (v_end - v_start))::numeric * v_rate, 9);

      if v_amount > 0 then
        insert into public.agent_rental_zp_accruals (
          rental_id, player_id, period_start, period_end, rate_per_second, amount
        ) values (
          v_rental.id, v_rental.player_id, v_start, v_end, v_rate, v_amount
        )
        on conflict (rental_id, period_start, period_end) do nothing
        returning id into v_accrual_id;

        if v_accrual_id is not null then
          insert into public.player_economy (player_id, zp_balance, lifetime_zp, pending_kickback)
          values (v_rental.player_id, 0, 0, 0)
          on conflict (player_id) do nothing;

          perform 1
          from public.player_economy
          where player_id = v_rental.player_id
          for update;

          update public.player_economy
          set zp_balance = coalesce(zp_balance, 0) + v_amount,
              lifetime_zp = coalesce(lifetime_zp, 0) + v_amount,
              updated_at = v_now
          where player_id = v_rental.player_id
          returning zp_balance into v_balance;

          insert into public.economy_ledger (
            player_id, transaction_type, amount, balance_after, reference_id, description
          ) values (
            v_rental.player_id,
            'agent_rental_mining_reward',
            v_amount,
            v_balance,
            'agent_rental_accrual:' || v_accrual_id::text,
            case v_rental.agent_type
              when 'alpha_miner' then 'Verified Alpha Miner rental accrual (0.1 ZP/second)'
              else 'Verified Overclocked Core rental accrual (0.3 ZP/second)'
            end
          );

          v_credited_count := v_credited_count + 1;
          v_total := v_total + v_amount;
        end if;
      end if;
    end if;

    update public.player_agent_rentals
    set accrued_through = greatest(accrued_through, v_end),
        status = case when expires_at <= v_now then 'expired' else 'active' end,
        updated_at = v_now
    where id = v_rental.id;

    if v_rental.expires_at <= v_now then
      v_expired_count := v_expired_count + 1;
    end if;

    v_accrual_id := null;
  end loop;

  v_temporary_result := public.accrue_temporary_agent_zp(p_player_id);

  return jsonb_build_object(
    'success', true,
    'creditedCount', v_credited_count,
    'creditedAmount', v_total,
    'expiredCount', v_expired_count,
    'temporaryAgent', v_temporary_result
  );
end;
$function$
;
revoke all on function public.get_player_reward_entitlements(uuid) from public, anon, authenticated;
grant execute on function public.get_player_reward_entitlements(uuid) to service_role;
revoke all on function public.accrue_agent_rental_zp(uuid) from public, anon, authenticated;
grant execute on function public.accrue_agent_rental_zp(uuid) to service_role;
