-- Enforce the approved 100 ZAP minimum at the table boundary and
-- return exact wallet integers as strings for JavaScript clients.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app_private.zap_transfers'::regclass
      AND conname = 'zap_transfers_minimum_amount'
  ) THEN
    ALTER TABLE app_private.zap_transfers
      ADD CONSTRAINT zap_transfers_minimum_amount CHECK (amount >= 100);
  END IF;
END
$migration$;

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
  if p_player_id is null or not exists (
    select 1 from public.players p where p.id = p_player_id
  ) then
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
    'amount', t.amount::text,
    'balanceAfter', t.balance_after::text,
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
    'balance', v_wallet.balance::text,
    'lifetimeEarned', v_wallet.lifetime_earned::text,
    'lifetimeSpent', v_wallet.lifetime_spent::text,
    'updatedAt', v_wallet.updated_at,
    'transactions', v_transactions
  );
end;
$function$;
