-- Stage 6: verified external TON funding for raffle prize reserves.
-- The Admin manually checks the transaction on-chain before confirming it here.
alter table app_private.raffle_ton_reserve
  alter column available_balance type numeric(30,9);

create table if not exists app_private.raffle_external_ton_funding (
  id uuid primary key default gen_random_uuid(),
  amount numeric(30,9) not null check (amount > 0),
  transaction_reference text not null unique,
  destination_wallet text not null,
  verification_method text not null default 'admin_external_check',
  confirmed_by text not null,
  confirmed_at timestamptz not null default now(),
  constraint raffle_external_ton_funding_reference_length
    check (char_length(transaction_reference) between 32 and 200)
);

create table if not exists app_private.raffle_ton_funding_config (
  id smallint primary key default 1 check (id = 1),
  wallet_address text not null,
  updated_at timestamptz not null default now()
);

insert into app_private.raffle_ton_funding_config (id, wallet_address)
values (1, 'UQB2JqfeUfS7YOkITIDoGdwg1QnND7YpxInU8p_jKkOFUbhP')
on conflict (id) do update
set wallet_address = excluded.wallet_address,
    updated_at = now();

alter table app_private.raffle_external_ton_funding enable row level security;
alter table app_private.raffle_ton_funding_config enable row level security;
revoke all on app_private.raffle_external_ton_funding from public, anon, authenticated;
revoke all on app_private.raffle_ton_funding_config from public, anon, authenticated;
grant all on app_private.raffle_external_ton_funding to service_role;
grant all on app_private.raffle_ton_funding_config to service_role;

create or replace function app_private.confirm_external_raffle_ton_funding(
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
  v_reference text := btrim(coalesce(p_transaction_reference, ''));
  v_admin text := btrim(coalesce(p_confirmed_by, ''));
  v_wallet text;
  v_balance numeric(30,9);
  v_funding_id uuid;
  v_confirmed_at timestamptz;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 9) then
    raise exception 'Amount must be greater than zero with no more than 9 decimal places';
  end if;
  if length(v_reference) < 32 or length(v_reference) > 200 then
    raise exception 'Enter a TON transaction hash/reference between 32 and 200 characters';
  end if;
  if length(v_admin) < 1 or length(v_admin) > 100 then
    raise exception 'A valid Admin identity is required';
  end if;

  select wallet_address into v_wallet
  from app_private.raffle_ton_funding_config
  where id = 1;
  if v_wallet is null then
    raise exception 'TON raffle funding wallet is not configured';
  end if;

  insert into app_private.raffle_ton_reserve (id, available_balance)
  values (1, 0)
  on conflict (id) do nothing;

  select available_balance into v_balance
  from app_private.raffle_ton_reserve
  where id = 1
  for update;

  insert into app_private.raffle_external_ton_funding (
    amount, transaction_reference, destination_wallet, verification_method, confirmed_by
  ) values (
    p_amount, v_reference, v_wallet, 'admin_external_check', v_admin
  )
  returning id, confirmed_at into v_funding_id, v_confirmed_at;

  update app_private.raffle_ton_reserve
  set available_balance = available_balance + p_amount,
      updated_at = now()
  where id = 1
  returning available_balance into v_balance;

  return jsonb_build_object(
    'success', true,
    'fundingId', v_funding_id,
    'amount', p_amount,
    'transactionReference', v_reference,
    'destinationWallet', v_wallet,
    'confirmedBy', v_admin,
    'confirmedAt', v_confirmed_at,
    'availableReserve', v_balance
  );
end;
$function$;

create or replace function public.confirm_external_raffle_ton_funding(
  p_amount numeric,
  p_transaction_reference text,
  p_confirmed_by text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, app_private
as $function$
  select app_private.confirm_external_raffle_ton_funding(
    p_amount, p_transaction_reference, p_confirmed_by
  );
$function$;

create or replace function public.get_external_raffle_ton_funding()
returns jsonb
language sql
security definer
set search_path = pg_catalog, app_private
as $function$
  select jsonb_build_object(
    'walletAddress', (select wallet_address from app_private.raffle_ton_funding_config where id = 1),
    'availableReserve', coalesce((select available_balance from app_private.raffle_ton_reserve where id = 1), 0),
    'updatedAt', (select updated_at from app_private.raffle_ton_reserve where id = 1),
    'funding', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'amount', amount,
        'transaction_reference', transaction_reference,
        'destination_wallet', destination_wallet,
        'verification_method', verification_method,
        'confirmed_by', confirmed_by,
        'confirmed_at', confirmed_at
      ) order by confirmed_at desc)
      from (
        select id, amount, transaction_reference, destination_wallet, verification_method, confirmed_by, confirmed_at
        from app_private.raffle_external_ton_funding
        order by confirmed_at desc
        limit 100
      ) recent
    ), '[]'::jsonb)
  );
$function$;

revoke all on function app_private.confirm_external_raffle_ton_funding(numeric, text, text) from public, anon, authenticated;
revoke all on function public.confirm_external_raffle_ton_funding(numeric, text, text) from public, anon, authenticated;
revoke all on function public.get_external_raffle_ton_funding() from public, anon, authenticated;
grant execute on function app_private.confirm_external_raffle_ton_funding(numeric, text, text) to service_role;
grant execute on function public.confirm_external_raffle_ton_funding(numeric, text, text) to service_role;
grant execute on function public.get_external_raffle_ton_funding() to service_role;
