-- Stage 6 raffle publishing.
-- Publishing is a separate Admin action after the complete prize pool is reserved.
-- No funds move in this migration; it only changes raffle visibility/status.

create or replace function app_private.publish_raffle(
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
  v_published_at timestamptz;
begin
  if p_raffle_id is null then
    raise exception 'A raffle is required';
  end if;
  if p_admin is null or length(btrim(p_admin)) < 1 or length(p_admin) > 100 then
    raise exception 'A valid Admin identity is required';
  end if;

  select * into v_raffle
  from public.raffles
  where id = p_raffle_id
  for update;

  if not found then
    raise exception 'Raffle was not found';
  end if;
  if v_raffle.status <> 'draft' then
    raise exception 'Only a draft raffle can be published';
  end if;
  if v_raffle.reward_type not in ('zap', 'ton') then
    raise exception 'Only supported ZAP and TON raffles can be published';
  end if;

  select * into v_reservation
  from app_private.raffle_prize_reservations
  where raffle_id = p_raffle_id
  for update;

  if not found or v_reservation.status <> 'reserved' then
    raise exception 'Lock the full prize pool before publishing this raffle';
  end if;
  if v_reservation.amount <> v_raffle.prize_pool_amount
     or v_reservation.reward_type <> v_raffle.reward_type
     or v_reservation.funding_source <> v_raffle.funding_source
     or v_reservation.reward_code is not null then
    raise exception 'The reserved prize pool does not match this raffle. Review the draft and funding reservation';
  end if;

  if v_raffle.reward_type = 'ton' then
    if v_raffle.funding_source <> 'external' then
      raise exception 'TON prizes must use verified external funding';
    end if;
    if to_regclass('app_private.player_ton_wallets') is null
       or to_regclass('app_private.player_ton_balances') is null
       or to_regclass('app_private.ton_withdrawal_requests') is null
       or to_regprocedure('app_private.request_ton_withdrawal(uuid,numeric,text)') is null then
      raise exception 'TON publishing is blocked until the player TON wallet and withdrawal workflow is installed and ready';
    end if;
  end if;

  v_published_at := now();
  update public.raffles
  set status = 'published',
      published_at = v_published_at,
      updated_by = p_admin,
      updated_at = v_published_at
  where id = p_raffle_id;

  insert into public.raffle_audit_log(raffle_id, actor, action, details)
  values (
    p_raffle_id,
    p_admin,
    'raffle_published',
    jsonb_build_object(
      'reservationId', v_reservation.id,
      'amount', v_reservation.amount,
      'currency', v_raffle.prize_currency,
      'fundingSource', v_raffle.funding_source,
      'publishedAt', v_published_at
    )
  );

  return jsonb_build_object(
    'success', true,
    'status', 'published',
    'raffleId', p_raffle_id,
    'publishedAt', v_published_at
  );
end;
$$;

revoke all on function app_private.publish_raffle(uuid, text) from public, anon, authenticated;
grant execute on function app_private.publish_raffle(uuid, text) to service_role;

create or replace function public.publish_raffle(p_raffle_id uuid, p_admin text)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
  select app_private.publish_raffle(p_raffle_id, p_admin);
$$;

revoke all on function public.publish_raffle(uuid, text) from public, anon, authenticated;
grant execute on function public.publish_raffle(uuid, text) to service_role;

comment on function app_private.publish_raffle(uuid, text) is
  'Publishes a Stage 6 raffle only when its full prize pool is reserved and verified. TON also requires the player TON withdrawal workflow objects to exist.';
