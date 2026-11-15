-- Stage 7: atomic ZP-to-ZAP conversion.
-- Rate: 1,000 ZP = 1 whole ZAP. No balances are changed by this migration.

create or replace function public.convert_zp_to_zap(
  p_player_id uuid,
  p_zp_amount numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $function$
declare
  v_zp_balance numeric;
  v_zap_wallet app_private.player_zap_wallets%rowtype;
  v_existing app_private.zap_ledger%rowtype;
  v_zap_amount numeric;
  v_new_zp_balance numeric;
  v_new_zap_balance numeric;
  v_reference text;
begin
  if p_player_id is null or not exists (
    select 1 from public.players p where p.id = p_player_id
  ) then
    raise exception 'Player account was not found';
  end if;

  if p_zp_amount is null
     or p_zp_amount <= 0
     or p_zp_amount::text in ('NaN', 'Infinity', '-Infinity')
     or p_zp_amount <> trunc(p_zp_amount)
     or mod(p_zp_amount, 1000) <> 0 then
    raise exception 'Enter a whole-number ZP amount in multiples of 1,000';
  end if;

  if nullif(trim(p_idempotency_key), '') is null
     or length(p_idempotency_key) > 128 then
    raise exception 'A valid conversion request key is required';
  end if;

  v_zap_amount := p_zp_amount / 1000;
  v_reference := 'zp-conversion:' || trim(p_idempotency_key);

  -- Lock in a consistent order so concurrent conversions cannot overspend.
  select e.zp_balance
    into v_zp_balance
  from public.player_economy e
  where e.player_id = p_player_id
  for update;

  if not found then
    raise exception 'ZP wallet was not found';
  end if;

  select *
    into v_zap_wallet
  from app_private.player_zap_wallets w
  where w.player_id = p_player_id
  for update;

  if not found then
    raise exception 'ZAP wallet was not found';
  end if;

  -- A retry returns the original result without moving either balance again.
  select *
    into v_existing
  from app_private.zap_ledger z
  where z.player_id = p_player_id
    and z.idempotency_key = v_reference;

  if found then
    if v_existing.entry_type <> 'credit'
       or v_existing.amount <> v_zap_amount
       or v_existing.source <> 'zp_conversion'
       or v_existing.source_reference <> v_reference then
      raise exception 'This request key was already used for another transaction';
    end if;

    return jsonb_build_object(
      'success', true,
      'alreadyApplied', true,
      'zpDebited', p_zp_amount,
      'zapCredited', v_zap_amount,
      'zpBalance', v_zp_balance,
      'zapBalance', v_zap_wallet.balance,
      'conversionReference', v_reference
    );
  end if;

  if v_zp_balance < p_zp_amount then
    raise exception 'Insufficient ZP balance';
  end if;

  v_new_zp_balance := v_zp_balance - p_zp_amount;
  v_new_zap_balance := v_zap_wallet.balance + v_zap_amount;

  update public.player_economy
  set zp_balance = v_new_zp_balance,
      updated_at = now()
  where player_id = p_player_id;

  update app_private.player_zap_wallets
  set balance = v_new_zap_balance,
      lifetime_earned = lifetime_earned + v_zap_amount,
      updated_at = now()
  where player_id = p_player_id;

  insert into public.economy_ledger (
    player_id, transaction_type, amount, balance_after, reference_id, description
  ) values (
    p_player_id,
    'zp_to_zap_conversion',
    -p_zp_amount,
    v_new_zp_balance,
    v_reference,
    'Converted ' || p_zp_amount::text || ' ZP into ' || v_zap_amount::text || ' ZAP'
  );

  insert into app_private.zap_ledger (
    player_id, entry_type, amount, balance_after, source,
    source_reference, idempotency_key, description
  ) values (
    p_player_id,
    'credit',
    v_zap_amount,
    v_new_zap_balance,
    'zp_conversion',
    v_reference,
    v_reference,
    'Converted ' || p_zp_amount::text || ' ZP into ' || v_zap_amount::text || ' ZAP'
  );

  return jsonb_build_object(
    'success', true,
    'alreadyApplied', false,
    'zpDebited', p_zp_amount,
    'zapCredited', v_zap_amount,
    'zpBalance', v_new_zp_balance,
    'zapBalance', v_new_zap_balance,
    'conversionReference', v_reference
  );
end;
$function$;

revoke all on function public.convert_zp_to_zap(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.convert_zp_to_zap(uuid, numeric, text) to service_role;
