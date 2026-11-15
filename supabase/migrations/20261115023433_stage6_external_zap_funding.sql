-- Stage 6: single-admin verification of externally sourced ZAP raffle funding.
-- This reserve is separate from player wallets and does not move player balances.

create table if not exists app_private.raffle_zap_reserve (
  id smallint primary key default 1 check (id = 1),
  available_balance numeric(20,8) not null default 0 check (available_balance >= 0),
  updated_at timestamptz not null default now()
);

insert into app_private.raffle_zap_reserve (id, available_balance)
values (1, 0)
on conflict (id) do nothing;

create table if not exists app_private.raffle_external_zap_funding (
  id uuid primary key default gen_random_uuid(),
  amount numeric(20,8) not null check (amount > 0),
  transaction_reference text not null unique check (length(trim(transaction_reference)) between 3 and 200),
  verification_method text not null default 'admin_external_check'
    check (verification_method = 'admin_external_check'),
  confirmed_by text not null check (length(trim(confirmed_by)) > 0),
  confirmed_at timestamptz not null default now()
);

alter table app_private.raffle_zap_reserve enable row level security;
alter table app_private.raffle_external_zap_funding enable row level security;
revoke all on app_private.raffle_zap_reserve from public, anon, authenticated;
revoke all on app_private.raffle_external_zap_funding from public, anon, authenticated;
grant select, insert, update on app_private.raffle_zap_reserve to service_role;
grant select, insert on app_private.raffle_external_zap_funding to service_role;

create or replace function app_private.confirm_external_raffle_zap_funding(
  p_amount numeric,
  p_transaction_reference text,
  p_confirmed_by text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $function$
declare
  v_reference text := trim(coalesce(p_transaction_reference, ''));
  v_admin text := trim(coalesce(p_confirmed_by, ''));
  v_balance numeric(20,8);
  v_funding_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 8) then
    raise exception 'Amount must be greater than zero with no more than 8 decimal places';
  end if;
  if length(v_reference) < 3 or length(v_reference) > 200 then
    raise exception 'A transaction reference between 3 and 200 characters is required';
  end if;
  if length(v_admin) < 1 or length(v_admin) > 100 then
    raise exception 'A valid Admin identity is required';
  end if;

  insert into app_private.raffle_zap_reserve (id, available_balance)
  values (1, 0)
  on conflict (id) do nothing;

  select available_balance into v_balance
  from app_private.raffle_zap_reserve
  where id = 1
  for update;

  insert into app_private.raffle_external_zap_funding (
    amount, transaction_reference, verification_method, confirmed_by
  ) values (
    p_amount, v_reference, 'admin_external_check', v_admin
  )
  returning id into v_funding_id;

  update app_private.raffle_zap_reserve
  set available_balance = available_balance + p_amount,
      updated_at = now()
  where id = 1
  returning available_balance into v_balance;

  return jsonb_build_object(
    'success', true,
    'fundingId', v_funding_id,
    'amount', p_amount,
    'transactionReference', v_reference,
    'confirmedBy', v_admin,
    'confirmedAt', now(),
    'availableReserve', v_balance
  );
end;
$function$;

revoke all on function app_private.confirm_external_raffle_zap_funding(numeric, text, text)
  from public, anon, authenticated;
grant execute on function app_private.confirm_external_raffle_zap_funding(numeric, text, text)
  to service_role;
