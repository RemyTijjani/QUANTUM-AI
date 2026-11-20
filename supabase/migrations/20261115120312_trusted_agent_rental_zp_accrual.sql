-- Trusted ZP accrual for confirmed GRAM agent rentals.
-- Accrual is bounded by each rental's active window and is idempotent per time slice.

alter table public.player_agent_rentals
  add column if not exists accrued_through timestamptz not null default now();

create table if not exists public.agent_rental_zp_accruals (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.player_agent_rentals(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  rate_per_second numeric(8, 3) not null check (rate_per_second in (0.100, 0.300)),
  amount numeric(30, 9) not null check (amount > 0),
  created_at timestamptz not null default now(),
  constraint agent_rental_zp_accrual_period_check check (period_end > period_start),
  constraint agent_rental_zp_accrual_idempotency_key
    unique (rental_id, period_start, period_end)
);

create index if not exists agent_rental_zp_accruals_player_created_idx
  on public.agent_rental_zp_accruals (player_id, created_at desc);

alter table public.agent_rental_zp_accruals enable row level security;
revoke all on public.agent_rental_zp_accruals from public, anon, authenticated, service_role;

create or replace function public.accrue_agent_rental_zp(p_player_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
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

  return jsonb_build_object(
    'success', true,
    'creditedCount', v_credited_count,
    'creditedAmount', v_total,
    'expiredCount', v_expired_count
  );
end;
$function$;

revoke all on function public.accrue_agent_rental_zp(uuid)
  from public, anon, authenticated;
grant execute on function public.accrue_agent_rental_zp(uuid)
  to service_role;

-- Settle the previous rental through its exact expiry before extending it.
-- If it had already expired, the renewed term starts now (no ZP for the gap).
create or replace function public.confirm_agent_rental_payment(
  p_intent_id uuid,
  p_transaction_hash text,
  p_sender_address text,
  p_chain_transaction_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_intent public.agent_rental_payment_intents%rowtype;
  v_rental public.player_agent_rentals%rowtype;
  v_start timestamptz;
  v_accrued_through timestamptz;
  v_expiry timestamptz;
begin
  if p_intent_id is null
     or p_transaction_hash is null
     or length(p_transaction_hash) < 32
     or p_sender_address is null
     or p_chain_transaction_at is null then
    raise exception 'Invalid verified payment details';
  end if;

  select * into v_intent
  from public.agent_rental_payment_intents
  where id = p_intent_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'intent_not_found');
  end if;

  if v_intent.status = 'paid' then
    if v_intent.transaction_hash = p_transaction_hash then
      select * into v_rental
      from public.player_agent_rentals
      where player_id = v_intent.player_id and agent_type = v_intent.agent_type;
      return jsonb_build_object(
        'success', true, 'duplicate', true,
        'agentType', v_intent.agent_type, 'expiresAt', v_rental.expires_at
      );
    end if;
    return jsonb_build_object('success', false, 'reason', 'intent_already_paid');
  end if;

  if v_intent.status <> 'pending' then
    return jsonb_build_object('success', false, 'reason', 'intent_not_pending');
  end if;

  if p_chain_transaction_at < v_intent.created_at
     or p_chain_transaction_at > v_intent.expires_at
     or p_chain_transaction_at > now() + interval '2 minutes' then
    update public.agent_rental_payment_intents
      set status = 'expired', updated_at = now()
      where id = v_intent.id;
    return jsonb_build_object('success', false, 'reason', 'payment_outside_intent_window');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_intent.player_id::text || ':' || v_intent.agent_type, 0));

  -- Accrue any already-earned time before changing the rental expiry.
  perform public.accrue_agent_rental_zp(v_intent.player_id);

  select * into v_rental
  from public.player_agent_rentals
  where player_id = v_intent.player_id and agent_type = v_intent.agent_type
  for update;

  if found then
    if v_rental.expires_at > now() then
      v_start := v_rental.starts_at;
      v_accrued_through := v_rental.accrued_through;
    else
      v_start := now();
      v_accrued_through := now();
    end if;
    v_expiry := greatest(now(), v_rental.expires_at) + interval '30 days';
  else
    v_start := now();
    v_accrued_through := now();
    v_expiry := now() + interval '30 days';
  end if;

  update public.agent_rental_payment_intents
  set status = 'paid',
      transaction_hash = p_transaction_hash,
      sender_address = p_sender_address,
      chain_transaction_at = p_chain_transaction_at,
      updated_at = now()
  where id = v_intent.id;

  insert into public.player_agent_rentals (
    player_id, agent_type, starts_at, expires_at, status,
    last_payment_intent_id, accrued_through, updated_at
  ) values (
    v_intent.player_id, v_intent.agent_type, v_start, v_expiry, 'active',
    v_intent.id, v_accrued_through, now()
  )
  on conflict (player_id, agent_type) do update
    set starts_at = excluded.starts_at,
        expires_at = excluded.expires_at,
        status = 'active',
        last_payment_intent_id = excluded.last_payment_intent_id,
        accrued_through = excluded.accrued_through,
        updated_at = now();

  return jsonb_build_object(
    'success', true, 'duplicate', false,
    'agentType', v_intent.agent_type, 'expiresAt', v_expiry
  );
end;
$function$;

revoke all on function public.confirm_agent_rental_payment(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.confirm_agent_rental_payment(uuid, text, text, timestamptz)
  to service_role;

-- Catch up all active rentals at least once per minute; player balance reads also
-- invoke the same idempotent routine so users see recent accrual immediately.
do $schedule$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'accrue-agent-rental-zp'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'accrue-agent-rental-zp',
    '* * * * *',
    'select public.accrue_agent_rental_zp(null);'
  );
end;
$schedule$;
