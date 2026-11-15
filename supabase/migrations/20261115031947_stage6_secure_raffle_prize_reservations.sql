-- Secure Stage 6 raffle prize reservations (TON and ZAP only).
-- This migration creates bookkeeping reserves only; it does not move on-chain funds.
alter table app_private.raffle_prize_reservations
  drop constraint if exists raffle_prize_reservations_reward_type_check,
  drop constraint if exists raffle_prize_reservations_funding_source_check;

alter table app_private.raffle_prize_reservations
  add constraint raffle_prize_reservations_reward_type_check
    check (reward_type in ('ton','zap')),
  add constraint raffle_prize_reservations_funding_source_check
    check (
      (reward_type = 'ton' and funding_source = 'external')
      or (reward_type = 'zap' and funding_source in ('treasury','external'))
    );

create table if not exists app_private.raffle_ton_reserve (
  id smallint primary key default 1 check (id = 1),
  available_balance numeric(20,8) not null default 0 check (available_balance >= 0),
  updated_at timestamptz not null default now()
);
insert into app_private.raffle_ton_reserve(id) values (1) on conflict (id) do nothing;

alter table app_private.raffle_ton_reserve enable row level security;
revoke all on app_private.raffle_ton_reserve from public, anon, authenticated;
grant all on app_private.raffle_ton_reserve to service_role;

create or replace function app_private.reserve_raffle_prize(
  p_raffle_id uuid,
  p_admin text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_raffle public.raffles%rowtype;
  v_reservation app_private.raffle_prize_reservations%rowtype;
  v_balance numeric(20,8);
begin
  if p_raffle_id is null then raise exception 'Raffle is required'; end if;
  if p_admin is null or length(btrim(p_admin)) < 1 or length(p_admin) > 100 then
    raise exception 'A valid Admin identity is required';
  end if;

  select * into v_raffle from public.raffles where id = p_raffle_id for update;
  if not found then raise exception 'Raffle was not found'; end if;
  if v_raffle.status <> 'draft' then raise exception 'Only draft raffles can reserve prizes'; end if;
  if v_raffle.reward_type not in ('ton','zap') then raise exception 'Only TON and ZAP prizes are supported'; end if;
  if v_raffle.reward_type = 'ton' and v_raffle.funding_source <> 'external' then
    raise exception 'TON prizes must use verified external funding';
  end if;

  select * into v_reservation
    from app_private.raffle_prize_reservations
    where raffle_id = p_raffle_id
    for update;

  if found and v_reservation.status = 'reserved' then
    if v_reservation.amount <> v_raffle.prize_pool_amount
       or v_reservation.reward_type <> v_raffle.reward_type
       or v_reservation.funding_source <> v_raffle.funding_source then
      raise exception 'Existing reservation does not match this raffle draft';
    end if;
    return jsonb_build_object('success',true,'alreadyReserved',true,
      'reservationId',v_reservation.id,'amount',v_reservation.amount,
      'currency',v_raffle.prize_currency,'fundingSource',v_raffle.funding_source);
  end if;

  if v_raffle.reward_type = 'ton' then
    select available_balance into v_balance
      from app_private.raffle_ton_reserve where id = 1 for update;
    if not found or v_balance < v_raffle.prize_pool_amount then
      raise exception 'Insufficient verified external TON reserve';
    end if;
    update app_private.raffle_ton_reserve
      set available_balance = available_balance - v_raffle.prize_pool_amount,
          updated_at = now()
      where id = 1;
  elsif v_raffle.funding_source = 'treasury' then
    select balance into v_balance
      from app_private.platform_treasury_zap where id = 1 for update;
    if not found or v_balance < v_raffle.prize_pool_amount then
      raise exception 'Insufficient ZAP in platform treasury';
    end if;
    update app_private.platform_treasury_zap
      set balance = balance - v_raffle.prize_pool_amount, updated_at = now()
      where id = 1;
    insert into app_private.platform_treasury_zap_ledger(
      entry_type,amount,balance_after,source,source_reference,idempotency_key,description
    ) values (
      'debit',v_raffle.prize_pool_amount,v_balance - v_raffle.prize_pool_amount,
      'raffle_prize_reservation',p_raffle_id::text,
      'raffle-prize-reserve:' || p_raffle_id::text,
      'ZAP prize pool reserved for raffle'
    );
  else
    select available_balance into v_balance
      from app_private.raffle_zap_reserve where id = 1 for update;
    if not found or v_balance < v_raffle.prize_pool_amount then
      raise exception 'Insufficient verified external ZAP reserve';
    end if;
    update app_private.raffle_zap_reserve
      set available_balance = available_balance - v_raffle.prize_pool_amount,
          updated_at = now()
      where id = 1;
  end if;

  if v_reservation.id is null then
    insert into app_private.raffle_prize_reservations(
      raffle_id,reward_type,funding_source,amount,reward_code,status,created_by
    ) values (
      p_raffle_id,v_raffle.reward_type,v_raffle.funding_source,
      v_raffle.prize_pool_amount,null,'reserved',p_admin
    ) returning * into v_reservation;
  else
    update app_private.raffle_prize_reservations
      set reward_type = v_raffle.reward_type,
          funding_source = v_raffle.funding_source,
          amount = v_raffle.prize_pool_amount,
          reward_code = null,status = 'reserved',
          created_by = p_admin,created_at = now(),released_at = null
      where id = v_reservation.id
      returning * into v_reservation;
  end if;

  insert into public.raffle_audit_log(raffle_id,actor,action,details)
  values (p_raffle_id,p_admin,'prize_reserved',
    jsonb_build_object('reservationId',v_reservation.id,
      'amount',v_raffle.prize_pool_amount,'currency',v_raffle.prize_currency,
      'fundingSource',v_raffle.funding_source));

  return jsonb_build_object('success',true,'alreadyReserved',false,
    'reservationId',v_reservation.id,'amount',v_raffle.prize_pool_amount,
    'currency',v_raffle.prize_currency,'fundingSource',v_raffle.funding_source);
end;
$$;

revoke all on function app_private.reserve_raffle_prize(uuid,text) from public,anon,authenticated;
grant execute on function app_private.reserve_raffle_prize(uuid,text) to service_role;

create or replace function public.reserve_raffle_prize(p_raffle_id uuid,p_admin text)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
  select app_private.reserve_raffle_prize(p_raffle_id,p_admin);
$$;
revoke all on function public.reserve_raffle_prize(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_raffle_prize(uuid,text) to service_role;
