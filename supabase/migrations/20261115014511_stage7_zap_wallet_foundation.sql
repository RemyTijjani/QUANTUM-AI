-- Stage 7: secure ZAP wallet foundation.
-- Existing players receive empty wallets only; no balances are credited or moved.

insert into app_private.player_zap_wallets (player_id, balance, lifetime_earned, lifetime_spent)
select p.id, 0, 0, 0
from public.players p
on conflict (player_id) do nothing;

create or replace function public.initialize_player_zap_wallet()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
begin
  insert into app_private.player_zap_wallets (player_id, balance, lifetime_earned, lifetime_spent)
  values (new.id, 0, 0, 0)
  on conflict (player_id) do nothing;
  return new;
end;
$function$;

drop trigger if exists initialize_player_zap_wallet_after_insert on public.players;
create trigger initialize_player_zap_wallet_after_insert
after insert on public.players
for each row execute function public.initialize_player_zap_wallet();

revoke all on function public.initialize_player_zap_wallet() from public, anon, authenticated;

create or replace function public.get_player_zap_wallet(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_wallet app_private.player_zap_wallets%rowtype;
  v_transactions jsonb;
begin
  if p_player_id is null or not exists (select 1 from public.players p where p.id = p_player_id) then
    raise exception 'Player wallet was not found';
  end if;

  insert into app_private.player_zap_wallets (player_id, balance, lifetime_earned, lifetime_spent)
  values (p_player_id, 0, 0, 0)
  on conflict (player_id) do nothing;

  select * into v_wallet
  from app_private.player_zap_wallets
  where player_id = p_player_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'entryType', t.entry_type,
    'amount', t.amount,
    'balanceAfter', t.balance_after,
    'source', t.source,
    'description', t.description,
    'createdAt', t.created_at
  ) order by t.created_at desc, t.id desc), '[]'::jsonb)
  into v_transactions
  from (
    select *
    from app_private.zap_ledger
    where player_id = p_player_id
    order by created_at desc, id desc
    limit 50
  ) t;

  return jsonb_build_object(
    'balance', v_wallet.balance,
    'lifetimeEarned', v_wallet.lifetime_earned,
    'lifetimeSpent', v_wallet.lifetime_spent,
    'updatedAt', v_wallet.updated_at,
    'transactions', v_transactions
  );
end;
$function$;

create or replace function public.apply_player_zap_ledger_entry(
  p_player_id uuid,
  p_entry_type text,
  p_amount numeric,
  p_source text,
  p_source_reference text,
  p_idempotency_key text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_wallet app_private.player_zap_wallets%rowtype;
  v_existing app_private.zap_ledger%rowtype;
  v_new_balance numeric;
  v_entry app_private.zap_ledger%rowtype;
begin
  if p_player_id is null or not exists (select 1 from public.players p where p.id = p_player_id) then
    raise exception 'Player wallet was not found';
  end if;
  if p_entry_type not in ('credit', 'debit') then
    raise exception 'Only credit and debit entries are supported';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Amount must be a positive finite number';
  end if;
  if nullif(trim(p_source), '') is null
     or nullif(trim(p_source_reference), '') is null
     or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'Source, source reference, and idempotency key are required';
  end if;

  insert into app_private.player_zap_wallets (player_id, balance, lifetime_earned, lifetime_spent)
  values (p_player_id, 0, 0, 0)
  on conflict (player_id) do nothing;

  select * into v_wallet
  from app_private.player_zap_wallets
  where player_id = p_player_id
  for update;

  select * into v_existing
  from app_private.zap_ledger
  where player_id = p_player_id and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.entry_type <> p_entry_type
       or v_existing.amount <> p_amount
       or v_existing.source <> p_source
       or v_existing.source_reference <> p_source_reference then
      raise exception 'Idempotency key was already used for a different transaction';
    end if;
    return jsonb_build_object(
      'success', true,
      'alreadyApplied', true,
      'entryId', v_existing.id,
      'balanceAfter', v_existing.balance_after
    );
  end if;

  if p_entry_type = 'debit' and v_wallet.balance < p_amount then
    raise exception 'Insufficient ZAP balance';
  end if;

  v_new_balance := case
    when p_entry_type = 'credit' then v_wallet.balance + p_amount
    else v_wallet.balance - p_amount
  end;

  update app_private.player_zap_wallets
  set balance = v_new_balance,
      lifetime_earned = lifetime_earned + case when p_entry_type = 'credit' then p_amount else 0 end,
      lifetime_spent = lifetime_spent + case when p_entry_type = 'debit' then p_amount else 0 end,
      updated_at = now()
  where player_id = p_player_id;

  insert into app_private.zap_ledger (
    player_id, entry_type, amount, balance_after, source,
    source_reference, idempotency_key, description
  ) values (
    p_player_id, p_entry_type, p_amount, v_new_balance, p_source,
    p_source_reference, p_idempotency_key, p_description
  )
  returning * into v_entry;

  return jsonb_build_object(
    'success', true,
    'alreadyApplied', false,
    'entryId', v_entry.id,
    'balanceAfter', v_new_balance
  );
end;
$function$;

revoke all on function public.get_player_zap_wallet(uuid) from public, anon, authenticated;
grant execute on function public.get_player_zap_wallet(uuid) to service_role;

revoke all on function public.apply_player_zap_ledger_entry(uuid, text, numeric, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_player_zap_ledger_entry(uuid, text, numeric, text, text, text, text) to service_role;
